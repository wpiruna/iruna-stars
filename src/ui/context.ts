/** What every screen can reach: data, saved settings and a few app actions. */
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { GameData } from '../data/load';
import type { SaveStore } from '../persist/storage';
import type { LabSettings } from '../sim/duel/lab';

export interface AppActions {
  /** First tap on the title screen: full screen, audio unlock, etc. */
  start(): void;
  /** Reloads into the new version when the service worker has one waiting. */
  applyUpdate(): void;
  install(): void;
  setLoad(multiplier: number): void;
  toggleDebug(): void;
  /** Starts a penalty shoot-out against a rival, or the shooting lab. */
  startShootout(rivalId: string): void;
  startLab(): void;
  /** Leaves the game in progress and goes back to the menu. */
  exitPlay(): void;
  /** Plays the same mode again from the start. */
  restartPlay(): void;
  setPaused(paused: boolean): void;
  configureLab(settings: LabSettings): void;
  resetLabStats(): void;
  /** Short confirmation blip for menu buttons. */
  click(): void;
}

export interface AppContext {
  data: GameData;
  save: SaveStore;
  actions: AppActions;
}

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const value = useContext(Ctx);
  if (!value) throw new Error('AppContext missing');
  return value;
}
