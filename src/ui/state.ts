/** UI state shared between the app and the screens. */
import type { InputDevice } from '../app/platform';
import type { QualityLevel } from '../render/quality';
import { createStore } from './store';

export type ScreenName = 'title' | 'menu' | 'data' | 'settings' | 'install';

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
}

export interface UiState {
  screen: ScreenName;
  debug: boolean;
  updateReady: boolean;
  offlineReady: boolean;
  canInstall: boolean;
  device: InputDevice;
  debugInfo: DebugInfo;
}

export const ui = createStore<UiState>({
  screen: 'title',
  debug: false,
  updateReady: false,
  offlineReady: false,
  canInstall: false,
  device: 'keyboard',
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
  },
});

export function go(screen: ScreenName): void {
  ui.set({ screen });
}
