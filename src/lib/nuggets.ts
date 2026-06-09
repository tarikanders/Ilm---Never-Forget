import { SummaryData, Nugget } from "../types";

/**
 * Aplatit toute la bibliothèque en nuggets atomiques pour le feed.
 * Fonction pure — pas d'effet de bord.
 *
 * Ordre dans un résumé :
 *   1. idea       — idée centrale (1 nugget)
 *   2. concepts   — chaque concept clé (body=explanation, detail=details+"\n\n"+example)
 *   3. quotes     — citations mémorables
 *   4. lessons    — leçons pratiques
 */
export function buildNuggets(library: SummaryData[]): Nugget[] {
  const nuggets: Nugget[] = [];

  for (const item of library) {
    const sourceId = item.id ?? item.title;
    const base = {
      sourceId,
      category: item.category ?? "Général",
      author: item.author ?? "Auteur inconnu",
      sourceTitle: item.title,
      keywords: item.keywords ?? [],
    };

    // 1. Idée centrale
    if (item.centralIdea) {
      nuggets.push({
        ...base,
        id: `${sourceId}:idea:0`,
        type: "idea",
        title: item.title,
        body: item.centralIdea,
      });
    }

    // 2. Concepts clés
    item.keyConcepts?.forEach((c, i) => {
      const detail = [c.details, c.example ? `*Exemple : ${c.example}*` : ""]
        .filter(Boolean)
        .join("\n\n");
      nuggets.push({
        ...base,
        id: `${sourceId}:concept:${i}`,
        type: "concept",
        title: c.concept,
        body: c.explanation,
        detail: detail || undefined,
      });
    });

    // 3. Citations
    item.memorableQuotes?.forEach((q, i) => {
      if (!q.trim()) return;
      nuggets.push({
        ...base,
        id: `${sourceId}:quote:${i}`,
        type: "quote",
        title: item.title,
        body: q,
      });
    });

    // 4. Leçons pratiques
    item.practicalLessons?.forEach((l, i) => {
      if (!l.trim()) return;
      nuggets.push({
        ...base,
        id: `${sourceId}:lesson:${i}`,
        type: "lesson",
        title: item.title,
        body: l,
      });
    });
  }

  return nuggets;
}
