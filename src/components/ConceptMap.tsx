import React, { useMemo, useRef, useEffect, useState, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { SummaryData } from "../types";

interface ConceptMapProps {
  data: SummaryData;
}

export function ConceptMap({ data }: ConceptMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 700, height: 420 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const { width } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height: Math.max(360, Math.min(520, width * 0.6)) });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const graphData = useMemo(() => {
    const nodes: Record<string, any> = {};
    const links: any[] = [];

    const ensureNode = (id: string, label: string, type: "concept" | "branch") => {
      if (!nodes[id]) {
        nodes[id] = {
          id,
          name: label,
          type,
          color: type === "concept" ? "#C9A84C" : "rgba(255,255,255,0.35)",
          val: type === "concept" ? 8 : 4,
        };
      }
    };

    // Nœuds depuis keyConcepts
    (data.keyConcepts ?? []).forEach((c) => {
      ensureNode(c.concept, c.concept, "concept");
    });

    // Nœuds et liens depuis mindMap
    (data.mindMap ?? []).forEach((m) => {
      ensureNode(m.parent, m.parent, "branch");
      ensureNode(m.child, m.child, "branch");
      links.push({
        source: m.parent,
        target: m.child,
        label: "",
        kind: "mindmap",
        color: "rgba(255,255,255,0.15)",
      });
    });

    // Liens depuis conceptLinks
    (data.conceptLinks ?? []).forEach((cl) => {
      ensureNode(cl.from, cl.from, "concept");
      ensureNode(cl.to, cl.to, "concept");
      links.push({
        source: cl.from,
        target: cl.to,
        label: cl.relation,
        kind: "relation",
        color: "rgba(201,168,76,0.4)",
      });
    });

    return { nodes: Object.values(nodes), links };
  }, [data]);

  // Ensemble des ids voisins du nœud survolé
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
      const label: string = node.name ?? "";
      const isConcept = node.type === "concept";
      const isHovered = node.id === hoveredId;
      const isDimmed = hoveredId !== null && !neighbors.has(node.id);

      const radius = isConcept ? 5 : 3;
      const alpha = isDimmed ? 0.15 : 1;

      ctx.globalAlpha = alpha;

      // Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isHovered ? "#fff" : (node.color ?? "#888");
      ctx.fill();

      if (isHovered) {
        ctx.strokeStyle = "#C9A84C";
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // Label
      const fontSize = isConcept ? 5 : 3.8;
      const maxLen = isConcept ? 22 : 18;
      const displayLabel = label.length > maxLen ? label.slice(0, maxLen) + "…" : label;
      ctx.font = `${isConcept ? "600 " : ""}${fontSize}px Inter, sans-serif`;

      if (globalScale > 0.7 || isConcept) {
        const textWidth = ctx.measureText(displayLabel).width;
        const padding = fontSize * 0.35;
        const bgH = fontSize + padding * 2;
        const textX = node.x;
        const textY = node.y + radius + fontSize * 0.9;

        ctx.fillStyle = "rgba(10,10,10,0.8)";
        ctx.fillRect(textX - textWidth / 2 - padding, textY - bgH / 2, textWidth + padding * 2, bgH);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isConcept ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)";
        ctx.fillText(displayLabel, textX, textY);
      }

      ctx.globalAlpha = 1;
    },
    [hoveredId, neighbors]
  );

  const linkCanvasObject = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const src = link.source;
      const tgt = link.target;
      if (!src || !tgt || src.x == null) return;

      const srcId = src.id ?? src;
      const tgtId = tgt.id ?? tgt;
      const isDimmed = hoveredId !== null && !neighbors.has(srcId) && !neighbors.has(tgtId);

      ctx.globalAlpha = isDimmed ? 0.06 : link.kind === "relation" ? 0.7 : 0.25;
      ctx.strokeStyle = link.kind === "relation" ? "#C9A84C" : "rgba(255,255,255,0.3)";
      ctx.lineWidth = link.kind === "relation" ? 1.2 / globalScale : 0.7 / globalScale;

      if (link.kind === "relation") {
        ctx.setLineDash([]);
      } else {
        ctx.setLineDash([3 / globalScale, 3 / globalScale]);
      }

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Libellé sur le lien de relation (visible si assez zoomé)
      if (link.kind === "relation" && link.label && globalScale > 1.2) {
        const mx = (src.x + tgt.x) / 2;
        const my = (src.y + tgt.y) / 2;
        ctx.font = `3.5px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(201,168,76,0.9)";
        ctx.globalAlpha = isDimmed ? 0.05 : 0.9;
        ctx.fillText(link.label, mx, my - 2.5 / globalScale);
      }

      ctx.globalAlpha = 1;
    },
    [hoveredId, neighbors]
  );

  if (graphData.nodes.length === 0) return null;

  return (
    <div ref={containerRef} className="relative w-full rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
      <ForceGraph2D
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        nodeLabel="name"
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => "replace"}
        linkCanvasObject={linkCanvasObject}
        linkCanvasObjectMode={() => "replace"}
        backgroundColor="rgba(0,0,0,0)"
        onNodeHover={(node: any) => setHoveredId(node?.id ?? null)}
        cooldownTicks={120}
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.3}
      />
      {/* Légende */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-2.5 text-xs font-sans pointer-events-none">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#C9A84C] inline-block shrink-0" />
          <span className="text-white/60">Concept clé</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white/35 inline-block shrink-0" />
          <span className="text-white/60">Nœud de structure</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-px bg-[#C9A84C]/70 inline-block shrink-0" />
          <span className="text-white/60">Lien sémantique</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-px border-t border-dashed border-white/30 inline-block shrink-0" />
          <span className="text-white/60">Hiérarchie</span>
        </div>
      </div>
      <p className="absolute top-2 right-3 text-[10px] text-white/20 font-sans pointer-events-none">
        Scroll pour zoomer · Glisser pour déplacer
      </p>
    </div>
  );
}
