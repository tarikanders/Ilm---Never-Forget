import React, { forwardRef, useState, useEffect, useCallback, useRef } from "react";
import { Nugget, FeedSignal, TasteProfile, AudioState, DialogueTurn } from "../types";
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
  Play,
  Pause,
  Loader2,
  Radio,
} from "lucide-react";
import { audioController } from "../lib/audioController";
import { getOrGenerateAudio } from "../lib/nuggetAudio";

interface NuggetCardProps {
  nugget: Nugget;
  profile: TasteProfile;
  onSignal: (nuggetId: string, signal: FeedSignal) => void;
  onOpenSource: (sourceId: string) => void;
  className?: string;
  /** Cette carte est-elle la carte actuellement visible (snap) ? */
  isActive?: boolean;
  /** uid Firebase (null = local) — pour le cache Storage */
  uid?: string | null;
  /** Audio globalement activé ou muet */
  audioEnabled?: boolean;
  /** Script de dialogue reçu après génération (piloté par FeedView) */
  audioScript?: DialogueTurn[];
}

// ─── Background media bank ────────────────────────────────────────────────────

const BG_ALL = [
  "12140953_2160_3840_24fps.mp4",
  "13630594_2160_3840_30fps.mp4",
  "14740627_2160_3840_30fps.mp4",
  "15056319_2160_3840_30fps.mp4",
  "15446347_2160_3840_24fps.mp4",
  "15824465_2160_3840_60fps.mp4",
  "15896448_2160_3840_60fps.mp4",
  "15907850_1080_1920_30fps.mp4",
  "15931662_2160_3840_60fps.mp4",
  "15996168_1080_1920_30fps.mp4",
  "16058368_2160_3840_25fps.mp4",
  "16061734_1080_1920_120fps.mp4",
  "16088007_1080_1920_60fps.mp4",
  "16088348_2160_3840_24fps.mp4",
  "16091333_1080_1920_50fps.mp4",
  "16091983_1080_1920_30fps.mp4",
  "16103706_2160_3840_30fps.mp4",
  "16108196_2160_3840_30fps.mp4",
  "16121847_2160_3840_60fps.mp4",
  "16135874_2160_3840_30fps.mp4",
  "16139492_2160_3840_60fps.mp4",
];

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
  ({ nugget, profile, onSignal, onOpenSource, className, isActive = false, uid = null, audioEnabled = true, audioScript = [] }, ref) => {
    const [sheetOpen, setSheetOpen] = useState(false);
    const [sheetClosing, setSheetClosing] = useState(false);
    const [activeTab, setActiveTab] = useState<0 | 1 | 2>(0);
    const config = TYPE_CONFIG[nugget.type];

    // Pick a random background file once at mount
    const [bgFile] = useState(() => BG_ALL[Math.floor(Math.random() * BG_ALL.length)]);
    const isVideo = bgFile.endsWith(".mp4");
    const bgSrc = `/background_bank/${bgFile}`;
    // Poster = même nom de base en .jpg (généré au transcodage) → 1er rendu instantané
    const posterSrc = isVideo ? `/background_bank/${bgFile.replace(/\.mp4$/, ".jpg")}` : undefined;
    const videoRef = useRef<HTMLVideoElement>(null);
    const Icon = config.icon;
    const isLiked = profile.liked.includes(nugget.id);
    const isSaved = profile.saved.includes(nugget.id);

    // ─── Audio state local ────────────────────────────────────────────────────
    const [audioState, setAudioState] = useState<AudioState>({ status: "idle" });

    // S'abonner au controller seulement si c'est notre nugget qui joue
    useEffect(() => {
      return audioController.subscribe((currentId, state) => {
        if (currentId === nugget.id) {
          setAudioState(state);
        } else if (audioState.status !== "idle") {
          // Quelqu'un d'autre joue → reset local
          setAudioState({ status: "idle" });
        }
      });
    }, [nugget.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Vidéo de fond : joue si carte active ET audio pas en pause.
    // → cliquer pause (ou l'écran) met aussi la vidéo en pause.
    useEffect(() => {
      const video = videoRef.current;
      if (!video || !isVideo) return;
      if (isActive && audioState.status !== "paused") {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }, [isActive, isVideo, audioState.status]);

    const handleAudioToggle = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!audioController.unlocked) return;
        if (audioState.status === "playing") {
          audioController.pause();
          return;
        }
        if (audioState.status === "paused") {
          audioController.play(nugget.id, "").catch(() => {});
          return;
        }
        // idle / ended / error → depuis cache (FeedView a déjà préchargé)
        setAudioState({ status: "loading" });
        getOrGenerateAudio(nugget, uid)
          .then(({ url }) => audioController.play(nugget.id, url))
          .catch((err) => setAudioState({ status: "error", message: String(err) }));
      },
      [audioState, nugget, uid]
    );

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
    const openSheet = (e: React.MouseEvent) => { e.stopPropagation(); setSheetClosing(false); setSheetOpen(true); setActiveTab(0); };
    const closeSheet = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (sheetClosing) return;
      setSheetClosing(true);
      // Laisser jouer l'animation de sortie avant de démonter
      window.setTimeout(() => { setSheetOpen(false); setSheetClosing(false); }, 270);
    };

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

        {/* Background media (vidéo ou image aléatoire) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
          {isVideo ? (
            <video
              ref={videoRef}
              src={bgSrc}
              poster={posterSrc}
              muted
              loop
              playsInline
              preload="metadata"
              className="w-full h-full object-cover scale-[1.04]"
              style={{ filter: "blur(2px)", opacity: 0.72 }}
            />
          ) : (
            <img
              src={bgSrc}
              alt=""
              draggable={false}
              className="w-full h-full object-cover scale-[1.04]"
              style={{ filter: "blur(2px)", opacity: 0.72 }}
            />
          )}
        </div>

        {/* Orbs de couleur par type (tinting) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
          <div className="orb-1 absolute w-[65vw] h-[65vw] rounded-full blur-[80px] -top-[10%] -left-[15%]"
            style={{ background: config.orbs[0], opacity: 0.22 }} />
          <div className="orb-2 absolute w-[50vw] h-[50vw] rounded-full blur-[70px] top-[30%] -right-[10%]"
            style={{ background: config.orbs[1], opacity: 0.15 }} />
          <div className="orb-3 absolute w-[45vw] h-[45vw] rounded-full blur-[60px] -bottom-[5%] left-[20%]"
            style={{ background: config.orbs[2], opacity: 0.12 }} />
        </div>

        {/* Gradients overlay pour lisibilité — scrims ciblés, pas de voile global */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {/* Teinte de couleur par type (subtile) */}
          <div className={cn("absolute inset-0 bg-gradient-to-b", config.gradientTop)} />
          {/* Scrim bas fort : protège le titre/corps/source */}
          <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-[#070707] via-[#070707]/80 via-35% to-transparent" />
        </div>

        {/* Visualizer audio circulaire */}
        <div className="absolute inset-x-0 top-0 bottom-[40%] flex items-center justify-center pointer-events-none" aria-hidden>
          <CircularVisualizer
            isPlaying={audioState.status === "playing"}
            isLoading={audioState.status === "loading"}
            colors={config.orbs}
            isActive={isActive}
          />
        </div>

        {/* ── Contenu ───────────────────────────────────────────────────────── */}
        <div className="relative flex-1 flex flex-col justify-end px-6 pr-[4.5rem] pt-safe-content pb-safe-feed">

          {/* Badge — cliquable → détail */}
          <button
            onClick={openSheet}
            className="flex items-center gap-2 mb-3 w-full text-left group active:opacity-70 transition-opacity text-white"
          >
            <span className={cn("flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase", config.accentClass)}>
              <Icon className="w-3.5 h-3.5" />
              {config.label}
            </span>
            <span className="text-white/30">·</span>
            <span className="text-[10px] uppercase tracking-widest text-white/60 font-medium truncate max-w-[110px]">
              {nugget.category}
            </span>
            {nugget.detail && (
              <span className="ml-auto text-[10px] text-white/40 group-hover:text-white/70 transition-colors font-sans shrink-0">
                Voir +
              </span>
            )}
          </button>

          {/* Titre concept — cliquable → détail */}
          {nugget.type === "concept" && (
            <h2
              onClick={openSheet}
              className="text-2xl sm:text-3xl font-sans font-semibold text-[#F6F1E5] mb-3 leading-tight cursor-pointer active:opacity-70 transition-opacity"
            >
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

        {/* ── Barre de progression audio ─────────────────────────────────── */}
        {(audioState.status === "playing" || audioState.status === "paused") && (
          <div className="absolute bottom-0 left-0 right-0 z-20 h-0.5 bg-white/10">
            <div
              className="h-full bg-sand-500 transition-all duration-300"
              style={{
                width: `${(audioState.currentTime / (audioState.duration || 1)) * 100}%`,
              }}
            />
          </div>
        )}

        {/* ── Rail d'actions ────────────────────────────────────────────────── */}
        <div className="absolute right-3 bottom-safe-rail flex flex-col items-center gap-4">
          {/* Bouton audio — en tête du rail */}
          {audioEnabled && (
            <ActionBtn
              onClick={handleAudioToggle}
              active={audioState.status === "playing"}
              activeClass={config.accentClass}
              label="Audio radio"
            >
              {audioState.status === "loading" ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : audioState.status === "playing" ? (
                <Pause className="w-6 h-6 fill-current scale-110" />
              ) : audioState.status === "error" ? (
                <Radio className="w-6 h-6 opacity-30" />
              ) : (
                <Radio className="w-6 h-6" />
              )}
              <span className="text-[10px] text-white/50">
                {audioState.status === "loading"
                  ? "IA..."
                  : audioState.status === "playing"
                  ? "Pause"
                  : audioState.status === "error"
                  ? "Erreur"
                  : "Écouter"}
              </span>
            </ActionBtn>
          )}

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
              className={cn(
                "absolute inset-0 z-30 bg-black/50 backdrop-blur-[3px]",
                sheetClosing ? "scrim-out" : "scrim-in"
              )}
              onClick={closeSheet}
            />
            <div
              className={cn(
                "absolute bottom-0 left-0 right-0 z-40 flex flex-col max-h-[90dvh] overflow-hidden",
                sheetClosing ? "sheet-slide-down" : "sheet-slide-up"
              )}
              style={{
                background: "linear-gradient(175deg, #2C2518 0%, #1A1510 55%, #0F0D0A 100%)",
                borderRadius: "28px 28px 0 0",
                borderTop: `1px solid ${config.orbs[0]}30`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle — cliquable pour fermer */}
              <button
                onClick={closeSheet}
                aria-label="Fermer"
                className="flex justify-center pt-3 pb-2 shrink-0 w-full active:opacity-60 transition-opacity"
              >
                <div className="w-9 h-[4px] rounded-full" style={{ background: "rgba(255,255,255,0.18)" }} />
              </button>

              {/* Header */}
              <div className="relative shrink-0 px-6 pt-1 pb-4">
                <button
                  onClick={closeSheet}
                  className="absolute top-1 right-4 p-2 rounded-full transition-colors z-10"
                  style={{ color: "rgba(255,255,255,0.25)" }}
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="relative z-10">
                  <span
                    className="inline-flex items-center gap-1 text-[9px] font-bold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full border mb-3"
                    style={{ color: config.orbs[0], borderColor: `${config.orbs[0]}50` }}
                  >
                    <Icon className="w-2.5 h-2.5" />
                    {config.label}
                  </span>

                  <h2
                    className="font-sans font-black leading-[1.12] pr-8"
                    style={{ fontSize: "clamp(1.35rem, 5vw, 1.8rem)", letterSpacing: "-0.025em", color: "#F2EBD8" }}
                  >
                    {nugget.title}
                  </h2>

                  <p className="mt-2 text-[11px] font-sans" style={{ color: "rgba(240,234,216,0.68)" }}>
                    {nugget.sourceTitle}
                    {nugget.author && nugget.author !== "Auteur inconnu" && (
                      <em style={{ color: "rgba(240,234,216,0.50)" }}> — {nugget.author}</em>
                    )}
                  </p>
                </div>
              </div>

              {/* Tab bar */}
              <div className="shrink-0 px-5 pb-1">
                <div
                  className="flex rounded-[18px] p-1 gap-0.5"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  {([
                    { id: 0 as const, emoji: "📌", label: "Résumé" },
                    { id: 1 as const, emoji: "📖", label: "Comprendre" },
                    { id: 2 as const, emoji: "🎯", label: "Appliquer" },
                  ] as const).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={(e) => { e.stopPropagation(); setActiveTab(tab.id); }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[14px] text-[11.5px] font-semibold transition-all active:scale-95"
                      style={activeTab === tab.id ? {
                        background: `${config.orbs[0]}20`,
                        color: config.orbs[0],
                        boxShadow: `0 0 0 1px ${config.orbs[0]}22`,
                      } : {
                        color: "rgba(240,234,216,0.32)",
                      }}
                    >
                      <span className="text-[13px] leading-none">{tab.emoji}</span>
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="h-px mx-6 mt-3 mb-0 shrink-0" style={{ background: "rgba(255,255,255,0.05)" }} />

              {/* Content scrollable */}
              <div
                className="overflow-y-auto flex-1 px-6 pt-5 pb-safe-feed"
                onTouchMove={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              >
                <SheetContent nugget={nugget} config={config} audioScript={audioScript} activeTab={activeTab} />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
);

NuggetCard.displayName = "NuggetCard";

// ─── SheetContent & helpers ───────────────────────────────────────────────────

interface SheetContentProps {
  nugget: Nugget;
  config: typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG];
  audioScript: DialogueTurn[];
  activeTab: 0 | 1 | 2;
}

function SheetContent({ nugget, config, activeTab }: SheetContentProps) {
  let detailText = "";
  let exampleText = "";
  if (nugget.detail) {
    for (const part of nugget.detail.split("\n\n")) {
      if (part.startsWith("*Exemple")) {
        exampleText = part.replace(/^\*|\*$/g, "").replace(/^Exemple\s*:\s*/i, "").trim();
      } else {
        detailText += (detailText ? "\n\n" : "") + part;
      }
    }
  }

  // ── Tab 0: Résumé ──────────────────────────────────────────────────────────
  if (activeTab === 0) {
    return (
      <div className="pb-8">
        {nugget.type === "quote" ? (
          <blockquote
            className="relative pl-5"
            style={{ borderLeft: `3px solid ${config.orbs[0]}80` }}
          >
            <p className="text-[19px] font-serif italic leading-[1.9]" style={{ color: "#F0EAD8" }}>
              « {nugget.body} »
            </p>
          </blockquote>
        ) : (
          <p className="text-[18px] font-serif leading-[1.9]" style={{ color: "#F0EAD8" }}>
            {nugget.body}
          </p>
        )}
      </div>
    );
  }

  // ── Tab 1: Comprendre ──────────────────────────────────────────────────────
  if (activeTab === 1) {
    return (
      <div className="pb-8">
        {detailText ? (
          <div className="space-y-4">
            <RichText text={detailText} />
          </div>
        ) : (
          <SheetEmptyState label="Pas d'approfondissement disponible pour ce nugget." />
        )}
      </div>
    );
  }

  // ── Tab 2: Appliquer ───────────────────────────────────────────────────────
  return (
    <div className="pb-8">
      {exampleText ? (
        <div
          className="rounded-2xl px-5 py-5"
          style={{
            background: `${config.orbs[0]}0D`,
            borderLeft: `3px solid ${config.orbs[0]}55`,
          }}
        >
          <p className="text-[13px] font-bold uppercase tracking-widest mb-3" style={{ color: `${config.orbs[0]}90` }}>
            Cas pratique
          </p>
          <p className="text-[15px] font-sans italic leading-[1.85]" style={{ color: "#D8D0C4" }}>
            {exampleText}
          </p>
        </div>
      ) : (
        <SheetEmptyState label="Pas d'exemple pratique disponible pour ce nugget." />
      )}
    </div>
  );
}

function SheetEmptyState({ label }: { label: string }) {
  return (
    <div className="py-10 flex flex-col items-center gap-3">
      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)" }}>
        <span className="text-lg">✦</span>
      </div>
      <p className="text-[13px] text-center max-w-[220px] leading-relaxed" style={{ color: "rgba(240,234,216,0.28)" }}>
        {label}
      </p>
    </div>
  );
}

// ─── Rich text renderer (markdown-lite) ──────────────────────────────────────

function RichText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return (
    <>
      {paragraphs.map((para, i) => {
        const lines = para.split("\n").map(l => l.trim()).filter(Boolean);

        // Liste à puces
        if (lines.length > 1 && lines.every(l => /^[-•*]\s/.test(l))) {
          return (
            <ul key={i} className="space-y-2.5 my-1">
              {lines.map((line, j) => (
                <li key={j} className="flex gap-3 items-start">
                  <span className="text-sand-500/70 mt-[5px] text-xs shrink-0">▸</span>
                  <span className="text-[14px] text-[#E2DDD3] leading-[1.75] font-sans">
                    {renderInline(line.replace(/^[-•*]\s+/, ""))}
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        // Liste numérotée
        if (lines.length > 1 && lines.every(l => /^\d+[.)]\s/.test(l))) {
          return (
            <ol key={i} className="space-y-2.5 my-1">
              {lines.map((line, j) => (
                <li key={j} className="flex gap-3 items-start">
                  <span className="text-sand-500/70 text-[11px] font-bold shrink-0 mt-[5px] w-4 text-right">
                    {j + 1}.
                  </span>
                  <span className="text-[14px] text-[#E2DDD3] leading-[1.75] font-sans">
                    {renderInline(line.replace(/^\d+[.)]\s+/, ""))}
                  </span>
                </li>
              ))}
            </ol>
          );
        }

        // Citation (ligne commençant par >)
        if (lines.every(l => l.startsWith(">"))) {
          const content = lines.map(l => l.replace(/^>\s?/, "")).join(" ");
          return (
            <blockquote key={i} className="border-l-2 border-sand-500/40 pl-4 py-0.5 my-1">
              <p className="text-[14px] italic text-sand-200/80 leading-[1.75] font-serif">
                {renderInline(content)}
              </p>
            </blockquote>
          );
        }

        // Paragraphe normal
        return (
          <p key={i} className="text-[14.5px] text-[#E2DDD3] leading-[1.85] font-sans">
            {renderInline(para)}
          </p>
        );
      })}
    </>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i} className="text-[#EDE8DE] italic">{part.slice(1, -1)}</em>;
    return part;
  });
}

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

// ─── Visualizer audio circulaire (Canvas procédural) ─────────────────────────

const CircularVisualizer = React.memo(function CircularVisualizer({
  isPlaying,
  isLoading,
  colors,
  isActive,
}: {
  isPlaying: boolean;
  isLoading: boolean;
  colors: string[];
  isActive: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const SIZE = 220;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    const toRgba = (hex: string, a: number) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, SIZE, SIZE);

      const RING_R = 88;
      const N = 36;
      const speed = isPlaying ? 0.35 : 0.07;

      // Anneau de particules
      for (let i = 0; i < N; i++) {
        const angle = (i / N) * Math.PI * 2 + t * speed;
        const wobble = isPlaying
          ? Math.sin(t * 2.8 + i * 0.6) * 9
          : Math.sin(t * 0.4 + i * 0.4) * 3;
        const pr = RING_R + wobble;
        const x = cx + Math.cos(angle) * pr;
        const y = cy + Math.sin(angle) * pr;
        const alpha = isPlaying
          ? 0.25 + Math.abs(Math.sin(t * 1.8 + i * 0.5)) * 0.55
          : 0.1 + Math.abs(Math.sin(t * 0.25 + i * 0.3)) * 0.12;
        const size = isPlaying ? 1.4 + Math.abs(Math.sin(t * 3.5 + i)) * 1.8 : 1.1;

        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = toRgba(colors[i % colors.length], alpha);
        ctx.fill();
      }

      // Contour anneau
      ctx.beginPath();
      ctx.arc(cx, cy, RING_R, 0, Math.PI * 2);
      ctx.strokeStyle = toRgba(colors[0], isPlaying ? 0.18 : 0.07);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Lueur centrale
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, RING_R);
      glow.addColorStop(0, toRgba(colors[0], isPlaying ? 0.14 : 0.04));
      glow.addColorStop(1, toRgba(colors[0], 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, RING_R, 0, Math.PI * 2);
      ctx.fill();

      // Barres centrales
      const NUM_BARS = 9;
      const BAR_W = 3.5;
      const MAX_H = 36;
      const GAP = 6;
      const totalW = NUM_BARS * (BAR_W + GAP) - GAP;
      const bx0 = cx - totalW / 2;

      for (let i = 0; i < NUM_BARS; i++) {
        let h: number;
        if (isLoading) {
          h = MAX_H * (0.12 + Math.abs(Math.sin(t * 2.5 + i * 0.8)) * 0.35);
        } else if (isPlaying) {
          const w1 = Math.sin(t * 5.2 + i * 1.1) * 0.5 + 0.5;
          const w2 = Math.sin(t * 3.1 + i * 0.75) * 0.5 + 0.5;
          h = MAX_H * (0.06 + (w1 * 0.6 + w2 * 0.4) * 0.94);
        } else {
          h = MAX_H * 0.05;
        }

        const x = bx0 + i * (BAR_W + GAP);
        const y = cy - h / 2;
        const r = BAR_W / 2;

        const grad = ctx.createLinearGradient(x, y, x, y + h);
        grad.addColorStop(0, toRgba(colors[0], 0.95));
        grad.addColorStop(1, toRgba(colors[0], 0.28));
        ctx.fillStyle = grad;

        ctx.beginPath();
        if (h > r * 2) {
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + BAR_W - r, y);
          ctx.arcTo(x + BAR_W, y, x + BAR_W, y + r, r);
          ctx.lineTo(x + BAR_W, y + h - r);
          ctx.arcTo(x + BAR_W, y + h, x + BAR_W - r, y + h, r);
          ctx.lineTo(x + r, y + h);
          ctx.arcTo(x, y + h, x, y + h - r, r);
          ctx.lineTo(x, y + r);
          ctx.arcTo(x, y, x + r, y, r);
        } else {
          ctx.arc(x + BAR_W / 2, cy, Math.max(h / 2, 0.5), 0, Math.PI * 2);
        }
        ctx.closePath();
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame((ts) => draw(ts / 1000));
    };

    rafRef.current = requestAnimationFrame((ts) => draw(ts / 1000));
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, isLoading, colors]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none"
      style={{ opacity: isActive ? 1 : 0.35, transition: "opacity 0.6s ease" }}
    />
  );
});
