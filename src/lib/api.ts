/// <reference types="vite/client" />

/**
 * Base URL des appels backend.
 *
 * - "" (dev)  → appels relatifs, servis par le même origin (server.ts + proxy /api).
 * - URL Cloud Run (prod) → appels DIRECTS vers le service `ilm`.
 *
 * Pourquoi le direct en prod : Firebase Hosting coupe les requêtes vers Cloud Run
 * à 60 s (plafond non configurable). Or /summarize (résumé de gros documents) peut
 * dépasser une minute → le navigateur recevait une erreur alors que le serveur
 * finissait à ~71 s. En appelant Cloud Run en direct, on bénéficie de son propre
 * timeout (300 s). Valeur injectée à la compilation via vite.config (VITE_API_BASE).
 */
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");

/** Préfixe un chemin /api/... avec la base backend appropriée. */
export function apiUrl(path: string): string {
  return API_BASE + path;
}
