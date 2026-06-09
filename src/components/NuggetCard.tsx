import React, { forwardRef, useState } from "react";
import { Nugget, FeedSignal, TasteProfile } from "../types";
import { cn } from "../lib/utils";
import {
  Heart,
  Bookmark,
  Share2,
  ExternalLink,
  Quote,
  Lightbulb,
  BookOpen,
  Sparkles,
  X,
  ChevronRight,
} from "lucide-react";

interface NuggetCardProps {
  nugget: Nugget;
  profile: TasteProfile;
  onSignal: (nuggetId: string, signal: FeedSignal) => void;
  onOpenSource: (sourceId: string) => void;
  className?: string;
}

const TYPE_CONFIG = {
  idea: {
    icon: Sparkles,
    label: "Idée centrale",
    gradientTop: "from-sand-500/15 via-transparent to-transparent",
    accentClass: "text-sand-500",
    chipClass: "border-sand-500/30 bg-sand-500/10 text-sand-500 hover:bg-sand-500/20",
    orbs: ["#C9A84C", "#8B6914", "#F5C518"],
  },
  concept: {
    icon: Lightbulb,
    label: "Concept clé",
    gradientTop: "from-blue-500/10 via-transparent to-transparent",
    accentClass: "text-blue-400",
    chipClass: "border-blue-400/30 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20",
    orbs: ["#3B82F6", "#1D4ED8", "#93C5FD"],
  },
  quote: {
    icon: Quote,
    label: "Citation",
    gradientTop: "from-purple-500/10 via-transparent to-transparent",
    accentClass: "text-purple-400",
    chipClass: "border-purple-400/30 bg-purple-400/10 text-purple-400 hover:bg-purple-400/20",
    orbs: ["#A855F7", "#7C3AED", "#D8B4FE"],
  },
  lesson: {
    icon: BookOpen,
    label: "Leçon pratique",
    gradientTop: "from-green-500/10 via-transparent to-transparent",
    accentClass: "text-green-400",
    chipClass: "border-green-400/30 bg-green-400/10 text-green-400 hover:bg-green-400/20",
    orbs: ["#22C55E", "#166534", "#86EFAC"],
  },
};

export const NuggetCard = forwardRef<HTMLDivElement, NuggetCardProps>(
  ({ nugget, profile, onSignal, onOpenSource, className }, ref) => {
    const [sheetOpen, setSheetOpen] = useState(false);
    const config = TYPE_CONFIG[nugget.type];
    const Icon = config.icon;
    const isLiked = profile.liked.includes(nugget.id);
    const isSaved = profile.saved.includes(nugget.id);

    const handleLike = (e: React.MouseEvent) => { e.stopPropagation(); onSignal(nugget.id, "like"); };
    const handleSave = (e: React.MouseEvent) => { e.stopPropagation(); onSignal(nugget.id, "save"); };
    const handleShare = (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.share
        ? navigator.share({ title: nugget.title, text: nugget.body })
        : navigator.clipboard.writeText(nugget.body);
    };
    const handleOpenSource = (e: React.MouseEvent) => {
      e.stopPropagation();
      onSignal(nugget.id, "open");
      onOpenSource(nugget.sourceId);
    };
    const openSheet = (e: React.MouseEvent) => { e.stopPropagation(); setSheetOpen(true); };

    return (
      <div
        ref={ref}
        className={cn(
          "relative h-[100dvh] w-full snap-start flex flex-col overflow-hidden select-none",
          className
        )}
      >
        {/* ── Fond ─────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0 bg-[#080808]" />

        {/* Orbs animés */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="orb-1 absolute w-72 h-72 rounded-full blur-3xl -top-8 -left-12"
            style={{ background: config.orbs[0], opacity: 0.22 }} />
          <div className="orb-2 absolute w-56 h-56 rounded-full blur-3xl top-1/3 -right-8"
            style={{ background: config.orbs[1], opacity: 0.16 }} />
          <div className="orb-3 absolute w-80 h-80 rounded-full blur-3xl -bottom-16 left-1/4"
            style={{ background: config.orbs[2], opacity: 0.12 }} />
        </div>

        {/* Image + overlays */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <img
            src={`https://picsum.photos/seed/${encodeURIComponent(nugget.sourceTitle + nugget.author)}/800/1400`}
            alt=""
            draggable={false}
            className="w-full h-full object-cover opacity-10 saturate-50"
          />
          <div className={cn("absolute inset-0 bg-gradient-to-b", config.gradientTop)} />
          <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/70 to-transparent" />
        </div>

        {/* ── Contenu ───────────────────────────────────────────────────────── */}
        <div className="relative flex-1 flex flex-col justify-end px-6 pr-[4.5rem] pt-safe-content pb-safe-feed">

          {/* Badge */}
          <div className="flex items-center gap-2 mb-3">
            <span className={cn("flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase", config.accentClass)}>
              <Icon className="w-3.5 h-3.5" />
              {config.label}
            </span>
            <span className="text-white/20">·</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40 font-medium truncate max-w-[110px]">
              {nugget.category}
            </span>
          </div>

          {/* Titre concept */}
          {nugget.type === "concept" && (
            <h2 className="text-2xl sm:text-3xl font-sans font-semibold text-[#F6F1E5] mb-3 leading-tight">
              {nugget.title}
            </h2>
          )}

          {/* Corps */}
          {nugget.type === "quote" ? (
            <blockquote className="border-l-2 border-sand-500/50 pl-4 mb-3">
              <p className="text-lg sm:text-xl font-serif italic text-[#F6F1E5] leading-relaxed line-clamp-5">
                « {nugget.body} »
              </p>
            </blockquote>
          ) : (
            <p className={cn(
              "font-serif leading-relaxed mb-3 line-clamp-5",
              nugget.type === "idea"
                ? "text-xl sm:text-2xl text-[#F6F1E5]"
                : "text-base sm:text-lg text-white/85"
            )}>
              {nugget.body}
            </p>
          )}

          {/* Chip "Voir le détail" */}
          {nugget.detail && (
            <button
              onClick={openSheet}
              className={cn(
                "self-start flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium mb-4 transition-all active:scale-95",
                config.chipClass
              )}
            >
              Voir le détail
              <ChevronRight className="w-3 h-3" />
            </button>
          )}

          {/* Source */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-white/30 italic font-serif truncate max-w-[170px]">
              {nugget.sourceTitle}
            </span>
            <span className="text-white/20 text-xs">—</span>
            <span className="text-xs text-white/30 font-sans truncate max-w-[100px]">
              {nugget.author}
            </span>
          </div>

          <div className="h-safe-spacer shrink-0" aria-hidden />
        </div>

        {/* ── Rail d'actions ────────────────────────────────────────────────── */}
        <div className="absolute right-3 bottom-safe-rail flex flex-col items-center gap-4">
          <ActionBtn onClick={handleLike} active={isLiked} activeClass="text-red-400" label="Aimer">
            <Heart className={cn("w-6 h-6 transition-all duration-200", isLiked && "fill-current scale-110")} />
            <span className="text-[10px] text-white/50">{isLiked ? "Aimé" : "Aimer"}</span>
          </ActionBtn>
          <ActionBtn onClick={handleSave} active={isSaved} activeClass="text-sand-500" label="Sauvegarder">
            <Bookmark className={cn("w-6 h-6 transition-all duration-200", isSaved && "fill-current scale-110")} />
            <span className="text-[10px] text-white/50">{isSaved ? "Sauvé" : "Sauver"}</span>
          </ActionBtn>
          <ActionBtn onClick={handleOpenSource} active={false} activeClass="" label="Source">
            <ExternalLink className="w-6 h-6" />
            <span className="text-[10px] text-white/50">Source</span>
          </ActionBtn>
          <ActionBtn onClick={handleShare} active={false} activeClass="" label="Partager">
            <Share2 className="w-6 h-6" />
            <span className="text-[10px] text-white/50">Partager</span>
          </ActionBtn>
        </div>

        {/* ── Bottom sheet détail ───────────────────────────────────────────── */}
        {sheetOpen && (
          <>
            <div
              className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm"
              onClick={() => setSheetOpen(false)}
            />
            <div className="sheet-slide-up absolute bottom-0 left-0 right-0 z-40 flex flex-col max-h-[78dvh] rounded-t-3xl bg-[#111111] border-t border-white/10">
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>

              {/* Header */}
              <div className="flex items-start justify-between px-6 py-4 shrink-0 border-b border-white/10">
                <div className="flex-1 pr-3">
                  <span className={cn("text-[10px] font-bold tracking-widest uppercase block mb-1", config.accentClass)}>
                    {config.label}
                  </span>
                  <h3 className="text-xl font-sans font-semibold text-[#F6F1E5] leading-snug">
                    {nugget.type === "concept" ? nugget.title : nugget.sourceTitle}
                  </h3>
                </div>
                <button
                  onClick={() => setSheetOpen(false)}
                  className="p-2 -mr-1 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Corps scrollable */}
              <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5 pb-safe-feed">
                {/* Corps principal pour contexte */}
                {nugget.type === "quote" ? (
                  <blockquote className="border-l-2 border-sand-500/40 pl-4">
                    <p className="text-base font-serif italic text-[#F6F1E5] leading-relaxed">
                      « {nugget.body} »
                    </p>
                  </blockquote>
                ) : (
                  <p className="text-base font-serif text-white/80 leading-relaxed">
                    {nugget.body}
                  </p>
                )}

                {/* Blocs du détail (details + exemple) */}
                {nugget.detail?.split("\n\n").map((block, i) => {
                  const isExample = block.startsWith("*Exemple");
                  const text = block.replace(/^\*|\*$/g, "");
                  return (
                    <div key={i} className={cn(isExample && "pt-4 border-t border-white/10")}>
                      {isExample && (
                        <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-1 block">
                          Exemple
                        </span>
                      )}
                      <p className={cn(
                        "text-sm leading-relaxed",
                        isExample ? "text-white/55 italic font-sans" : "text-white/75 font-sans"
                      )}>
                        {text.replace(/^Exemple\s*:\s*/i, "")}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
);

NuggetCard.displayName = "NuggetCard";

interface ActionBtnProps {
  onClick: (e: React.MouseEvent) => void;
  active: boolean;
  activeClass: string;
  label: string;
  children: React.ReactNode;
}

function ActionBtn({ onClick, active, activeClass, label, children }: ActionBtnProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex flex-col items-center gap-0.5 p-2.5 min-w-[44px] min-h-[44px] justify-center rounded-2xl text-white/60 hover:text-white transition-colors active:scale-90",
        active && activeClass
      )}
    >
      {children}
    </button>
  );
}
