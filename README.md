<div align="center">

# Ilm — Never Forget It

**Upload any document. AI extracts what matters. Build a knowledge library that sticks.**

[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black)](https://firebase.google.com)
[![Gemini](https://img.shields.io/badge/Gemini_API-4285F4?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev)

</div>

---

## What it does

Ilm (العلم — *knowledge* in Arabic) is a **personal knowledge management app** powered by Gemini. You upload books, papers, or articles; the AI reads them and distills the content into atomic **nuggets** — small, memorable units organized into a scrollable feed.

Instead of highlighting text you never revisit, Ilm keeps your knowledge alive.

## Features

- **Document ingestion** — upload PDFs, batch processing supported
- **AI extraction** — Gemini extracts: central idea, key concepts (with details + examples), memorable quotes, and practical lessons
- **Nugget feed** — swipe through your knowledge like a feed, filtered by tag, author, or category
- **Concept map** — visualize relationships between concepts across your entire library as an interactive graph
- **Firebase sync** — Google sign-in, cloud backup, library synced across devices
- **EPUB export** — export your library as a readable e-book
- **Zen mode** — distraction-free reading view
- **Tag & author filters** — slice your library any way you want

## Nugget types

| Type | What it is |
|------|-----------|
| `idea` | The single central idea of the source |
| `concept` | A key concept with explanation, details, and example |
| `quote` | A memorable citation worth keeping |
| `lesson` | A practical, actionable takeaway |

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript |
| Build | Vite |
| AI | Gemini API (document understanding) |
| Auth & DB | Firebase Auth + Firestore |
| Graph | Custom concept map renderer |
| Export | EPUB generation |

## Run locally

```bash
npm install
# Set GEMINI_API_KEY in .env.local
# Set Firebase config in src/lib/firebase.ts
npm run dev     # http://localhost:5173
```

## How nuggets are built

```
Document → Gemini → {
  centralIdea,
  keyConcepts[],     ← each becomes a nugget with body + detail + example
  quotes[],
  lessons[]
}
→ flat nugget array → ranked feed
```
