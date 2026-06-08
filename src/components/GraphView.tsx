import React, { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { SummaryData } from "../types";
import ForceGraph2D from "react-force-graph-2d";

interface GraphViewProps {
  library: SummaryData[];
  onNodeClick: (item: SummaryData) => void;
}

// Palette déterministe par catégorie (hsl tournant)
const CATEGORY_COLORS = [
  "#C9A84C", "#5B8A6E", "#7B6FBB", "#C96450", "#4E8FB8",
  "#B87BAA", "#7EA85A", "#C87D3F", "#5BAABB", "#C9A87A",
];
const catColorMap = new Map<string, string>();
const getCatColor = (cat: string): string => {
  if (!catColorMap.has(cat)) {
    catColorMap.set(cat, CATEGORY_COLORS[catColorMap.size % CATEGORY_COLORS.length]);
  }
  return catColorMap.get(cat)!;
};

export function GraphView({ library, onNodeClick }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const { width } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height: 600 });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const graphData = useMemo(() => {
    const nodes: Record<string, any> = {};
    const links: any[] = [];

    // Normaliser une chaîne en clé
    const norm = (s: string) => s.toLowerCase().trim();

    // 1. Nœuds document
    library.forEach((item) => {
      const docId = `doc-${item.id}`;
      nodes[docId] = {
        id: docId,
        name: item.title,
        val: 12,
        color: getCatColor(item.category ?? ""),
        type: "document",
        item,
        category: item.category,
      };
    });

    // 2. Nœuds concepts + keywords (partagés entre docs = nœuds communs)
    // Map: normalized-key → { id, docIds[] }
    const sharedMap = new Map<string, { id: string; label: string; type: "concept" | "keyword"; docIds: string[] }>();

    library.forEach((item) => {
      const docId = `doc-${item.id}`;

      // Concepts clés
      (item.keyConcepts ?? []).forEach((c) => {
        const key = norm(c.concept);
        if (!sharedMap.has(key)) {
          sharedMap.set(key, { id: `c-${key}`, label: c.concept, type: "concept", docIds: [] });
        }
        sharedMap.get(key)!.docIds.push(docId);
      });

      // Keywords
      (item.keywords ?? []).forEach((kw) => {
        const key = norm(kw);
        if (!sharedMap.has(key)) {
          sharedMap.set(key, { id: `kw-${key}`, label: kw, type: "keyword", docIds: [] });
        }
        sharedMap.get(key)!.docIds.push(docId);
      });
    });

    // 3. Créer nœuds et liens
    sharedMap.forEach(({ id, label, type, docIds }) => {
      // Dédupliquer les docIds
      const unique = Array.from(new Set(docIds));
      // Les concepts liés à 1+ doc sont toujours ajoutés
      // Les keywords : uniquement si partagés entre 2+ docs
      if (type === "keyword" && unique.length < 2) return;

      nodes[id] = {
        id,
        name: label,
        val: type === "concept" ? 5 + unique.length * 2 : 3 + unique.length,
        color: type === "concept" ? "rgba(201,168,76,0.8)" : "rgba(255,255,255,0.3)",
        type,
      };

      unique.forEach((docId) => {
        links.push({
          source: docId,
          target: id,
          kind: type,
          // Couleur héritée de la catégorie du doc pour les concepts
          docColor: nodes[docId]?.color ?? "rgba(255,255,255,0.2)",
        });
      });
    });

    return { nodes: Object.values(nodes), links };
  }, [library]);

  // Voisins du nœud survolé
  const neighbors = useMemo<Set<string>>(() => {
    if (!hoveredId) return new Set();
    const set = new Set<string>([hoveredId]);
    graphData.links.forEach((l) => {
      const src = typeof l.source === "object" ? l.source.id : l.source;
      const tgt = typeof l.target === "object" ? l.target.id : l.target;
      if (src === hoveredId) set.add(tgt);
      if (tgt === hoveredId) set.add(src);
    });
    return set;
  }, [hoveredId, graphData.links]);

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isDoc = node.type === "document";
      const isConcept = node.type === "concept";
      const isHovered = node.id === hoveredId;
      const isDimmed = hoveredId !== null && !neighbors.has(node.id);

      ctx.globalAlpha = isDimmed ? 0.12 : 1;

      const radius = isDoc ? 5 : isConcept ? 3.5 : 2;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + (isHovered ? 1.5 : 0), 0, 2 * Math.PI);
      ctx.fillStyle = node.color ?? "#888";
      ctx.fill();

      if (isHovered || isDoc) {
        ctx.strokeStyle = isHovered ? "#fff" : "rgba(255,255,255,0.2)";
        ctx.lineWidth = (isHovered ? 1.5 : 0.5) / globalScale;
        ctx.stroke();
      }

      const maxLen = isDoc ? 22 : isConcept ? 18 : 14;
      const label: string = node.name ?? "";
      const display = label.length > maxLen ? label.slice(0, maxLen) + "…" : label;
      const fontSize = isDoc ? 5.5 : isConcept ? 4 : 3;

      if (globalScale > 0.65 || isDoc) {
        ctx.font = `${isDoc ? "600 " : ""}${fontSize}px Inter, sans-serif`;
        const tw = ctx.measureText(display).width;
        const pad = fontSize * 0.35;
        const textY = node.y + radius + (isHovered ? 1.5 : 0) + fontSize * 0.9;

        ctx.fillStyle = "rgba(10,10,10,0.82)";
        ctx.fillRect(node.x - tw / 2 - pad, textY - (fontSize + pad) / 2, tw + pad * 2, fontSize + pad);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isDoc
          ? "rgba(255,255,255,0.95)"
          : isConcept
          ? "rgba(201,168,76,0.95)"
          : "rgba(255,255,255,0.5)";
        ctx.fillText(display, node.x, textY);
      }

      ctx.globalAlpha = 1;
    },
    [hoveredId, neighbors]
  );

  const linkColor = useCallback(
    (link: any): string => {
      const src = typeof link.source === "object" ? link.source.id : link.source;
      const tgt = typeof link.target === "object" ? link.target.id : link.target;
      const isDimmed = hoveredId !== null && !neighbors.has(src) && !neighbors.has(tgt);
      if (isDimmed) return "rgba(255,255,255,0.02)";
      if (link.kind === "concept") return link.docColor ? link.docColor.replace(/[\d.]+\)$/, "0.35)") : "rgba(201,168,76,0.25)";
      return "rgba(255,255,255,0.12)";
    },
    [hoveredId, neighbors]
  );

  const handleNodeClick = useCallback(
    (node: any) => {
      if (node.type === "document" && node.item) {
        onNodeClick(node.item);
      } else if (node.type === "concept") {
        // Si un seul doc possède ce concept → ouvrir ce doc
        const docLinks = graphData.links.filter((l) => {
          const tgt = typeof l.target === "object" ? l.target.id : l.target;
          return tgt === node.id && l.kind === "concept";
        });
        const docIds = Array.from(new Set(docLinks.map((l) => typeof l.source === "object" ? l.source.id : l.source)));
        if (docIds.length === 1) {
          const docNode = graphData.nodes.find((n: any) => n.id === docIds[0]);
          if (docNode?.item) onNodeClick(docNode.item);
        }
      }
    },
    [onNodeClick, graphData]
  );

  // Légende des catégories présentes
  const categories = useMemo(
    () => Array.from(new Set(library.map((i) => i.category).filter(Boolean))),
    [library]
  );

  return (
    <div ref={containerRef} className="relative w-full border border-white/10 rounded-2xl overflow-hidden bg-black/20">
      <ForceGraph2D
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        nodeLabel="name"
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => "replace"}
        linkColor={linkColor}
        nodeRelSize={4}
        onNodeClick={handleNodeClick}
        onNodeHover={(node: any) => setHoveredId(node?.id ?? null)}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={150}
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.35}
      />

      {/* Légende */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-2.5 text-xs font-sans pointer-events-none max-w-[180px]">
        <p className="text-white/30 uppercase tracking-widest text-[9px] mb-0.5">Types</p>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#C9A84C] inline-block shrink-0 opacity-90" />
          <span className="text-white/60">Document</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[rgba(201,168,76,0.8)] inline-block shrink-0" />
          <span className="text-white/60">Concept</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white/30 inline-block shrink-0" />
          <span className="text-white/60">Mot-clé partagé</span>
        </div>
        {categories.length > 1 && (
          <>
            <p className="text-white/30 uppercase tracking-widest text-[9px] mt-1 mb-0.5">Catégories</p>
            {categories.slice(0, 6).map((cat) => (
              <div key={cat} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                  style={{ background: getCatColor(cat) }}
                />
                <span className="text-white/50 truncate">{cat}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
