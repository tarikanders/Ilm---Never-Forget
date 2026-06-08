import React, { useState } from "react";
import { SummaryData } from "../types";
import {
  BookOpen, Sparkles, BrainCircuit, Quote, ListChecks,
  Download, Share2, ChevronDown, ChevronUp, Maximize, Minimize,
  FileType, MessageCircle, BookDown,
} from "lucide-react";
import { cn } from "../lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildEpubBlob } from "../lib/epubExport";
import { ConceptMap } from "./ConceptMap";
import { DocumentChat } from "./DocumentChat";

interface SummaryViewProps {
  data: SummaryData;
  isZenMode: boolean;
  setIsZenMode: (zen: boolean) => void;
  loadSourceText?: (id: string) => Promise<string | null>;
}

// Placeholder SVG déterministe (fallback si pas d'image thématique)
const placeholderUrl = (seed: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/1920/800`;

export function SummaryView({ data, isZenMode, setIsZenMode, loadSourceText }: SummaryViewProps) {
  const [activeTab, setActiveTab] = useState<"Aperçu" | "Concepts" | "Questions">("Aperçu");
  const [expandedConcepts, setExpandedConcepts] = useState<Record<number, boolean>>({});
  const [epubLoading, setEpubLoading] = useState(false);

  const toggleConcept = (idx: number) => {
    setExpandedConcepts((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const exportMarkdown = () => {
    let md = `# ${data.title}\n\n`;
    md += `*Auteur: ${data.author}*\n\n`;
    md += `## Idée Centrale\n${data.centralIdea}\n\n`;
    if (data.practicalLessons?.length) {
      md += `## Leçons Pratiques\n`;
      data.practicalLessons.forEach((l) => (md += `- ${l}\n`));
      md += `\n`;
    }
    if (data.memorableQuotes?.length) {
      md += `## Citations\n`;
      data.memorableQuotes.forEach((q) => (md += `> ${q}\n\n`));
    }
    if (data.keyConcepts?.length) {
      md += `## Concepts Clés\n`;
      data.keyConcepts.forEach((c) => {
        md += `### ${c.concept}\n${c.explanation}\n\n`;
        if (c.details) md += `${c.details}\n\n`;
        if (c.example) md += `*Exemple: ${c.example}*\n\n`;
      });
    }
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data.title.toLowerCase().replace(/[\s\W]+/g, "-")}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportEpub = async () => {
    setEpubLoading(true);
    try {
      const blob = await buildEpubBlob(data);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${data.title.toLowerCase().replace(/[\s\W]+/g, "-")}.epub`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("ePub generation failed", e);
    } finally {
      setEpubLoading(false);
    }
  };

  const heroSrc = data.heroImage || placeholderUrl(data.title + data.author);

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-8 md:gap-12 pb-24 px-4 md:px-0 animate-in fade-in slide-in-from-bottom-8 duration-1000 ease-out">

      {/* Hero Image */}
      {!isZenMode && (
        <div className="w-full aspect-[2.35/1] md:aspect-[21/9] rounded-2xl md:rounded-3xl overflow-hidden mt-4 relative border border-white/10 shadow-xl shrink-0 group">
          <img
            src={heroSrc}
            alt={data.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105 opacity-80 saturate-50 group-hover:saturate-100"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = placeholderUrl(data.title); }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-ink-900)] via-transparent to-[var(--color-ink-900)] opacity-80" />
        </div>
      )}

      {/* Header */}
      <header className={cn(
        "flex flex-col items-center text-center pt-2 md:pt-4 border-b border-white/10 pb-8 md:pb-12 transition-all duration-700",
        isZenMode ? "gap-2 mt-8" : "gap-4 md:gap-6"
      )}>
        {!isZenMode && (
          <div className="px-3 py-1.5 bg-sand-500/10 text-sand-500 border border-sand-500/20 text-[10px] md:text-xs font-bold tracking-widest uppercase rounded-full">
            {data.category || "Connaissances Générales"}
          </div>
        )}
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-serif text-sand-100 tracking-tight leading-tight text-balance">
          {data.title}
        </h1>
        <p className="text-base sm:text-lg md:text-xl text-white/50 font-serif italic">
          par {data.author}
        </p>

        {!isZenMode && (
          <div className="flex flex-wrap justify-center gap-3 md:gap-4 mt-4">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-5 py-2.5 md:px-4 md:py-2 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 active:scale-95 transition-all text-sm font-sans text-white/80 md:text-white/70"
              aria-label="Exporter en PDF"
            >
              <Download className="w-4 h-4" />
              PDF
            </button>
            <button
              onClick={exportMarkdown}
              className="flex items-center gap-2 px-5 py-2.5 md:px-4 md:py-2 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 active:scale-95 transition-all text-sm font-sans text-white/80 md:text-white/70"
              aria-label="Exporter en Markdown"
            >
              <FileType className="w-4 h-4" />
              Markdown
            </button>
            <button
              onClick={exportEpub}
              disabled={epubLoading}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 md:px-4 md:py-2 rounded-full border transition-all text-sm font-sans",
                epubLoading
                  ? "border-sand-500/30 text-sand-500/50 cursor-wait"
                  : "border-sand-500/30 text-sand-500 hover:bg-sand-500/10 active:scale-95"
              )}
              aria-label="Exporter en ePub"
            >
              {epubLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-sand-500/30 border-t-sand-500 rounded-full animate-spin" />
                  Génération…
                </>
              ) : (
                <>
                  <BookDown className="w-4 h-4" />
                  ePub
                </>
              )}
            </button>
            <button
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: data.title, text: data.centralIdea, url: window.location.href });
                } else {
                  navigator.clipboard.writeText(window.location.href);
                  alert("Lien copié dans le presse-papiers !");
                }
              }}
              className="flex items-center gap-2 px-5 py-2.5 md:px-4 md:py-2 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 active:scale-95 transition-all text-sm font-sans text-white/80 md:text-white/70"
              aria-label="Partager"
            >
              <Share2 className="w-4 h-4" />
              Partager
            </button>
          </div>
        )}
      </header>

      {/* Navigation tabs */}
      {!isZenMode && (
        <nav className="flex justify-center border-b border-white/10 overflow-x-auto w-full hide-scrollbar">
          <div className="flex gap-4 md:gap-8 px-2 md:px-4 min-w-max">
            {(["Aperçu", "Concepts", "Questions"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "pb-4 px-2 text-sm md:text-base uppercase tracking-wider font-semibold transition-all relative active:scale-95 flex items-center gap-1.5",
                  activeTab === tab ? "text-sand-500" : "text-white/40 hover:text-white/80"
                )}
              >
                {tab === "Questions" && <MessageCircle className="w-4 h-4" />}
                {tab}
                {activeTab === tab && (
                  <div className="absolute bottom-0 left-0 w-full h-[2px] bg-sand-500 rounded-t-full shadow-[0_0_10px_rgba(201,168,76,0.5)]" />
                )}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Tab content */}
      <main className="min-h-[400px]">
        {activeTab === "Aperçu" && (
          <div className="flex flex-col gap-8 md:gap-12 animate-in fade-in zoom-in-95 duration-500">
            {/* Central Idea */}
            <section className="relative p-6 sm:p-8 md:p-10 rounded-2xl md:rounded-3xl bg-gradient-to-br from-white/5 to-transparent border border-white/10 shadow-lg overflow-hidden">
              <div className="absolute top-0 right-0 -mt-8 -mr-8 w-32 h-32 bg-sand-500/10 blur-3xl rounded-full pointer-events-none" />
              <Sparkles className="w-6 h-6 md:w-8 md:h-8 text-sand-500 mb-4 md:mb-6" />
              <h2 className="text-lg md:text-xl font-serif text-white/40 mb-3 md:mb-4">Idée Centrale</h2>
              <p className="text-xl sm:text-2xl md:text-3xl text-sand-100 font-serif leading-relaxed text-pretty">
                {data.centralIdea}
              </p>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
              {/* Practical Lessons */}
              <section className="p-6 md:p-8 rounded-2xl md:rounded-3xl bg-white/[0.02] border border-white/5 flex flex-col items-start h-full shadow-lg">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-sand-500/10 rounded-xl">
                    <ListChecks className="w-5 h-5 text-sand-500" />
                  </div>
                  <h2 className="text-lg md:text-xl font-sans font-medium text-white/80">Leçons Pratiques</h2>
                </div>
                <ul className="space-y-4 flex-1 w-full">
                  {data.practicalLessons?.map((lesson, idx) => (
                    <li key={idx} className="flex gap-4 items-start text-white/70 font-sans leading-relaxed bg-white/[0.01] p-3 md:p-4 rounded-xl border border-white/5">
                      <span className="text-sand-500/50 mt-0.5 select-none font-bold text-sm bg-sand-500/10 py-1 px-2 rounded-md">
                        {(idx + 1).toString().padStart(2, "0")}
                      </span>
                      <span className="text-sm md:text-base">{lesson}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Memorable Quotes */}
              <section className="p-6 md:p-8 rounded-2xl md:rounded-3xl bg-white/[0.02] border border-white/5 flex flex-col h-full shadow-lg">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-sand-500/10 rounded-xl">
                    <Quote className="w-5 h-5 text-sand-500" />
                  </div>
                  <h2 className="text-lg md:text-xl font-sans font-medium text-white/80">Citations Mémorables</h2>
                </div>
                <div className="flex flex-col gap-4 md:gap-6 flex-1 w-full">
                  {data.memorableQuotes?.slice(0, 3).map((quote, idx) => (
                    <blockquote key={idx} className="relative border-l-2 border-sand-500/30 pl-5 md:pl-6 py-2 flex-1 group">
                      <Quote className="absolute -left-2 -top-2 w-4 h-4 text-sand-500/10 group-hover:text-sand-500/20 transition-colors" />
                      <p className="text-base sm:text-lg text-sand-100 font-serif italic text-pretty">
                        "{quote}"
                      </p>
                    </blockquote>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}

        {activeTab === "Concepts" && (
          <div className="flex flex-col gap-6 md:gap-8 animate-in fade-in duration-500">
            {!isZenMode && (
              <div className="flex items-center gap-3 mb-2 md:mb-4 px-2">
                <div className="p-2 bg-sand-500/10 rounded-xl">
                  <BrainCircuit className="w-6 h-6 md:w-8 md:h-8 text-sand-500" />
                </div>
                <h2 className="text-2xl md:text-3xl font-serif text-sand-100">Concepts Clés</h2>
              </div>
            )}

            <div className="grid gap-4 md:gap-6">
              {data.keyConcepts?.map((concept, idx) => {
                const isExpanded = expandedConcepts[idx];
                const imgSrc = concept.image || placeholderUrl(concept.concept + data.title);

                return (
                  <div
                    key={idx}
                    className={cn(
                      "group flex flex-col rounded-2xl md:rounded-3xl border transition-all duration-300 overflow-hidden cursor-pointer shadow-sm hover:shadow-md",
                      isExpanded
                        ? "border-sand-500/30 bg-white/[0.03]"
                        : "border-white/10 bg-white/[0.02] hover:border-sand-500/30 hover:bg-white/[0.03]"
                    )}
                    onClick={() => toggleConcept(idx)}
                  >
                    <div className="p-5 md:p-6 lg:p-8 flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-xs font-mono font-bold text-sand-500/50 bg-sand-500/10 px-2 py-1 rounded hidden sm:inline-block">
                            #{idx + 1}
                          </span>
                          <h3 className="text-lg md:text-xl font-sans font-semibold text-sand-100 group-hover:text-sand-400 transition-colors truncate text-wrap">
                            {concept.concept}
                          </h3>
                        </div>
                        <p className="text-white/60 font-sans leading-relaxed text-sm md:text-base pr-2 line-clamp-2 sm:line-clamp-none">
                          {concept.explanation}
                        </p>
                      </div>
                      <div className={cn(
                        "flex-shrink-0 p-2 rounded-full transition-colors mt-1",
                        isExpanded
                          ? "bg-sand-500/10 text-sand-500"
                          : "bg-white/5 text-white/40 group-hover:text-sand-500 group-hover:bg-sand-500/10"
                      )}>
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </div>
                    </div>

                    <div className={cn(
                      "transition-all duration-700 ease-in-out border-t overflow-hidden px-5 md:px-8",
                      isExpanded ? "border-white/10 max-h-[5000px] py-6 md:py-8 opacity-100" : "border-transparent max-h-0 py-0 opacity-0"
                    )}>
                      <div className="flex flex-col gap-8 md:gap-10">
                        {/* Concept image */}
                        <div className="w-full h-32 md:h-48 lg:h-56 rounded-xl md:rounded-2xl overflow-hidden relative border border-white/5 opacity-80 mix-blend-luminosity hover:mix-blend-normal transition-all duration-500">
                          <img
                            src={imgSrc}
                            alt={concept.concept}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src = placeholderUrl(concept.concept);
                            }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-ink-900)] to-transparent opacity-80" />
                        </div>

                        {concept.details && (
                          <div className="w-full">
                            <h4 className="text-xs md:text-sm uppercase tracking-widest text-sand-500/70 font-bold mb-4 flex items-center gap-2">
                              <span className="h-px bg-sand-500/30 flex-1" />
                              Explication Détaillée
                              <span className="h-px bg-sand-500/30 flex-1" />
                            </h4>
                            <div className="prose dark:prose-invert prose-sand prose-sm md:prose-base lg:prose-lg max-w-none font-serif prose-p:leading-relaxed prose-p:text-white/80 prose-headings:font-sans prose-strong:text-sand-100 prose-a:text-sand-500">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{concept.details}</ReactMarkdown>
                            </div>
                          </div>
                        )}
                        {concept.example && (
                          <div className="bg-sand-500/10 border border-sand-500/20 rounded-xl md:rounded-2xl p-5 md:p-8 relative overflow-hidden shadow-inner">
                            <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-sand-400 to-sand-600" />
                            <h4 className="text-xs md:text-sm uppercase tracking-widest text-sand-500 font-bold mb-3 md:mb-4 flex items-center gap-2">
                              <Sparkles className="w-4 h-4 md:w-5 md:h-5" /> Exemple d'application
                            </h4>
                            <div className="prose dark:prose-invert prose-sand prose-sm md:prose-base max-w-none italic">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{concept.example}</ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Carte mentale interactive */}
            {(data.mindMap?.length || data.conceptLinks?.length || data.keyConcepts?.length) && !isZenMode && (
              <div className="mt-8 md:mt-12 flex flex-col gap-4">
                <h3 className="text-xl md:text-2xl font-serif text-white/80 flex items-center gap-3 px-1">
                  <BrainCircuit className="w-6 h-6 text-white/40" />
                  Structure des Connaissances
                </h3>
                <ConceptMap data={data} />
              </div>
            )}
          </div>
        )}

        {activeTab === "Questions" && (
          <div className="animate-in fade-in duration-500">
            <DocumentChat data={data} loadSourceText={loadSourceText} />
          </div>
        )}
      </main>

      {/* Zen toggle */}
      <button
        onClick={() => setIsZenMode(!isZenMode)}
        className={cn(
          "fixed bottom-6 right-6 md:bottom-8 md:right-8 p-3.5 rounded-full shadow-lg transition-all duration-300 z-50",
          isZenMode
            ? "bg-sand-500 text-ink-900 shadow-[0_0_30px_rgba(201,168,76,0.3)] hover:scale-105"
            : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white border border-white/10 backdrop-blur-md"
        )}
        aria-label={isZenMode ? "Quitter le mode Zen" : "Activer le mode Zen"}
        title={isZenMode ? "Quitter le mode Zen" : "Activer le mode Zen"}
      >
        {isZenMode ? <Minimize className="w-5 h-5 md:w-6 md:h-6" /> : <Maximize className="w-5 h-5 md:w-6 md:h-6" />}
      </button>
    </div>
  );
}
