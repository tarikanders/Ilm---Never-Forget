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
  ChevronDown,
  ChevronUp,
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
    gradient: "from-sand-500/15 via-transparent to-transparent",
    accentClass: "text-sand-500",
  },
  concept: {
    icon: Lightbulb,
    label: "Concept clé",
    gradient: "from-blue-500/10 via-transparent to-transparent",
    accentClass: "text-blue-400",
  },
  quote: {
    icon: Quote,
    label: "Citation",
    gradient: "from-purple-500/10 via-transparent to-transparent",
    accentClass: "text-purple-400",
  },
  lesson: {
    icon: BookOpen,
    label: "Leçon pratique",
    gradient: "from-green-500/10 via-transparent to-transparent",
    accentClass: "text-green-400",
  },
};

/**
 * Carte plein-écran (snap-start) affichant un nugget atomique.
 * Ref forwarded vers le conteneur pour l'IntersectionObserver du FeedView.
 */
export const NuggetCard = forwardRef<HTMLDivElement, NuggetCardProps>(
  ({ nugget, profile, onSignal, onOpenSource, className }, ref) => {
    const [detailOpen, setDetailOpen] = useState(false);
    const config = TYPE_CONFIG[nugget.type];
    const Icon = config.icon;

    const isLiked = profile.liked.includes(nugget.id);
    const isSaved = profile.saved.includes(nugget.id);

    const handleLike = (e: React.MouseEvent) => {
      e.stopPropagation();
      onSignal(nugget.id, "like");
    };
    const handleSave = (e: React.MouseEvent) => {
      e.stopPropagation();
      onSignal(nugget.id, "save");
    };
    const handleShare = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (navigator.share) {
        navigator.share({ title: nugget.title, text: nugget.body });
      } else {
        navigator.clipboard.writeText(nugget.body);
      }
    };
    const handleOpenSource = (e: React.MouseEvent) => {
      e.stopPropagation();
      onSignal(nugget.id, "open");
      onOpenSource(nugget.sourceId);
    };

    return (
      <div
        ref={ref}
        className={cn(
          "relative h-[100dvh] w-full snap-start flex flex-col overflow-hidden select-none",
          className
        )}
      >
        {/* Fond picsum seedé selon le titre + auteur */}
        <div className="absolute inset-0 -z-10">
          <img
            src={`https://picsum.photos/seed/${encodeURIComponent(nugget.sourceTitle + nugget.author)}/800/1400`}
            alt=""
            aria-hidden
            draggable={false}
            className="w-full h-full object-cover opacity-20 saturate-50"
          />
          <div className={cn("absolute inset-0 bg-gradient-to-b", config.gradient)} />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/70 to-ink-900/40" />
        </div>

        {/* Contenu principal */}
        <div className="flex-1 flex flex-col justify-end pb-safe-feed px-5 pr-20 md:pr-10 md:px-8 pt-safe-content overflow-y-auto">
          {/* Badge type + catégorie */}
          <div className="flex items-center gap-2 mb-4">
            <span className={cn("flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase", config.accentClass)}>
              <Icon className="w-3.5 h-3.5" />
              {config.label}
            </span>
            <span className="text-white/20">·</span>
            <span className="text-[10px] uppercase tracking-widest text-white/40 font-medium truncate max-w-[140px]">
              {nugget.category}
            </span>
          </div>

          {/* Titre (concept name) ou source book pour quote/lesson */}
          {nugget.type === "concept" && (
            <h2 className="text-2xl sm:text-3xl font-sans font-semibold text-sand-100 mb-3 leading-tight text-balance">
              {nugget.title}
            </h2>
          )}

          {/* Corps principal */}
          {nugget.type === "quote" ? (
            <blockquote className="border-l-2 border-sand-500/40 pl-4 mb-4">
              <p className="text-xl sm:text-2xl font-serif italic text-sand-100 leading-relaxed text-pretty">
                « {nugget.body} »
              </p>
            </blockquote>
          ) : (
            <p
              className={cn(
                "font-serif leading-relaxed text-pretty mb-4",
                nugget.type === "idea"
                  ? "text-xl sm:text-2xl md:text-3xl text-sand-100"
                  : "text-base sm:text-lg text-white/80"
              )}
            >
              {nugget.body}
            </p>
          )}

          {/* Détails déroulables (concepts) */}
          {nugget.detail && (
            <div className="mb-4">
              <button
                onClick={() => setDetailOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors mb-2"
              >
                {detailOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {detailOpen ? "Masquer les détails" : "Voir les détails"}
              </button>
              {detailOpen && (
                <p className="text-sm text-white/60 font-sans leading-relaxed bg-white/5 rounded-xl p-4 border border-white/10">
                  {nugget.detail}
                </p>
              )}
            </div>
          )}

          {/* Source */}
          <div className="flex items-center gap-1.5 mt-1 mb-6">
            <span className="text-xs text-white/30 italic font-serif truncate max-w-[200px]">
              {nugget.sourceTitle}
            </span>
            <span className="text-white/20 text-xs">—</span>
            <span className="text-xs text-white/30 font-sans truncate max-w-[120px]">
              {nugget.author}
            </span>
          </div>

          {/* Espace pour la bottom bar + safe area */}
          <div className="h-safe-spacer" aria-hidden />
        </div>

        {/* Rail d'actions vertical — droite, style TikTok */}
        <div className="absolute right-3 bottom-safe-rail flex flex-col items-center gap-4">
          {/* Like */}
          <ActionBtn
            onClick={handleLike}
            active={isLiked}
            activeClass="text-red-400"
            label="Aimer"
          >
            <Heart className={cn("w-6 h-6 transition-all", isLiked && "fill-current scale-110")} />
            <span className="text-[10px] mt-0.5 text-white/50">
              {isLiked ? "Aimé" : "Aimer"}
            </span>
          </ActionBtn>

          {/* Save */}
          <ActionBtn
            onClick={handleSave}
            active={isSaved}
            activeClass="text-sand-500"
            label="Sauvegarder"
          >
            <Bookmark className={cn("w-6 h-6 transition-all", isSaved && "fill-current scale-110")} />
            <span className="text-[10px] mt-0.5 text-white/50">
              {isSaved ? "Sauvé" : "Sauver"}
            </span>
          </ActionBtn>

          {/* Ouvrir le résumé source */}
          <ActionBtn onClick={handleOpenSource} active={false} activeClass="" label="Source">
            <ExternalLink className="w-6 h-6" />
            <span className="text-[10px] mt-0.5 text-white/50">Source</span>
          </ActionBtn>

          {/* Partager */}
          <ActionBtn onClick={handleShare} active={false} activeClass="" label="Partager">
            <Share2 className="w-6 h-6" />
            <span className="text-[10px] mt-0.5 text-white/50">Partager</span>
          </ActionBtn>
        </div>
      </div>
    );
  }
);

NuggetCard.displayName = "NuggetCard";

// ─── Action button helper ─────────────────────────────────────────────────────

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
