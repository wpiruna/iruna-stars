/** What the main loop needs from whatever is being played (shoot-out, lab, attack drill…). */
import type { Container } from 'pixi.js';
import type { QualityProfile } from '../render/quality';

export interface Session {
  readonly view: Container;
  readonly seed: number;
  /** Simulation speed asked by the effects (slow motion). The main loop applies it. */
  timeScale: number;
  layout(width: number, height: number): void;
  setPaused(paused: boolean): void;
  /** One fixed simulation step. */
  step(): void;
  render(alpha: number, dt: number, profile: QualityProfile): void;
  /** One line for the debug layer. */
  debugLine(): string;
  /** Debug layer: make the referee whistle something now (matches only). */
  debugCall?(kind: DebugCall): void;
  /** Matches: the bench menu and time-outs (GDD §11.3). */
  openBench?(): void;
  closeBench?(): void;
  benchChange?(outId: string, inId: string | null): void;
  callTimeout?(): void;
}

export type DebugCall = 'exclusionRival' | 'exclusionOurs' | 'penaltyFor' | 'penaltyAgainst' | 'offensiveFoul' | 'tireOurs' | 'tireRival';
