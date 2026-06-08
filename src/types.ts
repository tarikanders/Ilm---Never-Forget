export interface KeyConcept {
  concept: string;
  explanation: string;
  details: string;
  example: string;
  image?: string;
}

export interface ConceptLink {
  from: string;
  to: string;
  relation: string;
}

export interface MindMapNode {
  parent: string;
  child: string;
}

export interface SummaryData {
  id?: string;
  userId?: string;
  title: string;
  author: string;
  category: string;
  centralIdea: string;
  keyConcepts: KeyConcept[];
  memorableQuotes: string[];
  practicalLessons: string[];
  mindMap: MindMapNode[];
  conceptLinks?: ConceptLink[];
  keywords: string[];
  heroImage?: string;
  /** Texte source brut — transitoire (non stocké dans Firestore summaries) */
  sourceText?: string;
  createdAt?: string;
}

// ─── Feed / TikTok types ──────────────────────────────────────────────────────

export type NuggetType = "idea" | "concept" | "quote" | "lesson";

export interface Nugget {
  /** Unique id: `${sourceId}:${type}:${index}` */
  id: string;
  sourceId: string;      // SummaryData.id
  type: NuggetType;
  title: string;         // concept name | "Idée centrale" | livre title for quote/lesson
  body: string;          // texte principal affiché sur la carte
  detail?: string;       // détails/exemple déroulables (concepts uniquement)
  category: string;
  author: string;
  sourceTitle: string;
  keywords: string[];
}

export interface SeenEntry {
  count: number;
  lastSeen: number; // timestamp ms
}

export interface TasteProfile {
  version: 1;
  /** Centroïde L2-normalisé des embeddings aimés */
  vector: number[];
  /** Nb de signaux agrégés (pour moyenne incrémentale) */
  weight: number;
  liked: string[];
  saved: string[];
  skipped: string[];
  seen: Record<string, SeenEntry>;
}

export type FeedSignal = "like" | "save" | "skip" | "dwell" | "open";
