import { TasteProfile, FeedSignal } from "../types";

const STORAGE_KEY = "ilm-taste";

// Poids par signal
const SIGNAL_WEIGHTS: Record<FeedSignal, number> = {
  like: 1.0,
  save: 1.5,
  dwell: 0.5,
  open: 0.3,
  skip: -0.5,
};

export function emptyProfile(): TasteProfile {
  return {
    version: 1,
    vector: [],
    weight: 0,
    liked: [],
    saved: [],
    skipped: [],
    seen: {},
  };
}

export function loadProfile(): TasteProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile();
    const parsed = JSON.parse(raw) as TasteProfile;
    if (parsed.version !== 1) return emptyProfile();
    return parsed;
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(profile: TasteProfile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

/** Normalisation L2 d'un vecteur */
function l2normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/**
 * Met à jour le profil de goût avec un nouveau signal.
 * @param profile  profil courant (muté en place, renvoyer la nouvelle référence)
 * @param embedding  vecteur L2-normalisé du nugget ([] si non disponible)
 * @param signal  type de signal
 * @param nuggetId  id du nugget
 */
export function updateProfile(
  profile: TasteProfile,
  embedding: number[],
  signal: FeedSignal,
  nuggetId: string
): TasteProfile {
  const next: TasteProfile = {
    ...profile,
    liked: [...profile.liked],
    saved: [...profile.saved],
    skipped: [...profile.skipped],
    seen: { ...profile.seen },
  };

  // Mise à jour des listes de signaux
  if (signal === "like" && !next.liked.includes(nuggetId)) {
    next.liked.push(nuggetId);
  }
  if (signal === "save" && !next.saved.includes(nuggetId)) {
    next.saved.push(nuggetId);
  }
  if (signal === "skip" && !next.skipped.includes(nuggetId)) {
    next.skipped.push(nuggetId);
  }

  // Mise à jour du vecteur (moyenne incrémentale pondérée)
  const w = SIGNAL_WEIGHTS[signal];
  if (w !== 0 && embedding.length > 0) {
    const curVec = next.vector;
    const curWeight = next.weight;
    const absW = Math.abs(w);
    const newWeight = curWeight + absW;

    if (curVec.length === 0) {
      // Cold start : on prend directement le vecteur
      next.vector = w > 0 ? [...embedding] : [];
      next.weight = absW;
    } else {
      // Moyenne pondérée incrémentale
      const updated = curVec.map((val, i) => {
        const delta = (embedding[i] ?? 0) * w;
        return (val * curWeight + delta) / newWeight;
      });
      next.vector = w > 0 ? l2normalize(updated) : l2normalize(updated);
      next.weight = newWeight;
    }
  }

  return next;
}

/** Marque le nugget comme vu (incrémente count, met à jour lastSeen) */
export function markSeen(profile: TasteProfile, nuggetId: string): TasteProfile {
  const prev = profile.seen[nuggetId];
  return {
    ...profile,
    seen: {
      ...profile.seen,
      [nuggetId]: {
        count: (prev?.count ?? 0) + 1,
        lastSeen: Date.now(),
      },
    },
  };
}
