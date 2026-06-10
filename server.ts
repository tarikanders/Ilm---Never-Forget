import express from "express";
import path from "path";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { PDFParse } from "pdf-parse";
import { extractTextFromEpub } from "./epub";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

app.use(cors());
app.use(express.json());

// Serve background media assets (optimisés, dans public/ — servis aussi par Vite/dist)
app.use("/background_bank", express.static(path.join(process.cwd(), "public", "background_bank")));

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

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }
  return new GoogleGenAI({ apiKey });
};

// ─── PCM → WAV helper ────────────────────────────────────────────────────────
// Gemini TTS renvoie du PCM brut 16-bit signé, 24000 Hz, mono, encodé base64.
// On l'encapsule dans un header WAV pour que les navigateurs puissent le jouer.
function pcmToWav(base64Pcm: string, sampleRate = 24000): Buffer {
  const pcm = Buffer.from(base64Pcm, "base64");
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4); // ChunkSize
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);           // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20);            // AudioFormat = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

// ─── Outil Claude pour le script dialogue ────────────────────────────────────
const dialogueTool: Anthropic.Tool = {
  name: "provide_dialogue",
  description:
    "Fournit un script de dialogue radio (2 voix) pour présenter un concept issu d'un livre ou document.",
  input_schema: {
    type: "object",
    properties: {
      turns: {
        type: "array",
        description:
          "Répliques alternées du dialogue. Doit commencer par une accroche/question forte qui donne envie d'écouter la suite.",
        items: {
          type: "object",
          properties: {
            speaker: {
              type: "string",
              enum: ["Hôte", "Experte"],
              description: "Hôte = animateur curieux, Experte = spécialiste qui explique.",
            },
            text: {
              type: "string",
              description: "Texte à prononcer. Naturel, oral, sans balises.",
            },
          },
          required: ["speaker", "text"],
        },
      },
    },
    required: ["turns"],
  },
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
      conceptLinks: {
        type: "array",
        description: "Liens sémantiques entre les concepts clés du document. Max 12. Exemples de relation : 'mène à', 'prérequis', 's\\'oppose à', 'complète', 'illustre'.",
        items: {
          type: "object",
          properties: {
            from: { type: "string", description: "Nom du concept source (doit correspondre exactement à un concept de keyConcepts ou mindMap)." },
            to:   { type: "string", description: "Nom du concept cible." },
            relation: { type: "string", description: "Libellé court de la relation (≤ 5 mots)." },
          },
          required: ["from", "to", "relation"],
        },
      },
    },
    required: ["title", "author", "category", "centralIdea", "keyConcepts", "memorableQuotes", "practicalLessons", "mindMap", "keywords"],
  },
};

// ─── Openverse image helper (uses global fetch, Node 18+) ────────────────────
const fetchThematicImage = async (query: string): Promise<string | null> => {
  try {
    const q = encodeURIComponent(query.slice(0, 100));
    const url = `https://api.openverse.org/v1/images/?q=${q}&license_type=commercial&page_size=1&format=json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { "User-Agent": "Ilm/1.0" },
    });
    if (!res.ok) return null;
    const json = await res.json() as any;
    return json?.results?.[0]?.url ?? null;
  } catch {
    return null;
  }
};

app.post("/api/summarize", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { depth } = req.body; // 'flash', 'standard', 'deep'
    const mimeType = req.file.mimetype;
    const fname = req.file.originalname.toLowerCase();
    const isPDF  = fname.endsWith(".pdf") || mimeType === "application/pdf";
    const isTXT  = fname.endsWith(".txt") || mimeType === "text/plain";
    const isEPUB = fname.endsWith(".epub") || mimeType === "application/epub+zip";
    const isMD   = fname.endsWith(".md") || fname.endsWith(".markdown") || mimeType === "text/markdown";
    let textContent = "";

    console.log("Uploaded file:", req.file.originalname, "size:", req.file.size, "mimetype:", mimeType);

    if (isPDF) {
      const pdf = new PDFParse({ data: new Uint8Array(req.file.buffer) });
      const data = await pdf.getText();
      textContent = data.text;
    } else if (isTXT || isMD) {
      textContent = req.file.buffer.toString("utf-8");
    } else if (isEPUB) {
      textContent = await extractTextFromEpub(req.file.buffer);
    } else {
      return res.status(400).json({ error: "Type de fichier non supporté. Utilisez PDF, EPUB, TXT ou Markdown." });
    }

    // claude-haiku-4-5-20251001 has 200K token context. ~4 chars/token → 800K chars max.
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
          model: "claude-haiku-4-5-20251001",
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

    const summary = toolUseBlock.input as any;

    // ── Enrich with thematic images (best-effort, parallel) ──────────────────
    const heroQuery = `${summary.title} ${summary.category}`;
    const conceptQueries: string[] = (summary.keyConcepts ?? []).map(
      (c: any) => `${c.concept} ${summary.category}`
    );

    const [heroResult, ...conceptResults] = await Promise.allSettled([
      fetchThematicImage(heroQuery),
      ...conceptQueries.map(fetchThematicImage),
    ]);

    if (heroResult.status === "fulfilled" && heroResult.value) {
      summary.heroImage = heroResult.value;
    }
    conceptResults.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value && summary.keyConcepts?.[i]) {
        summary.keyConcepts[i].image = r.value;
      }
    });

    // ── Return summary + sourceText (for chat, not stored in Firestore) ──────
    res.json({ ...summary, sourceText: textContent.slice(0, 300000) });
  } catch (err: any) {
    console.error("Error summarizing:", err);

    const errorMessage = err.message || "";
    if (errorMessage.includes("overloaded") || errorMessage.includes("529") || errorMessage.includes("rate_limit")) {
      return res.status(503).json({ error: "Les serveurs d'IA sont actuellement très sollicités. Veuillez patienter et réessayer dans quelques instants." });
    }

    res.status(500).json({ error: errorMessage || "Failed to process document" });
  }
});

// ─── Chat endpoint ────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const { question, sourceText, summary } = req.body as {
      question: string;
      sourceText?: string;
      summary: Record<string, unknown>;
    };

    if (!question?.trim()) {
      return res.status(400).json({ error: "Question vide." });
    }

    const ai = getAnthropicClient();

    let context: string;
    if (sourceText && sourceText.length > 200) {
      context = `Voici le texte source du document (extrait) :\n\n${sourceText.slice(0, 250000)}`;
    } else {
      context = `Voici le résumé structuré du document :\n\n${JSON.stringify(summary, null, 2)}`;
    }

    const systemPrompt =
      "Tu es un assistant pédagogique. Réponds uniquement en français et exclusivement d'après le document fourni. " +
      "Si l'information n'est pas dans le document, dis-le clairement. " +
      "Sois précis, concis et cite le document quand c'est utile.";

    const message = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        { role: "user", content: `${context}\n\n---\n\nQuestion : ${question}` },
      ],
    });

    const answer = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n");

    res.json({ answer });
  } catch (err: any) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message || "Erreur lors de la réponse." });
  }
});

// ─── Nugget Audio endpoint ────────────────────────────────────────────────────
app.post("/api/nugget-audio", async (req, res) => {
  try {
    const { id, type, title, body, detail, sourceTitle, author, category } = req.body as {
      id: string;
      type: string;
      title: string;
      body: string;
      detail?: string;
      sourceTitle: string;
      author: string;
      category: string;
    };

    if (!body?.trim()) {
      return res.status(400).json({ error: "Nugget body manquant." });
    }

    const ai = getAnthropicClient();

    // ── 1. Générer le script dialogue (Claude) ───────────────────────────────
    const typeLabel: Record<string, string> = {
      idea: "idée centrale",
      concept: "concept clé",
      quote: "citation mémorable",
      lesson: "leçon pratique",
    };
    const nuggetLabel = typeLabel[type] ?? type;

    const scriptPrompt = `Tu es le producteur d'une émission radio française pédagogique et captivante.
Génère un dialogue de 120 à 180 mots MAXIMUM entre deux voix :
- "Hôte" : animateur curieux, ton vif, pose des questions qui accrochent.
- "Experte" : spécialiste bienveillant, explique clairement avec des mots du quotidien.

RÈGLES STRICTES :
1. Les 2 PREMIÈRES répliques DOIVENT poser une question ou une accroche percutante qui donne envie d'écouter la suite. Pas de "Bonjour", pas de présentation molle.
2. Le dialogue approfondit UNIQUEMENT le contenu ci-dessous — pas d'inventions.
3. Ton oral naturel (pas écrit). Phrases courtes. Rythme dynamique.
4. Tout en FRANÇAIS.

Nugget (${nuggetLabel}) — "${title}" — issu de "${sourceTitle}" (${author}) :
Corps : ${body}
${detail ? `Détails : ${detail}` : ""}
Catégorie : ${category}`;

    const scriptResponse = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [dialogueTool],
      tool_choice: { type: "tool", name: "provide_dialogue" },
      messages: [{ role: "user", content: scriptPrompt }],
    });

    const toolBlock = scriptResponse.content.find(
      (b) => b.type === "tool_use"
    ) as Anthropic.ToolUseBlock | undefined;
    if (!toolBlock) {
      throw new Error("Claude n'a pas retourné de dialogue structuré.");
    }
    const script = toolBlock.input as { turns: Array<{ speaker: string; text: string }> };

    // ── 2. Composer le texte pour le TTS multi-locuteurs ────────────────────
    // Format attendu par Gemini multiSpeakerVoiceConfig :
    //   "NomLocuteur: réplique\n\nAutreLocuteur: réplique..."
    const ttsText = script.turns
      .map((t) => `${t.speaker}: ${t.text}`)
      .join("\n\n");

    // ── 3. Gemini TTS multi-locuteurs ───────────────────────────────────────
    const gemini = getGeminiClient();

    const ttsResponse = await gemini.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ role: "user", parts: [{ text: ttsText }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              { speaker: "Hôte", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
              { speaker: "Experte", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
            ],
          },
        },
      },
    });

    const audioPart = ttsResponse.candidates?.[0]?.content?.parts?.[0];
    if (!audioPart?.inlineData?.data) {
      throw new Error("Gemini TTS n'a pas retourné de données audio.");
    }

    // ── 4. PCM → WAV ─────────────────────────────────────────────────────────
    const wavBuffer = pcmToWav(audioPart.inlineData.data, 24000);
    const audioBase64 = wavBuffer.toString("base64");

    res.json({
      audioBase64,
      mimeType: "audio/wav",
      script: { turns: script.turns },
    });
  } catch (err: any) {
    console.error("[nugget-audio] Error:", err);
    const msg = err.message || "Erreur génération audio.";
    if (msg.includes("overloaded") || msg.includes("529") || msg.includes("rate_limit")) {
      return res.status(503).json({ error: "Serveurs IA surchargés, réessayez dans un instant." });
    }
    res.status(500).json({ error: msg });
  }
});

async function startServer() {
  const isProduction = process.env.NODE_ENV === "production";
  const apiOnly = process.env.API_ONLY === "true";

  if (!isProduction && !apiOnly) {
    // Production-like: integrate Vite as middleware.
    // On Windows dev this may fail due to tsx/ESM path issue — use API_ONLY=true
    // and run `npx vite dev` separately instead.
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn("⚠ Vite middleware failed to start — run `npx vite dev` separately.");
    }
  } else if (isProduction) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    if (!isProduction && apiOnly) {
      console.log("  API-only mode — run `npx vite dev` for the frontend (port 5173)");
    }
  });
}

startServer();
