/** UI state shared between the app and the screens. */
import type { InputDevice } from '../app/platform';
import type { QualityLevel } from '../render/quality';
import { createStore } from './store';

export type ScreenName =
  | 'title'
  | 'menu'
  | 'data'
  | 'settings'
  | 'install'
  | 'shootoutSetup'
  | 'attackSetup'
  | 'friendlySetup'
  | 'squad'
  | 'play'
  | 'shootoutResult'
  | 'matchResult';

export interface DebugInfo {
  fps: number;
  frameMs: number;
  quality: QualityLevel;
  qualityMode: string;
  density: number;
  logical: string;
  canvas: string;
  ticks: number;
  swimmers: number;
  load: number;
  /** State of the simulation in play (state machine, charge, last save estimate). */
  sim: string;
  seed: string;
}

export interface UiState {
  screen: ScreenName;
  debug: boolean;
  updateReady: boolean;
  offlineReady: boolean;
  canInstall: boolean;
  device: InputDevice;
  debugInfo: DebugInfo;
  /** The friendly being prepared: rival and referee (null = at random), before the convocatoria. */
  friendly: { rivalId: string; refereeId: string | null } | null;
}

export const ui = createStore<UiState>({
  screen: 'title',
  debug: false,
  updateReady: false,
  offlineReady: false,
  canInstall: false,
  device: 'keyboard',
  friendly: null,
  debugInfo: {
    fps: 0,
    frameMs: 0,
    quality: 'alta',
    qualityMode: 'auto',
    density: 1,
    logical: '',
    canvas: '',
    ticks: 0,
    swimmers: 0,
    load: 1,
    sim: '',
    seed: '',
  },
});

export function go(screen: ScreenName): void {
  ui.set({ screen });
}
