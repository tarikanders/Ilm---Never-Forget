import express from "express";
import path from "path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import Anthropic from "@anthropic-ai/sdk";
import { PDFParse } from "pdf-parse";
import { extractTextFromEpub } from "./epub";
import cors from "cors";
import dotenv from "dotenv";

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

const getAnthropicClient = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  return new Anthropic({ apiKey });
};

const summaryTool: Anthropic.Tool = {
  name: "provide_summary",
  description: "Fournit un résumé structuré du document analysé.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Inférer le titre du document ou du livre." },
      author: { type: "string", description: "Inférer l'auteur si possible, sinon 'Auteur inconnu'." },
      category: { type: "string", description: "Une étiquette de catégorie globale (ex: Islam, Philosophie, Développement personnel, etc.)." },
      centralIdea: { type: "string", description: "Une idée centrale ou thèse principale de 2-3 phrases." },
      keyConcepts: {
        type: "array",
        description: "Concepts clés bien structurés avec explications détaillées et exemples.",
        items: {
          type: "object",
          properties: {
            concept: { type: "string", description: "Le nom du concept." },
            explanation: { type: "string", description: "Explication courte du concept (1-2 phrases)." },
            details: { type: "string", description: "Détails approfondis et structurés sur ce concept." },
            example: { type: "string", description: "Un exemple concret pour illustrer le concept." },
          },
          required: ["concept", "explanation", "details", "example"],
        },
      },
      memorableQuotes: {
        type: "array",
        description: "Maximum 5 citations mémorables extraites du texte.",
        items: { type: "string" },
      },
      practicalLessons: {
        type: "array",
        description: "Maximum 5 leçons pratiques tirées du document.",
        items: { type: "string" },
      },
      mindMap: {
        type: "array",
        description: "Une hiérarchie de concepts pour une carte mentale. Max 15 nœuds. Ex: [ { parent: 'Racine', child: 'Branche A' } ]",
        items: {
          type: "object",
          properties: {
            parent: { type: "string" },
            child: { type: "string" },
          },
          required: ["parent", "child"],
        },
      },
      keywords: {
        type: "array",
        description: "5 à 10 mots-clés unifiés (en minuscules) pour lier ce document à d'autres dans une base de connaissances.",
        items: { type: "string" },
      },
    },
    required: ["title", "author", "category", "centralIdea", "keyConcepts", "memorableQuotes", "practicalLessons", "mindMap", "keywords"],
  },
};

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

    // claude-sonnet-4-6 has 200K token context. ~4 chars/token → 800K chars max.
    // Reserve tokens for prompt structure and output.
    const maxChars = 600000;
    if (textContent.length > maxChars) {
      textContent = textContent.substring(0, maxChars);
    }

    const ai = getAnthropicClient();

    const isVeryLong = textContent.length > 300000;

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
Incluez au maximum ${maxConcepts} concepts clés.

Texte du document:
${textContent}`;

    let response: Anthropic.Message | undefined;
    let retries = 3;

    while (retries > 0) {
      try {
        response = await ai.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          tools: [summaryTool],
          tool_choice: { type: "tool", name: "provide_summary" },
          messages: [{ role: "user", content: prompt }],
        });
        break;
      } catch (err: any) {
        const errorMessage = err.message || "";
        if (errorMessage.includes("overloaded") || errorMessage.includes("529") || errorMessage.includes("rate_limit")) {
          retries--;
          console.warn(`API overloaded. Retries remaining: ${retries}`);
          if (retries === 0) throw err;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } else {
          throw err;
        }
      }
    }

    const toolUseBlock = response?.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
    if (!toolUseBlock) {
      throw new Error("No structured output returned from AI.");
    }

    res.json(toolUseBlock.input);
  } catch (err: any) {
    console.error("Error summarizing:", err);

    const errorMessage = err.message || "";
    if (errorMessage.includes("overloaded") || errorMessage.includes("529") || errorMessage.includes("rate_limit")) {
      return res.status(503).json({ error: "Les serveurs d'IA sont actuellement très sollicités. Veuillez patienter et réessayer dans quelques instants." });
    }

    res.status(500).json({ error: errorMessage || "Failed to process document" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
