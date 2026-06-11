# Ilm — Never Forget It

App de gestion de connaissances : upload de documents → extraction IA de "nuggets" → feed scrollable.

## Stack
- **Front** : React 19 + TypeScript + Vite + Tailwind v4
- **Serveur** : Express (`server.ts`) — sert le SPA via Vite middleware en dev, expose `/api`
- **IA** : **Anthropic Claude** (`claude-haiku-4-5-20251001`), tool use (`dialogueTool`, `summaryTool`) dans `server.ts`
- **Cloud** : Firebase Hosting (statique) + Firestore + Storage ; backend `/api` sur Cloud Run (service `ilm`)

## Commandes
```bash
npm run dev      # tsx server.ts (Express + Vite en middleware)
npm run build    # vite build && esbuild server.ts -> dist/server.cjs
npm start        # node dist/server.cjs
npm run lint     # tsc --noEmit  (PAS de tests — utiliser /code-review avant push)
```

## Architecture
- `src/components/` : UI. `NuggetCard.tsx` = god component (765 lignes, à découper un jour).
- `src/lib/` : `api.ts` (appels backend), `nuggets.ts`, `embeddings.ts`, `feed.ts`, `taste.ts`, `audioController.ts`, `epubExport.ts`.
- `server.ts` (476 lignes) : endpoints IA (résumé, dialogue, génération audio). Clé via `getAnthropicClient()` → `ANTHROPIC_API_KEY`.
- Déploiement : GitHub Actions (`.github/workflows/deploy.yml`) déploie le **backend** sur Cloud Run à chaque push main. Le **statique (hosting)** est déployé **à la main** (`firebase deploy`) depuis le PC local.

## Pièges (vérifiés, ne pas redécouvrir)
- ⚠️ **README/badges disent "Gemini" → FAUX.** Le code utilise Claude Haiku. `@google/genai` est une dépendance morte. `.env.example` mentionne ANTHROPIC_API_KEY (correct).
- ⚠️ **`public/background_bank/` (106 MB de vidéos) est gitignoré** → absent de git et de la CI. Présent uniquement sur le disque local. Le hosting déployé en local les embarque ; un déploiement depuis un clone frais ou la CI les ferait 404. **Pas de backup ailleurs que le disque local.**
- ⚠️ **`npm run clean` utilise `rm -rf`** → cassé sous Windows/PowerShell. Remplacer par `rimraf`.
- ⚠️ Provider IA = Anthropic → voir le skill `claude-api` pour modèles/pricing/tool use.

## Conventions
- Sous-module git (repo `Ilm---Never-Forget`). Toujours `git fetch` avant opération git.
- Pas de suite de tests : relire les diffs IA avec soin, `/code-review` avant push.
