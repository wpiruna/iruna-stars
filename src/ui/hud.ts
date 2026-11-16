/** What the in-game HUD shows. The play session writes it; the HUD components only read. */
import type { InputDevice } from '../app/platform';
import { createStore } from './store';

export interface HudTeam {
  id: string;
  name: string;
  code: string;
  shield?: string;
  /** One entry per penalty: true = scored, false = missed. */
  kicks: boolean[];
}

export type BannerTone = 'great' | 'bad' | 'neutral';

export interface HudState {
  mode: 'shootout' | 'lab' | null;
  teams: [HudTeam, HudTeam] | null;
  kicksPerTeam: number;
  suddenDeath: boolean;
  /** What the player does in the current kick. */
  role: 'shooter' | 'keeper' | null;
  /** The player on screen the HUD talks about (our shooter or our keeper). */
  actor: { number: number; nickname: string; photo?: string; keeper: boolean } | null;
  /** The rival involved in the current kick. */
  rival: { number: number; nickname: string } | null;
  /** Big arcade caption. `id` changes with every new one so the animation restarts. */
  banner: { id: number; text: string; tone: BannerTone; detail?: string } | null;
  /** Aim read-out while charging, e.g. "PALO ARRIBA · BOTE". */
  aim: string;
  /** Seconds left to shoot, whole numbers, or null when there is no limit. */
  timeLeft: number | null;
  paused: boolean;
  device: InputDevice;
  result: { won: boolean; score: [number, number]; phrase: string } | null;
  lab: { shots: number; goals: number; saves: number; posts: number; misses: number; last: string } | null;
}

export const emptyHud = (): HudState => ({
  mode: null,
  teams: null,
  kicksPerTeam: 5,
  suddenDeath: false,
  role: null,
  actor: null,
  rival: null,
  banner: null,
  aim: '',
  timeLeft: null,
  paused: false,
  device: 'keyboard',
  result: null,
  lab: null,
});

export const hud = createStore<HudState>(emptyHud());
