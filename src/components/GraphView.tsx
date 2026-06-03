import React, { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { SummaryData } from "../types";
import ForceGraph2D from "react-force-graph-2d";

interface GraphViewProps {
  library: SummaryData[];
  onNodeClick: (item: SummaryData) => void;
}

export function GraphView({ library, onNodeClick }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const match = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDark(match.matches);
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    match.addEventListener('change', handler);
    return () => match.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setDimensions({ width, height });
    }
    
    const handleResize = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const graphData = useMemo(() => {
    const nodes: any[] = [];
    const links: any[] = [];
    const keywordMap = new Map<string, string[]>(); // keyword -> summary ids

    // Create Document Nodes
    library.forEach((item) => {
      nodes.push({
        id: item.id,
        name: item.title,
        val: 10,
        color: isDark ? "#C9A84C" : "#AB8122", // sand-500
        type: "document",
        item: item
      });

      if (item.keywords && Array.isArray(item.keywords)) {
        item.keywords.forEach((kw) => {
          const lowerKw = kw.toLowerCase().trim();
          if (!keywordMap.has(lowerKw)) {
            keywordMap.set(lowerKw, []);
          }
          keywordMap.get(lowerKw)?.push(item.id!);
        });
      }
    });

    // Create Keyword Nodes and Links
    keywordMap.forEach((docIds, kw) => {
      if (docIds.length > 1) {
        const kwId = `kw-${kw}`;
        nodes.push({
          id: kwId,
          name: kw,
          val: 5,
          color: isDark ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.4)",
          type: "keyword"
        });

        docIds.forEach((docId) => {
          links.push({
            source: docId,
            target: kwId,
            color: isDark ? "rgba(201, 168, 76, 0.2)" : "rgba(171, 129, 34, 0.2)"
          });
        });
      }
    });

    return { nodes, links };
  }, [library, isDark]);

  const handleNodeClick = useCallback(
    (node: any) => {
      if (node.type === "document" && node.item) {
        onNodeClick(node.item);
      }
    },
    [onNodeClick]
  );

  return (
    <div ref={containerRef} className="w-full h-[600px] border border-white/10 rounded-2xl overflow-hidden bg-black/20">
      <ForceGraph2D
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        nodeLabel="name"
        nodeColor={(node: any) => node.color}
        linkColor={(link: any) => link.color}
        nodeRelSize={4}
        onNodeClick={handleNodeClick}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={(node: any, ctx, globalScale) => {
          const label = node.name || "";
          // Truncate long labels
          const maxLength = node.type === "document" ? 25 : 15;
          const displayLabel = label.length > maxLength ? label.substring(0, maxLength) + "..." : label;
          
          // Fixed font size in graph coordinates (scales naturally with zooming)
          const fontSize = node.type === "document" ? 5 : 3.5;
          ctx.font = `${fontSize}px Inter, sans-serif`;
          
          // Draw node circle
          const nodeRadius = node.type === "document" ? 3 : 1.5;
          ctx.fillStyle = node.color || (isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)");
          ctx.beginPath();
          ctx.arc(node.x, node.y, nodeRadius, 0, 2 * Math.PI, false);
          ctx.fill();

          // Only show labels when zoomed in enough to make them readable
          if (globalScale > 0.8) {
            const textWidth = ctx.measureText(displayLabel).width;
            const textY = node.y + nodeRadius + (node.type === "document" ? 4 : 3);
            const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.4);

            // Draw text background
            ctx.fillStyle = isDark ? "rgba(10, 10, 10, 0.75)" : "rgba(250, 250, 250, 0.75)";
            ctx.fillRect(
              node.x - bckgDimensions[0] / 2,
              textY - bckgDimensions[1] / 2,
              bckgDimensions[0],
              bckgDimensions[1]
            );

            // Draw text
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = node.type === "document" 
              ? (isDark ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.9)")
              : (isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)");
            ctx.fillText(displayLabel, node.x, textY);
          }
        }}
      />
    </div>
  );
}
