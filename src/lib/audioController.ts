/**
 * Singleton AudioController.
 *
 * - Un seul HTMLAudioElement à la fois.
 * - unlock() à appeler au 1er geste utilisateur (contourne l'autoplay policy).
 * - subscribe(cb) → reçoit chaque changement d'état audio.
 * - play(nuggetId, url) → joue ; si un autre est en cours, le stop d'abord.
 */

import { AudioState } from "../types";

type Listener = (nuggetId: string | null, state: AudioState) => void;

class AudioController {
  private el: HTMLAudioElement = new Audio();
  private _currentId: string | null = null;
  private _unlocked = false;
  private listeners: Set<Listener> = new Set();

  constructor() {
    // Abonnements internes pour diffuser l'état
    this.el.addEventListener("timeupdate", () => this.emit());
    this.el.addEventListener("ended", () => {
      this.emit({ status: "ended" });
    });
    this.el.addEventListener("error", () => {
      this.emit({ status: "error", message: this.el.error?.message ?? "Erreur audio" });
    });
    this.el.addEventListener("waiting", () => {
      this.emit({ status: "loading" });
    });
    this.el.addEventListener("playing", () => this.emit());
    this.el.addEventListener("pause", () => this.emit());
  }

  get currentId() {
    return this._currentId;
  }

  get unlocked() {
    return this._unlocked;
  }

  /** Appeler au premier tap sur l'écran — débloque l'autoplay */
  unlock() {
    if (this._unlocked) return;
    this._unlocked = true;
    // Jouer + mettre en pause immédiatement pour "déverrouiller" le contexte audio
    const dummy = new Audio();
    dummy.play().catch(() => {});
    dummy.pause();
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(overrideState?: AudioState) {
    const state: AudioState = overrideState ?? this.currentState();
    this.listeners.forEach((cb) => cb(this._currentId, state));
  }

  private currentState(): AudioState {
    const el = this.el;
    if (el.readyState === 0 && !el.src) return { status: "idle" };
    if (el.ended) return { status: "ended" };
    if (el.paused && el.readyState < 3) return { status: "loading" };
    if (el.paused) return { status: "paused", currentTime: el.currentTime, duration: el.duration || 0 };
    return { status: "playing", currentTime: el.currentTime, duration: el.duration || 0 };
  }

  /** Joue le nugget donné. Stop l'audio précédent si différent. */
  async play(nuggetId: string, url: string) {
    if (!this._unlocked) return; // autoplay bloqué

    if (this._currentId === nuggetId) {
      // Même nugget : toggle pause/play
      if (this.el.paused) {
        await this.el.play().catch(console.warn);
      } else {
        this.el.pause();
      }
      return;
    }

    // Nouveau nugget
    this.el.pause();
    this._currentId = nuggetId;
    this.el.src = url;
    this.el.currentTime = 0;
    this.emit({ status: "loading" });
    await this.el.play().catch((e) => {
      console.warn("[AudioController] play failed:", e);
      this.emit({ status: "error", message: String(e) });
    });
  }

  pause() {
    this.el.pause();
  }

  stop() {
    this.el.pause();
    this.el.src = "";
    this._currentId = null;
    this.emit({ status: "idle" });
  }

  /** Revient au début du clip courant */
  restart() {
    this.el.currentTime = 0;
    this.el.play().catch(console.warn);
  }
}

// Singleton exporté
export const audioController = new AudioController();
