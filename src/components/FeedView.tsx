import React, { useEffect, useRef, useState, useCallback } from "react";
import { Nugget, SummaryData, TasteProfile, FeedSignal } from "../types";
import { buildNuggets } from "../lib/nuggets";
import { rankFeed, nextPage, DWELL_THRESHOLD_MS } from "../lib/feed";
import { embedNuggets } from "../lib/embeddings";
import { loadProfile, saveProfile, updateProfile, markSeen } from "../lib/taste";
import { getOrGenerateAudio, prefetchAudio } from "../lib/nuggetAudio";
import { audioController } from "../lib/audioController";
import { NuggetCard } from "./NuggetCard";
import { Sparkles, BookOpen, Loader2, Volume2, VolumeX } from "lucide-react";
import { cn } from "../lib/utils";

interface FeedViewProps {
  library: SummaryData[];
  onOpenSource: (item: SummaryData) => void;
  /** appelé depuis App quand le profil change (pour sync Firestore etc.) */
  onProfileChange?: (profile: TasteProfile) => void;
  /** uid Firebase de l'utilisateur connecté (null = local) */
  uid?: string | null;
}

const PAGE_SIZE = 8;

/**
 * Feed vertical plein-écran type TikTok.
 * - Snap-scroll CSS (pas de lib externe)
 * - IntersectionObserver pour dwell/skip + append auto
 * - Embeddings calculés en background ; ranking actif dès qu'ils sont prêts
 */
export function FeedView({ library, onOpenSource, onProfileChange, uid = null }: FeedViewProps) {
  const [items, setItems] = useState<Nugget[]>([]);
  const [offset, setOffset] = useState(0);
  const [rankedPool, setRankedPool] = useState<Nugget[]>([]);
  const [embeddings, setEmbeddings] = useState<Map<string, number[]>>(new Map());
  const [profile, setProfileState] = useState<TasteProfile>(loadProfile);
  const [embProgress, setEmbProgress] = useState<{ done: number; total: number } | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(false);

  // ─── Audio state ─────────────────────────────────────────────────────────────
  const [audioEnabled, setAudioEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("ilm-audio-enabled") !== "false"; } catch { return true; }
  });
  // Initialiser depuis le singleton — persiste si l'utilisateur a déjà déverrouillé dans la session
  const [audioUnlocked, setAudioUnlocked] = useState(() => audioController.unlocked);
  // Index de la carte active dans items[]
  const [activeIdx, setActiveIdx] = useState<number>(0);
  // Scripts de dialogue reçus après génération — Map<nuggetId, turns[]>
  const [audioScripts, setAudioScripts] = useState<Map<string, import("../types").DialogueTurn[]>>(new Map());

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Chronomètres de dwell par carte (id → startTime)
  const dwellTimers = useRef<Map<string, number>>(new Map());

  // ─── Profil helpers ──────────────────────────────────────────────────────────

  const persistProfile = useCallback((p: TasteProfile) => {
    saveProfile(p);
    onProfileChange?.(p);
  }, [onProfileChange]);

  const setProfile = useCallback((updater: (prev: TasteProfile) => TasteProfile) => {
    setProfileState((prev) => {
      const next = updater(prev);
      persistProfile(next);
      return next;
    });
  }, [persistProfile]);

  // ─── Construction du pool de nuggets ────────────────────────────────────────

  useEffect(() => {
    if (library.length === 0) {
      setItems([]);
      setRankedPool([]);
      return;
    }

    const allNuggets = buildNuggets(library);
    const ranked = rankFeed(allNuggets, embeddings, profile, Date.now());
    setRankedPool(ranked);

    const first = nextPage(ranked, 0, PAGE_SIZE);
    setItems(first.items);
    setOffset(first.nextOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]); // re-seed seulement quand la bibliothèque change

  // ─── Calcul des embeddings en background ────────────────────────────────────

  useEffect(() => {
    if (library.length === 0) return;
    const allNuggets = buildNuggets(library);

    setIsModelLoading(true);
    setEmbProgress({ done: 0, total: allNuggets.length });

    embedNuggets(allNuggets, (done, total) => {
      setEmbProgress({ done, total });
    })
      .then((embs) => {
        setEmbeddings(embs);
        // Re-rank avec les vrais embeddings
        const newRanked = rankFeed(allNuggets, embs, profile, Date.now());
        setRankedPool(newRanked);
        // Garder les cartes déjà visibles, compléter si besoin
        setItems((prev) => {
          const seen = new Set(prev.map((n) => n.id));
          const extras = newRanked
            .filter((n) => !seen.has(n.id))
            .slice(0, Math.max(0, PAGE_SIZE - prev.length));
          return [...prev, ...extras];
        });
      })
      .catch((e) => console.warn("[FeedView] embeddings error", e))
      .finally(() => {
        setIsModelLoading(false);
        setEmbProgress(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);

  // ─── Append automatique (IntersectionObserver sentinel) ────────────────────

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setItems((prev) => {
            const page = nextPage(rankedPool, offset, PAGE_SIZE);
            setOffset(page.nextOffset);
            // Dédoublonner
            const seen = new Set(prev.map((n) => n.id));
            const fresh = page.items.filter((n) => !seen.has(n.id));
            return [...prev, ...fresh];
          });
        }
      },
      { threshold: 0.1 }
    );

    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [rankedPool, offset]);

  // ─── Dwell tracking + audio (IntersectionObserver par carte) ────────────────

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    items.forEach((nugget, idx) => {
      const el = cardRefs.current.get(nugget.id);
      if (!el) return;

      const obs = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;

          if (entry.isIntersecting) {
            // Carte entrée → démarrer chrono
            dwellTimers.current.set(nugget.id, Date.now());
            // Marquer comme vu
            setProfile((p) => markSeen(p, nugget.id));
            setActiveIdx(idx);

            // ── Audio : lecture de la carte active ──────────────────────────
            // Ne pas auto-jouer si un audio est déjà en pause pour une autre carte
            // (cas retour depuis bibliothèque — App.tsx s'occupe de la reprise)
            const hasPausedElsewhere = !!audioController.currentId && audioController.currentId !== nugget.id;
            if (audioEnabled && audioUnlocked && !hasPausedElsewhere) {
              getOrGenerateAudio(nugget, uid)
                .then(({ url, script }) => {
                  // Stocker le script pour le transmettre à la NuggetCard
                  if (script.length > 0) {
                    setAudioScripts((prev) => {
                      const next = new Map(prev);
                      next.set(nugget.id, script);
                      return next;
                    });
                  }
                  audioController.play(nugget.id, url);
                })
                .catch((e) => console.warn("[FeedView] audio play failed:", e));
            }

            // ── Préchargement des N+1 / N+2 ────────────────────────────────
            const next1 = items[idx + 1];
            const next2 = items[idx + 2];
            if (next1) prefetchAudio(next1, uid);
            if (next2) prefetchAudio(next2, uid);
          } else {
            // Carte sortie → émettre signal dwell ou skip
            const start = dwellTimers.current.get(nugget.id);
            if (start !== undefined) {
              const dwell = Date.now() - start;
              const signal: FeedSignal = dwell >= DWELL_THRESHOLD_MS ? "dwell" : "skip";
              const emb = embeddings.get(nugget.id) ?? [];
              setProfile((p) => updateProfile(p, emb, signal, nugget.id));
              dwellTimers.current.delete(nugget.id);
            }

            // Stopper l'audio si c'est la carte qui sort
            if (audioController.currentId === nugget.id) {
              audioController.stop();
            }
          }
        },
        { threshold: 0.7 } // 70% de la carte visible = considérée "active"
      );

      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [items, embeddings, audioEnabled, audioUnlocked, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Handler signaux depuis les cartes ──────────────────────────────────────

  const handleSignal = useCallback(
    (nuggetId: string, signal: FeedSignal) => {
      const emb = embeddings.get(nuggetId) ?? [];
      setProfile((p) => updateProfile(p, emb, signal, nuggetId));
    },
    [embeddings]
  );

  const handleOpenSource = useCallback(
    (sourceId: string) => {
      const item = library.find((l) => l.id === sourceId);
      if (item) onOpenSource(item);
    },
    [library, onOpenSource]
  );

  // ─── Rendu ──────────────────────────────────────────────────────────────────

  // Bibliothèque vide → onboarding
  if (library.length === 0) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="p-4 rounded-full bg-sand-500/10 border border-sand-500/20">
          <Sparkles className="w-8 h-8 text-sand-500" />
        </div>
        <div className="space-y-3">
          <h2 className="text-2xl font-serif text-sand-100">Ton feed est vide</h2>
          <p className="text-white/50 text-sm max-w-xs leading-relaxed">
            Téléverse ton premier document pour que le feed se remplisse de concepts, citations et
            leçons à réviser.
          </p>
        </div>
        <div className="flex items-center gap-2 text-white/30 text-xs">
          <BookOpen className="w-4 h-4" />
          Appuie sur <span className="font-bold text-sand-500">+</span> pour commencer
        </div>
      </div>
    );
  }

  const toggleAudio = useCallback(() => {
    const next = !audioEnabled;
    setAudioEnabled(next);
    try { localStorage.setItem("ilm-audio-enabled", String(next)); } catch {}
    if (!next) audioController.stop();
  }, [audioEnabled]);

  const handleContainerClick = useCallback(() => {
    if (!audioUnlocked) {
      // Premier tap : déverrouiller l'autoplay puis démarrer la carte active
      audioController.unlock();
      setAudioUnlocked(true);
      if (audioEnabled) {
        const active = items[activeIdx];
        if (active) {
          getOrGenerateAudio(active, uid)
            .then(({ url }) => audioController.play(active.id, url))
            .catch(() => {});
        }
      }
      return;
    }

    // Taps suivants : play/pause sur la carte active
    if (!audioEnabled) return;
    const active = items[activeIdx];
    if (!active) return;

    if (audioController.currentId === active.id) {
      // Même nugget en cours → toggle (url ignorée par le controller)
      audioController.play(active.id, "").catch(() => {});
    } else {
      // Pas d'audio actif → démarrer (depuis cache ou génération)
      getOrGenerateAudio(active, uid)
        .then(({ url }) => audioController.play(active.id, url))
        .catch(() => {});
    }
  }, [audioUnlocked, audioEnabled, items, activeIdx, uid]);

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className="h-[100dvh] w-full overflow-y-scroll snap-y snap-mandatory hide-scrollbar relative"
    >
      {/* Indicateur de chargement modèle (non-bloquant) */}
      {isModelLoading && embProgress && (
        <div className="fixed top-safe right-4 z-50 flex items-center gap-2 bg-ink-800/80 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1.5 text-xs text-white/50 pointer-events-none">
          <Loader2 className="w-3 h-3 animate-spin text-sand-500" />
          Algo IA {embProgress.done}/{embProgress.total}
        </div>
      )}

      {/* Toggle mute audio */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleAudio(); }}
        className="fixed top-safe left-4 z-50 flex items-center justify-center w-9 h-9 rounded-full bg-ink-800/70 backdrop-blur-sm border border-white/10 text-white/60 hover:text-white transition-colors"
        title={audioEnabled ? "Couper le son" : "Activer le son"}
        aria-label={audioEnabled ? "Couper le son" : "Activer le son"}
      >
        {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-white/30" />}
      </button>


      {/* Cartes */}
      {items.map((nugget, idx) => (
        <NuggetCard
          key={nugget.id}
          ref={(el) => {
            if (el) cardRefs.current.set(nugget.id, el);
            else cardRefs.current.delete(nugget.id);
          }}
          nugget={nugget}
          profile={profile}
          onSignal={handleSignal}
          onOpenSource={handleOpenSource}
          isActive={idx === activeIdx}
          uid={uid}
          audioEnabled={audioEnabled}
          audioScript={audioScripts.get(nugget.id) ?? []}
        />
      ))}

      {/* Sentinel pour append auto */}
      <div
        ref={sentinelRef}
        className="h-px w-full"
        aria-hidden
      />
    </div>
  );
}
