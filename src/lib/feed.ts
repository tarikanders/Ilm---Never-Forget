import { Nugget, TasteProfile } from "../types";

const EPSILON = 0.1;          // part d'exploration aléatoire anti-bulle
const DWELL_THRESHOLD_MS = 8000; // durée min de lecture considérée comme intérêt (8s)
const SPACED_BOOST_MAX = 0.4;  // boost max pour les nuggets non vus depuis longtemps
const SEEN_PENALTY = 0.15;     // pénalité par vue supplémentaire

export { DWELL_THRESHOLD_MS };

/** Produit scalaire = cosinus si les deux vecteurs sont L2-normalisés */
function dotProduct(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Boost de révision espacée : plus un nugget n'a pas été vu depuis longtemps,
 * plus son score augmente (logarithmique, plafonné à SPACED_BOOST_MAX).
 */
function spacedBoost(lastSeen: number | undefined): number {
  if (lastSeen === undefined) return SPACED_BOOST_MAX; // jamais vu = prio max
  const hoursSince = (Date.now() - lastSeen) / 3_600_000;
  return Math.min(SPACED_BOOST_MAX, SPACED_BOOST_MAX * Math.log1p(hoursSince) / Math.log1p(168)); // 168h=1 semaine
}

/**
 * Classe les nuggets pour le feed.
 *
 * @param nuggets  pool complet (peut inclure déjà vus — on reboucle)
 * @param embeddings  Map id→vecteur L2-normalisé (peut être vide = cold start)
 * @param profile  profil de goût courant
 * @param seed  graine de shuffle pour varier entre sessions (Date.now() par défaut)
 */
export function rankFeed(
  nuggets: Nugget[],
  embeddings: Map<string, number[]>,
  profile: TasteProfile,
  seed?: number
): Nugget[] {
  if (nuggets.length === 0) return [];

  const rng = seededRandom(seed ?? Date.now());
  const hasTaste = profile.weight > 0 && profile.vector.length > 0;

  const scored = nuggets.map((n) => {
    const emb = embeddings.get(n.id) ?? [];
    const seen = profile.seen[n.id];

    // Composante sémantique (0-1 si embeddings dispo)
    const semantic = hasTaste ? (dotProduct(profile.vector, emb) + 1) / 2 : 0;

    // Boost de révision espacée
    const spaced = spacedBoost(seen?.lastSeen);

    // Pénalité pour surexposition
    const seenPenalty = seen ? seen.count * SEEN_PENALTY : 0;

    // Pénalité skip
    const skipPenalty = profile.skipped.includes(n.id) ? 0.3 : 0;

    // Légère préférence pour les nuggets aimés/sauvés (rappels positifs)
    const positiveBonus =
      (profile.liked.includes(n.id) ? 0.15 : 0) +
      (profile.saved.includes(n.id) ? 0.2 : 0);

    // Exploration aléatoire
    const noise = rng() * EPSILON;

    const score =
      (hasTaste ? 0.5 * semantic : 0) +
      0.4 * spaced -
      seenPenalty -
      skipPenalty +
      positiveBonus +
      noise;

    return { nugget: n, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.nugget);
}

/**
 * Générateur de nombres pseudo-aléatoires déterministe (mulberry32).
 * Permet de changer l'ordre au reload tout en restant reproductible.
 */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Donne les N prochains nuggets à afficher (page suivante) */
export function nextPage(
  ranked: Nugget[],
  offset: number,
  pageSize = 8
): { items: Nugget[]; nextOffset: number; looped: boolean } {
  const total = ranked.length;
  if (total === 0) return { items: [], nextOffset: 0, looped: false };

  const items: Nugget[] = [];
  let i = offset;
  let looped = false;

  while (items.length < pageSize) {
    if (i >= total) {
      i = 0;
      looped = true;
    }
    items.push(ranked[i]);
    i++;
    if (looped && i >= offset) break; // sécurité anti-boucle infinie
  }

  return { items, nextOffset: i % total, looped };
}
