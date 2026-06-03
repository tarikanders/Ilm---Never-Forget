import express from "express";
import path from "path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { PDFParse } from "pdf-parse";
import { EPub } from "epub2";
import { convert } from "html-to-text";
import fs from "fs";
import os from "os";
import cors from "cors";
import dotenv from "dotenv";
import { jsonrepair } from "jsonrepair";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB limit
  },
});

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

const extractTextFromEpub = async (buffer: Buffer): Promise<string> => {
  const tmpPath = path.join(os.tmpdir(), `temp-${Date.now()}.epub`);
  fs.writeFileSync(tmpPath, buffer);

  return new Promise((resolve, reject) => {
    const epub = new (EPub as any)(tmpPath);
    
    epub.on("end", async () => {
      try {
        let fullText = "";
        for (const chapter of epub.flow) {
          if (!chapter.id) continue;
          const chapterHtml = await new Promise<string>((res, rej) => {
            epub.getChapter(chapter.id, (err: any, text: string) => {
              if (err) rej(err);
              else res(text || "");
            });
          });
          
          if (chapterHtml) {
            fullText += convert(chapterHtml, { wordwrap: false }) + "\n\n";
          }
        }
        fs.unlinkSync(tmpPath);
        resolve(fullText);
      } catch (err) {
        fs.unlinkSync(tmpPath);
        reject(err);
      }
    });

    epub.on("error", (err: any) => {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      reject(err);
    });

    epub.parse();
  });
};

// Ensure clean error handling
app.post("/api/summarize", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { depth } = req.body; // 'flash', 'standard', 'deep'
    const mimeType = req.file.mimetype;
    const isPDF = req.file.originalname.toLowerCase().endsWith(".pdf") || mimeType === "application/pdf";
    const isTXT = req.file.originalname.toLowerCase().endsWith(".txt") || mimeType === "text/plain";
    const isEPUB = req.file.originalname.toLowerCase().endsWith(".epub") || mimeType === "application/epub+zip";
    let textContent = "";

    console.log("Uploaded file:", req.file.originalname, "size:", req.file.size, "mimetype:", mimeType);

    if (isPDF) {
      const pdf = new PDFParse({ data: new Uint8Array(req.file.buffer) });
      const data = await pdf.getText();
      textContent = data.text;
    } else if (isTXT) {
      textContent = req.file.buffer.toString("utf-8");
    } else if (isEPUB) {
      textContent = await extractTextFromEpub(req.file.buffer);
    } else {
      return res.status(400).json({ error: "Unsupported file type. Use PDF, EPUB, or TXT." });
    }

    // Limit text length to prevent too huge prompts if needed, but Gemini 1.5/3.5 has 1M-2M context.
    const maxChars = 2000000;
    if (textContent.length > maxChars) {
      textContent = textContent.substring(0, maxChars);
    }

    const ai = getGeminiClient();

    const isVeryLong = textContent.length > 500000;
    
    let depthInstructions = "";
    if (depth === "flash") {
      depthInstructions = "Soyez très concis, environ 1 page de résultat.";
    } else if (depth === "deep") {
      depthInstructions = "Entrez dans les détails, en couvrant les arguments nuancés et le contexte de manière exhaustive, même si le document est long.";
    } else {
      depthInstructions = "Fournissez un résumé standard et bien équilibré.";
    }

    const maxConcepts = isVeryLong ? 10 : 7;

    const prompt = `Analysez le texte du livre/document suivant et produisez un résumé hautement structuré.
Toutes les réponses, concepts, et textes générés DOIVENT ÊTRE EN FRANÇAIS.
Les concepts clés doivent être de véritables mini-cours : fournissez des explications claires et des exemples précis, tout en restant suffisamment synthétiques.
${depthInstructions}

Assurez-vous que la réponse est spécifiquement organisée selon le schéma JSON suivant. Aucun formatage supplémentaire ou bloc markdown en dehors du JSON n'est autorisé.

Texte du document:
${textContent}`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Inférer le titre du document ou du livre." },
        author: { type: Type.STRING, description: "Inférer l'auteur si possible, sinon 'Auteur inconnu'." },
        category: { type: Type.STRING, description: "Une étiquette de catégorie globale (ex: Islam, Philosophie, Développement personnel, etc.)." },
        centralIdea: { type: Type.STRING, description: "Une idée centrale ou thèse principale de 2-3 phrases." },
        keyConcepts: {
          type: Type.ARRAY,
          description: `Maximum ${maxConcepts} concepts clés, bien structurés et accompagnés d'exemples.`,
          items: {
            type: Type.OBJECT,
            properties: {
              concept: { type: Type.STRING, description: "Le nom du concept." },
              explanation: { type: Type.STRING, description: "Explication courte du concept (1-2 phrases)." },
              details: { type: Type.STRING, description: "Détails approfondis et structurés sur ce concept." },
              example: { type: Type.STRING, description: "Un exemple concret pour illustrer le concept." }
            }
          }
        },
        memorableQuotes: {
          type: Type.ARRAY,
          description: "Maximum 5 citations.",
          items: {
            type: Type.STRING
          }
        },
        practicalLessons: {
          type: Type.ARRAY,
          description: "Maximum 5 leçons pratiques.",
          items: {
            type: Type.STRING
          }
        },
        mindMap: {
          type: Type.ARRAY,
          description: "Une hiérarchie de concepts pour une carte mentale. Max 15 nœuds. Ex: [ { parent: 'Racine', child: 'Branche A' }, ... ]",
          items: {
            type: Type.OBJECT,
            properties: {
              parent: { type: Type.STRING },
              child: { type: Type.STRING }
            }
          }
        },
        keywords: {
          type: Type.ARRAY,
          description: "5 à 10 mots-clés unifiés (en minuscules) pour lier ce document à d'autres documents similaires dans une base de connaissances.",
          items: {
            type: Type.STRING
          }
        }
      },
      required: ["title", "author", "category", "centralIdea", "keyConcepts", "memorableQuotes", "practicalLessons", "mindMap", "keywords"]
    };

    let response;
    let retries = 3;
    
    while (retries > 0) {
      try {
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            maxOutputTokens: 8192,
          }
        });
        break; // Succès de la requête
      } catch (err: any) {
        const errorMessage = err.message || "";
        if (errorMessage.includes("503") || errorMessage.includes("UNAVAILABLE") || errorMessage.includes("high demand")) {
          retries--;
          console.warn(`Erreur 503 (Surcharge des serveurs). Tentatives restantes: ${retries}`);
          if (retries === 0) throw err;
          // Attente de 3 secondes avant de réessayer
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          throw err;
        }
      }
    }

    let responseText = response?.text || "{}";
    responseText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
    let parsedData;
    try {
      parsedData = JSON.parse(responseText);
    } catch (parseErr) {
      console.error("JSON formatting error. Truncated output? Attempting repair...", parseErr);
      try {
        const repaired = jsonrepair(responseText);
        parsedData = JSON.parse(repaired);
        console.log("Successfully repaired truncated JSON.");
      } catch (repairErr) {
        console.error("Repair failed:", repairErr);
        return res.status(500).json({ error: "Le document est extrêmement long ou complexe, et l'analyse a échoué. Veuillez réessayer avec un extrait plus court." });
      }
    }
    res.json(parsedData);
  } catch (err: any) {
    console.error("Error summarizing:", err);
    
    const errorMessage = err.message || "";
    if (errorMessage.includes("503") || errorMessage.includes("UNAVAILABLE") || errorMessage.includes("high demand")) {
      return res.status(503).json({ error: "Les serveurs d'IA sont actuellement très sollicités. Veuillez patienter et réessayer dans quelques instants." });
    }
    
    res.status(500).json({ error: errorMessage || "Failed to process document" });
  }
});


async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
