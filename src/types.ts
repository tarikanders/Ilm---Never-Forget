export interface KeyConcept {
  concept: string;
  explanation: string;
  details: string;
  example: string;
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
  keywords: string[];
  createdAt?: string;
}
