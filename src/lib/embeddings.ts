/**
 * Wrapper @xenova/transformers — calcul d'embeddings local (WASM, pas d'API).
 *
 * Modèle : Xenova/multilingual-e5-small (~30 Mo, cache IndexedDB HF)
 * Règles e5 :
 *   - nuggets    → préfixer "passage: "
 *   - vecteur profil/query → préfixer "query: "
 * Les vecteurs sont L2-normalisés → cosinus = produit scalaire.
 *
 * Cache local : IndexedDB "ilm-embeddings", clé = sha1(body).
 * Chaque nugget n'est calculé qu'une seule fois.
 */

// Lazy imports — @xenova/transformers est exclu d'optimizeDeps Vite (WASM)
type PipelineType = any;

let embedderPromise: Promise<PipelineType> | null = null;

function getEmbedder(): Promise<PipelineType> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      // Dynamic import to avoid blocking initial bundle
      const { pipeline } = await import("@xenova/transformers");
      return pipeline("feature-extraction", "Xenova/multilingual-e5-small", {
        quantized: true,
      });
    })();
  }
  return embedderPromise;
}

/** Hash djb2 simple (non-cryptographique) pour clé de cache */
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff;
  }
  return "emb_" + (h >>> 0).toString(36);
}

// ─── IndexedDB cache ─────────────────────────────────────────────────────────

const DB_NAME = "ilm-embeddings";
const DB_VERSION = 1;
const STORE = "vectors";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key: string): Promise<number[] | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function cacheSet(key: string, vector: number[]): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(vector, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fail silently — embedding recalculé au prochain chargement
  }
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Calcule les embeddings pour une liste de nuggets.
 * - Check cache IndexedDB first
 * - Calcul via transformers.js sinon
 * - Appelle onProgress(done, total) à chaque embedding calculé
 */
export async function embedNuggets(
  nuggets: { id: string; body: string }[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  const toCompute: typeof nuggets = [];

  // Phase 1 : charger depuis cache
  for (const n of nuggets) {
    const key = hashStr(n.body);
    const cached = await cacheGet(key);
    if (cached) {
      result.set(n.id, cached);
    } else {
      toCompute.push(n);
    }
  }

  if (toCompute.length === 0) return result;

  // Phase 2 : calculer + cacher les manquants
  let embedder: PipelineType;
  try {
    embedder = await getEmbedder();
  } catch (e) {
    console.warn("[embeddings] Impossible de charger le modèle :", e);
    return result;
  }

  let done = 0;
  for (const n of toCompute) {
    try {
      const output = await embedder(`passage: ${n.body}`, {
        pooling: "mean",
        normalize: true,
      });
      // output.data est un Float32Array
      const vec = Array.from(output.data as Float32Array);
      result.set(n.id, vec);
      await cacheSet(hashStr(n.body), vec);
    } catch (e) {
      console.warn("[embeddings] Erreur sur nugget", n.id, e);
    }
    done++;
    onProgress?.(done, toCompute.length);
  }

  return result;
}

/**
 * Calcule l'embedding d'une query (profil/recherche).
 * Préfixe "query: " selon les règles e5.
 */
export async function embedQuery(text: string): Promise<number[]> {
  try {
    const embedder = await getEmbedder();
    const output = await embedder(`query: ${text}`, {
      pooling: "mean",
      normalize: true,
    });
    return Array.from(output.data as Float32Array);
  } catch (e) {
    console.warn("[embeddings] Erreur query embedding", e);
    return [];
  }
}
