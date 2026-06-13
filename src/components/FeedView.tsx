import React, { useEffect, useRef, useState, useCallback } from "react";
import { Nugget, SummaryData, TasteProfile, FeedSignal } from "../types";
import { buildNuggets } from "../lib/nuggets";
import { rankFeed, nextPage } from "../lib/feed";
import { embedNuggets } from "../lib/embeddings";
import { loadProfile, saveProfile, applyImpression, recordAction, markSeen } from "../lib/taste";
import { ImpressionTracker, SessionTaste, engagementScore } from "../lib/engagement";
import { getOrGenerateAudio, enqueuePrefetch, getCachedAudioIds } from "../lib/nuggetAudio";
import { audioController } from "../lib/audioController";
import { NuggetCard } from "./NuggetCard";
import { Sparkles, BookOpen, Loader2, Volume2, VolumeX, Heart } from "lucide-react";
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

// Re-rank intra-session : déclenché après N impressions, ou immédiatement
// si un signal fort (|engagement| ≥ seuil) vient d'être émis.
const RERANK_EVERY_N_IMPRESSIONS = 3;
const RERANK_STRONG_SIGNAL = 0.5;

/**
 * Garantit que la 1re carte du feed a son audio déjà en cache (lecture
 * instantanée à l'ouverture). Le reste du classement par goût est intact —
 * le bonus cache est déjà intégré au score par le ranker.
 */
function ensureFirstPlayable(ranked: Nugget[], cached: Set<string>): Nugget[] {
  if (cached.size === 0 || ranked.length === 0 || cached.has(ranked[0].id)) return ranked;
  const idx = ranked.findIndex((n) => cached.has(n.id));
  if (idx === -1) return ranked;
  const out = [...ranked];
  const [hit] = out.splice(idx, 1);
  out.unshift(hit);
  return out;
}

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
  // Nuggets dont l'audio est déjà généré (cache L1 + manifest Firestore) → cache-first
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());

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
  // Burst cœur du double-tap (incrémenté à chaque double-tap → relance l'anim)
  const [likeBurst, setLikeBurst] = useState(0);
  // Détection du double-tap (1er tap en attente)
  const tapTimerRef = useRef<number | null>(null);
  // Le 1er geste (pointerdown) déverrouille l'audio ; on avale le "click" qui
  // l'accompagne pour qu'il ne rebascule pas play/pause juste après.
  const unlockGestureRef = useRef(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Trackers d'impression par carte visible (id → tracker)
  const trackers = useRef<Map<string, ImpressionTracker>>(new Map());
  // Goût court-terme de la session (volatile, reset au reload)
  const sessionRef = useRef<SessionTaste | null>(null);
  if (sessionRef.current === null) sessionRef.current = new SessionTaste();
  // Impressions depuis le dernier re-rank (throttle)
  const impressionsSinceRank = useRef(0);
  // Miroirs pour le re-rank intra-session (éviter les closures périmées)
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const embeddingsRef = useRef(embeddings);
  embeddingsRef.current = embeddings;
  const cachedIdsRef = useRef(cachedIds);
  cachedIdsRef.current = cachedIds;
  const itemsRef = useRef(items);
  itemsRef.current = items;

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

  // ─── Index des clips déjà en cache (pour le ré-ordonnancement cache-first) ──

  useEffect(() => {
    let cancelled = false;
    getCachedAudioIds(uid)
      .then((ids) => { if (!cancelled) setCachedIds(ids); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [uid, library]);

  // ─── Construction du pool de nuggets ────────────────────────────────────────

  useEffect(() => {
    if (library.length === 0) {
      setItems([]);
      setRankedPool([]);
      return;
    }

    const allNuggets = buildNuggets(library);
    const ranked = ensureFirstPlayable(
      rankFeed(allNuggets, embeddings, profile, {
        session: sessionRef.current ?? undefined,
        cachedIds,
        seed: Date.now(),
      }),
      cachedIds
    );
    setRankedPool(ranked);

    const first = nextPage(ranked, 0, PAGE_SIZE);
    setItems(first.items);
    setOffset(first.nextOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, cachedIds]); // re-seed quand la bibliothèque ou les clips en cache changent

  // ─── Réchauffe des 3 premières cartes dès qu'elles sont prêtes ─────────────
  // Indépendant de l'IntersectionObserver et du unlock → la 1re carte est
  // préchargée avant même le 1er tap (corrige « le 1er clip ne charge pas »).

  useEffect(() => {
    if (items.length === 0) return;
    // Au montage (cache local vide la 1re session), on prend de l'avance : 4
    // cartes préchargées d'emblée pour que les 3e/4e soient prêtes avant qu'on
    // les atteigne. Avec Supertonic ce ne sont que des téléchargements Storage
    // (audio déjà généré) → pas de coût TTS, juste du réseau anticipé.
    enqueuePrefetch(items.slice(0, 4), uid);
  }, [items, uid]);

  // ─── Calcul des embeddings en background ────────────────────────────────────

  useEffect(() => {
    if (library.length === 0) return;
    let cancelled = false;

    // Le modèle e5-small fait ~30 Mo : on diffère son téléchargement pour ne
    // pas saturer la bande passante mobile au détriment des vidéos/audio.
    // Le feed reste fonctionnel entre-temps (ranking heuristique sans embeddings).
    const start = () => {
      if (cancelled) return;
      const allNuggets = buildNuggets(library);

      setIsModelLoading(true);
      setEmbProgress({ done: 0, total: allNuggets.length });

      embedNuggets(allNuggets, (done, total) => {
        if (!cancelled) setEmbProgress({ done, total });
      })
        .then((embs) => {
          if (cancelled) return;
          setEmbeddings(embs);
          // Re-rank avec les vrais embeddings (1re carte jouable préservée)
          const newRanked = ensureFirstPlayable(
            rankFeed(allNuggets, embs, profile, {
              session: sessionRef.current ?? undefined,
              cachedIds,
              seed: Date.now(),
            }),
            cachedIds
          );
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
          if (cancelled) return;
          setIsModelLoading(false);
          setEmbProgress(null);
        });
    };

    const ric = (window as typeof window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const handle = ric ? ric(start, { timeout: 6000 }) : window.setTimeout(start, 4000);
    return () => {
      cancelled = true;
      const cic = (window as typeof window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (ric && cic) cic(handle); else clearTimeout(handle as number);
    };
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

  // ─── Tracking audio : alimente le tracker de la carte en cours d'écoute ────
  // Le ratio d'écoute réel (et les réécoutes) est un signal d'intérêt bien plus
  // fiable que le simple temps à l'écran.

  useEffect(() => {
    return audioController.subscribe((currentId, state) => {
      if (!currentId) return;
      if (state.status === "playing" || state.status === "paused") {
        trackers.current.get(currentId)?.noteAudioProgress(state.currentTime, state.duration);
      } else if (state.status === "ended") {
        trackers.current.get(currentId)?.noteAudioEnded();
        // Auto-advance : la narration finie → scroll vers la carte suivante.
        // L'IntersectionObserver l'activera et lancera son audio automatiquement.
        const idx = itemsRef.current.findIndex((n) => n.id === currentId);
        const next = idx >= 0 ? itemsRef.current[idx + 1] : undefined;
        if (next) cardRefs.current.get(next.id)?.scrollIntoView({ behavior: "smooth" });
      }
    });
  }, []);

  // ─── Flush des impressions en cours quand on quitte le feed ────────────────
  // À l'unmount, setState ne s'exécute plus → on applique et persiste direct.

  useEffect(() => {
    return () => {
      let p = profileRef.current;
      for (const [id, tracker] of trackers.current) {
        const nugget = itemsRef.current.find((n) => n.id === id);
        if (!nugget) continue;
        p = applyImpression(p, nugget, embeddingsRef.current.get(id) ?? [], tracker.finish());
      }
      trackers.current.clear();
      if (p !== profileRef.current) {
        saveProfile(p);
        onProfileChange?.(p);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Re-rank intra-session ──────────────────────────────────────────────────
  // Comme TikTok : le feed s'adapte PENDANT le scroll. Les cartes déjà affichées
  // restent en place ; tout ce qui n'est pas encore monté à l'écran est reclassé
  // avec le profil et le goût de session à jour.

  const rerankUpcoming = useCallback(() => {
    const allNuggets = buildNuggets(library);
    const displayed = new Set(itemsRef.current.map((n) => n.id));
    let upcoming = rankFeed(allNuggets, embeddingsRef.current, profileRef.current, {
      session: sessionRef.current ?? undefined,
      cachedIds: cachedIdsRef.current,
      excludeIds: displayed,
      seed: Date.now(),
    });
    // Tout a déjà été affiché → reboucler sur le pool complet (re-classé)
    if (upcoming.length === 0) {
      upcoming = rankFeed(allNuggets, embeddingsRef.current, profileRef.current, {
        session: sessionRef.current ?? undefined,
        cachedIds: cachedIdsRef.current,
        seed: Date.now(),
      });
    }
    setRankedPool(upcoming);
    setOffset(0);
    impressionsSinceRank.current = 0;
  }, [library]);

  // ─── Fin d'impression : apprendre du passage de la carte ───────────────────

  const finishImpression = useCallback((nugget: Nugget) => {
    const tracker = trackers.current.get(nugget.id);
    if (!tracker) return;
    trackers.current.delete(nugget.id);

    const impression = tracker.finish();
    const score = engagementScore(impression);
    const emb = embeddingsRef.current.get(nugget.id) ?? [];

    setProfile((p) => applyImpression(p, nugget, emb, impression));
    sessionRef.current?.record(nugget, emb, score);

    impressionsSinceRank.current++;
    if (
      Math.abs(score) >= RERANK_STRONG_SIGNAL ||
      impressionsSinceRank.current >= RERANK_EVERY_N_IMPRESSIONS
    ) {
      rerankUpcoming();
    }
  }, [setProfile, rerankUpcoming]);

  // ─── Impressions + audio (IntersectionObserver par carte) ──────────────────

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
            // Carte entrée → démarrer le tracker d'impression
            if (!trackers.current.has(nugget.id)) {
              trackers.current.set(nugget.id, new ImpressionTracker(nugget));
            }
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

            // ── Préchargement : carte active + fenêtre glissante N+3 ───────
            // La carte active est préchargée SANS condition de unlock : ainsi,
            // au 1er tap, getOrGenerateAudio renvoie depuis le cache (lecture
            // immédiate au lieu d'une génération à froid). Fenêtre = 4 (active +
            // 3 suivantes) : avec Supertonic l'audio est pré-généré → le prefetch
            // n'est qu'un téléchargement Storage, donc on prend large pour que la
            // carte N+2/N+3 soit prête avant qu'on l'atteigne (réseau mobile lent).
            enqueuePrefetch(items.slice(idx, idx + 4), uid);
          } else {
            // Carte sortie → condenser l'impression et apprendre
            finishImpression(nugget);

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
      // Toute action explicite nourrit l'impression en cours (l'apprentissage
      // vectoriel se fait à la sortie de carte, avec le contexte complet)
      const tracker = trackers.current.get(nuggetId);
      if (signal === "like" || signal === "save" || signal === "share" || signal === "expand" || signal === "open") {
        tracker?.noteAction(signal);
      }
      // Like/save mettent aussi à jour les listes immédiatement (état des icônes)
      if (signal === "like" || signal === "save") {
        setProfile((p) => recordAction(p, nuggetId, signal));
      }
    },
    [setProfile]
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

  // Tap simple (différé de ~260ms pour laisser une chance au 2e tap) : unlock /
  // play / pause sur la carte active.
  const handleSingleTap = useCallback(() => {
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

  // 1er contact (pointerdown) : déverrouille l'autoplay AU PLUS TÔT et lance la
  // carte active immédiatement — sans attendre le debounce de 260 ms.
  const handleFirstGesture = useCallback(() => {
    if (audioUnlocked) return;
    audioController.unlock();
    setAudioUnlocked(true);
    unlockGestureRef.current = true;
    window.setTimeout(() => { unlockGestureRef.current = false; }, 400);
    if (!audioEnabled) return;
    const active = items[activeIdx];
    if (active) {
      getOrGenerateAudio(active, uid)
        .then(({ url }) => audioController.play(active.id, url))
        .catch(() => {});
    }
  }, [audioUnlocked, audioEnabled, items, activeIdx, uid]);

  // Click container : 1 tap = play/pause (différé), 2 taps rapides = like (TikTok).
  const handleContainerClick = useCallback(() => {
    // Click accompagnant le geste de déverrouillage → déjà traité par pointerdown
    if (unlockGestureRef.current) { unlockGestureRef.current = false; return; }
    if (tapTimerRef.current !== null) {
      // 2e tap dans la fenêtre → double-tap = like
      window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      const active = items[activeIdx];
      if (active) {
        handleSignal(active.id, "like");
        setLikeBurst((n) => n + 1);
      }
      return;
    }
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null;
      handleSingleTap();
    }, 260);
  }, [items, activeIdx, handleSignal, handleSingleTap]);

  return (
    <div
      ref={containerRef}
      onPointerDown={handleFirstGesture}
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


      {/* Cœur de double-tap (like) — clé = compteur → relance l'animation */}
      {likeBurst > 0 && (
        <div key={likeBurst} className="fixed inset-0 z-30 flex items-center justify-center pointer-events-none">
          <Heart className="w-28 h-28 text-red-500 fill-red-500 like-burst drop-shadow-2xl" />
        </div>
      )}

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
