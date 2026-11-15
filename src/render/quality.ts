/**
 * Adaptive quality (GDD §2). Three levels. In automatic mode the level drops by itself when
 * frames stay slow for a few seconds; it never climbs back on its own, to avoid flickering
 * between levels. The user can also fix a level in the settings.
 */
import type { QualityChoice } from '../persist/storage';

export const QUALITY_LEVELS = ['alta', 'media', 'baja'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export interface QualityProfile {
  /** Upper bound for the device pixel ratio used by the renderer. */
  maxDensity: number;
  /** 0 = no caustics, 0.5 = simplified, 1 = full. */
  caustics: number;
  /** Multiplier for particle counts. */
  particles: number;
}

export interface QualityTuning {
  bajarSiMsPorFrame: number;
  segundosParaBajar: number;
  niveles: Record<QualityLevel, { densidadMax: number; causticas: number; particulas: number }>;
}

export class QualityManager {
  private current: QualityLevel = 'alta';
  private choice: QualityChoice = 'auto';
  private slowMs = 0;
  /** Smoothed frame time, for the debug layer. */
  frameMs = 16.7;
  private readonly listeners = new Set<(level: QualityLevel) => void>();

  constructor(private readonly tuning: QualityTuning) {}

  get level(): QualityLevel {
    return this.current;
  }

  get mode(): QualityChoice {
    return this.choice;
  }

  get profile(): QualityProfile {
    const level = this.tuning.niveles[this.current];
    return { maxDensity: level.densidadMax, caustics: level.causticas, particles: level.particulas };
  }

  /** 'auto' restarts from the top level and lets the monitor decide. */
  setChoice(choice: QualityChoice): void {
    this.choice = choice;
    this.slowMs = 0;
    this.apply(choice === 'auto' ? 'alta' : choice);
  }

  /** Call once per rendered frame with the real time since the previous one. */
  sample(elapsedMs: number): void {
    // Ignore pauses (tab hidden, debugger): they are not a performance signal.
    if (elapsedMs > 250) return;
    this.frameMs += (elapsedMs - this.frameMs) * 0.1;
    if (this.choice !== 'auto') return;
    if (this.frameMs > this.tuning.bajarSiMsPorFrame) this.slowMs += elapsedMs;
    else this.slowMs = Math.max(0, this.slowMs - elapsedMs * 2);
    if (this.slowMs >= this.tuning.segundosParaBajar * 1000) {
      this.slowMs = 0;
      const index = QUALITY_LEVELS.indexOf(this.current);
      const next = QUALITY_LEVELS[index + 1];
      if (next) {
        // Give the new level a fair start instead of judging it by the old frame times.
        this.frameMs = 16.7;
        this.apply(next);
      }
    }
  }

  onChange(listener: (level: QualityLevel) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(level: QualityLevel): void {
    if (level === this.current) return;
    this.current = level;
    for (const listener of this.listeners) listener(level);
  }
}
