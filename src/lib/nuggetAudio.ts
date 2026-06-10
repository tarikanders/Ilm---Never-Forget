/**
 * Cache 2 niveaux pour les clips audio de nuggets.
 *
 * L1 — IndexedDB "ilm-audio" (Blob, persistant local)
 * L2 — Firebase Storage users/{uid}/audio/{nuggetId}.wav  (cloud, si connecté)
 *
 * Pattern calqué sur embeddings.ts (openDB / cacheGet / cacheSet).
 *
 * API publique :
 *   getOrGenerateAudio(nugget, uid) → { url: string (objectURL), script: DialogueTurn[] }
 *   prefetchAudio(nugget, uid)      → génère + cache sans jouer (retourne void, fire-and-forget)
 */

import { ref, getDownloadURL, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";
import { DialogueTurn, Nugget, NuggetScript } from "../types";

// ─── IndexedDB cache (L1) ─────────────────────────────────────────────────────

const DB_NAME = "ilm-audio";
const DB_VERSION = 1;
const BLOB_STORE = "blobs";
const SCRIPT_STORE = "scripts";

function openAudioDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(BLOB_STORE);
      req.result.createObjectStore(SCRIPT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  try {
    const db = await openAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(store: string, key: string, value: unknown): Promise<void> {
  try {
    const db = await openAudioDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fail silently — sera re-généré au prochain chargement
  }
}

// ─── Dédoublonnage des requêtes en cours ─────────────────────────────────────

const inflight = new Map<string, Promise<{ url: string; script: DialogueTurn[] }>>();

// Garder une référence aux objectURLs créés pour pouvoir les révoquer si nécessaire
const objectURLs = new Map<string, string>();

// ─── Génération via backend ───────────────────────────────────────────────────

async function generateAudio(nugget: Nugget): Promise<{ blob: Blob; script: DialogueTurn[] }> {
  const res = await fetch("/api/nugget-audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: nugget.id,
      type: nugget.type,
      title: nugget.title,
      body: nugget.body,
      detail: nugget.detail,
      sourceTitle: nugget.sourceTitle,
      author: nugget.author,
      category: nugget.category,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Erreur génération audio (${res.status})`);
  }
  const { audioBase64, script } = await res.json() as {
    audioBase64: string;
    mimeType: string;
    script: NuggetScript;
  };

  // Décoder base64 → Blob WAV
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "audio/wav" });
  return { blob, script: script.turns };
}

// ─── Firebase Storage (L2) ───────────────────────────────────────────────────

function storagePath(uid: string, nuggetId: string) {
  // Sanitize l'id (contient ":" qui est interdit dans Storage paths)
  const safeId = nuggetId.replace(/:/g, "_");
  return `users/${uid}/audio/${safeId}.wav`;
}

async function storageGet(uid: string, nuggetId: string): Promise<string | null> {
  try {
    const path = storagePath(uid, nuggetId);
    const url = await getDownloadURL(ref(storage, path));
    return url;
  } catch {
    return null;
  }
}

async function storageUpload(uid: string, nuggetId: string, blob: Blob): Promise<void> {
  try {
    const path = storagePath(uid, nuggetId);
    await uploadBytes(ref(storage, path), blob, { contentType: "audio/wav" });
  } catch (e) {
    console.warn("[nuggetAudio] Storage upload failed:", e);
  }
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Retourne l'objectURL de l'audio pour ce nugget.
 * Cherche L1 (IndexedDB) → L2 (Storage) → génère + cache.
 * uid = null ou "local" → pas de Storage cloud.
 */
export function getOrGenerateAudio(
  nugget: Nugget,
  uid: string | null
): Promise<{ url: string; script: DialogueTurn[] }> {
  const key = nugget.id;

  // Dédoublonner les appels concurrents (préchargement + lecture simultanés)
  if (inflight.has(key)) return inflight.get(key)!;

  const promise = (async (): Promise<{ url: string; script: DialogueTurn[] }> => {
    // ── L1 : IndexedDB ────────────────────────────────────────────────────────
    const cachedBlob = await idbGet<Blob>(BLOB_STORE, key);
    const cachedScript = await idbGet<DialogueTurn[]>(SCRIPT_STORE, key);
    if (cachedBlob instanceof Blob) {
      let url = objectURLs.get(key);
      if (!url) {
        url = URL.createObjectURL(cachedBlob);
        objectURLs.set(key, url);
      }
      return { url, script: cachedScript ?? [] };
    }

    // ── L2 : Firebase Storage (uniquement si uid cloud) ──────────────────────
    const isCloudUid = uid && uid !== "local";
    if (isCloudUid) {
      const storageUrl = await storageGet(uid, key);
      if (storageUrl) {
        // Télécharger → cacher en L1
        try {
          const res = await fetch(storageUrl);
          const blob = await res.blob();
          await idbSet(BLOB_STORE, key, blob);
          const url = URL.createObjectURL(blob);
          objectURLs.set(key, url);
          // Script : tenter de récupérer le sidecar JSON
          const scriptPath = storagePath(uid, key).replace(".wav", ".json");
          const scriptUrl = await getDownloadURL(ref(storage, scriptPath)).catch(() => null);
          let script: DialogueTurn[] = [];
          if (scriptUrl) {
            const sRes = await fetch(scriptUrl);
            const sJson = await sRes.json() as DialogueTurn[];
            script = sJson;
            await idbSet(SCRIPT_STORE, key, script);
          }
          return { url, script };
        } catch {
          // Téléchargement échoué → continuer vers génération
        }
      }
    }

    // ── Génération ────────────────────────────────────────────────────────────
    const { blob, script } = await generateAudio(nugget);
    const url = URL.createObjectURL(blob);
    objectURLs.set(key, url);

    // Persister L1
    await idbSet(BLOB_STORE, key, blob);
    await idbSet(SCRIPT_STORE, key, script);

    // Persister L2 en arrière-plan (fire-and-forget)
    if (isCloudUid) {
      storageUpload(uid, key, blob);
      // Sidecar script JSON
      const scriptBlob = new Blob([JSON.stringify(script)], { type: "application/json" });
      const scriptPath = storagePath(uid, key).replace(".wav", ".json");
      uploadBytes(ref(storage, scriptPath), scriptBlob, { contentType: "application/json" }).catch(() => {});
    }

    return { url, script };
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

/**
 * Précharge l'audio d'un nugget sans le jouer.
 * Fire-and-forget : les erreurs sont silencieuses.
 */
export function prefetchAudio(nugget: Nugget, uid: string | null): void {
  getOrGenerateAudio(nugget, uid).catch(() => {});
}
