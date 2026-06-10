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
import { doc, getDoc, setDoc, arrayUnion } from "firebase/firestore";
import { storage, db as fsdb } from "./firebase";
import { apiUrl } from "./api";
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

async function idbGetAllKeys(store: string): Promise<string[]> {
  try {
    const db = await openAudioDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

// ─── Manifest Firestore des clips générés (L2, cross-device) ─────────────────
// users/{uid}/meta/audioIndex = { ids: string[] }
// Permet de connaître, en un seul getDoc, tous les nuggets déjà sonorisés sur le
// compte — sans sonder Storage nugget par nugget.

function manifestRef(uid: string) {
  return doc(fsdb, `users/${uid}/meta`, "audioIndex");
}

async function manifestGetIds(uid: string): Promise<string[]> {
  try {
    const snap = await getDoc(manifestRef(uid));
    const data = snap.data() as { ids?: string[] } | undefined;
    return data?.ids ?? [];
  } catch {
    return [];
  }
}

function manifestAddId(uid: string, nuggetId: string): void {
  // Fire-and-forget — merge pour ne pas écraser les ids existants
  setDoc(manifestRef(uid), { ids: arrayUnion(nuggetId) }, { merge: true }).catch(() => {});
}

// ─── Dédoublonnage des requêtes en cours ─────────────────────────────────────

const inflight = new Map<string, Promise<{ url: string; script: DialogueTurn[] }>>();

// Garder une référence aux objectURLs créés pour pouvoir les révoquer si nécessaire
const objectURLs = new Map<string, string>();

// ─── Génération via backend ───────────────────────────────────────────────────

async function generateAudio(nugget: Nugget): Promise<{ blob: Blob; script: DialogueTurn[] }> {
  const res = await fetch(apiUrl("/api/nugget-audio"), {
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
  const { audioBase64, mimeType, script } = await res.json() as {
    audioBase64: string;
    mimeType: string;
    script: NuggetScript;
  };

  // Décoder base64 → Blob audio (MP3 désormais ; mimeType piloté par le serveur)
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType || "audio/mpeg" });
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
    await uploadBytes(ref(storage, path), blob, { contentType: blob.type || "audio/mpeg" });
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
      // Indexer dans le manifest pour le cache-first au prochain lancement
      manifestAddId(uid, key);
    }

    return { url, script };
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

// ─── File de préchargement séquentielle (concurrence 1) ──────────────────────
// Les générations sont coûteuses et le backend applique des limites de débit
// (cf. retries dans server.ts). On sérialise les prefetch pour ne jamais lancer
// plus d'une génération à la fois. La LECTURE réelle (getOrGenerateAudio appelé
// directement pour jouer) n'est PAS soumise à la file et reste immédiate ; le
// Map `inflight` déduplique play vs prefetch.

const prefetchQueue: Array<() => Promise<void>> = [];
const queuedIds = new Set<string>();
let prefetchRunning = false;

function pumpQueue(): void {
  if (prefetchRunning) return;
  const job = prefetchQueue.shift();
  if (!job) return;
  prefetchRunning = true;
  job()
    .catch(() => {})
    .finally(() => {
      prefetchRunning = false;
      pumpQueue();
    });
}

/**
 * Précharge l'audio d'un nugget sans le jouer (via la file séquentielle).
 * Fire-and-forget : les erreurs sont silencieuses. No-op si déjà en cache,
 * en cours de génération, ou déjà dans la file.
 */
export function prefetchAudio(nugget: Nugget, uid: string | null): void {
  const id = nugget.id;
  if (inflight.has(id) || objectURLs.has(id) || queuedIds.has(id)) return;
  queuedIds.add(id);
  prefetchQueue.push(async () => {
    try {
      await getOrGenerateAudio(nugget, uid);
    } finally {
      queuedIds.delete(id);
    }
  });
  pumpQueue();
}

/**
 * Enfile un lot ordonné de nuggets pour préchargement séquentiel.
 * Utilisé au upload (3 premiers) et pour la fenêtre glissante du feed.
 */
export function enqueuePrefetch(nuggets: Nugget[], uid: string | null): void {
  for (const n of nuggets) prefetchAudio(n, uid);
}

/**
 * Ensemble des nuggetIds dont l'audio est déjà disponible — sans rien générer.
 * L1 : clés IndexedDB locales. L2 : manifest Firestore (si uid cloud).
 * Sert au ré-ordonnancement « cache-first » du feed à l'ouverture.
 */
export async function getCachedAudioIds(uid: string | null): Promise<Set<string>> {
  const ids = new Set<string>(await idbGetAllKeys(BLOB_STORE));
  if (uid && uid !== "local") {
    for (const id of await manifestGetIds(uid)) ids.add(id);
  }
  return ids;
}
