/** Wires everything together: data, saved settings, renderer, fixed-step loop and UI. */
import { render } from 'preact';
import { h } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { FixedLoop } from '../core/loop';
import { loadGameData } from '../data/load';
import { DEBUG_AVAILABLE, debugParam, debugRequestedByUrl } from '../debug/config';
import { SaveStore } from '../persist/storage';
import { Backdrop } from '../render/backdrop';
import { NUMBER_FONT } from '../render/caps';
import { QualityManager } from '../render/quality';
import { Stage } from '../render/stage';
import { App } from '../ui/App';
import type { AppActions } from '../ui/context';
import { go, ui } from '../ui/state';
import {
  blockBrowserGestures,
  enterImmersive,
  keepAwake,
  promptInstall,
  watchInputDevice,
  watchInstallPrompt,
} from './platform';

export async function startGame(gameHost: HTMLElement, uiHost: HTMLElement): Promise<void> {
  const data = loadGameData();
  const save = new SaveStore();
  const quality = new QualityManager(data.tuning.calidad);
  quality.setChoice(save.settings.quality);
  save.subscribe((saved) => {
    if (saved.settings.quality !== quality.mode) quality.setChoice(saved.settings.quality);
  });

  // Cap numbers are baked into textures: the font has to be ready before the first one.
  try {
    await document.fonts.load(`32px ${NUMBER_FONT}`);
  } catch {
    // Without the Font Loading API the browser falls back to a system font for a moment.
  }

  const stage = await Stage.create(gameHost, quality);
  const backdrop = new Backdrop(stage.app.renderer);
  stage.root.addChild(backdrop.view);
  stage.onResize((viewport) => backdrop.layout(viewport.width, viewport.height));

  let load = 1;
  let updateServiceWorker: ((reload?: boolean) => Promise<void>) | null = null;
  const toggleDebug = (): void => {
    if (DEBUG_AVAILABLE) ui.set({ debug: !ui.get().debug });
  };
  const actions: AppActions = {
    start() {
      void enterImmersive();
      void keepAwake(true);
      go('menu');
    },
    applyUpdate() {
      void updateServiceWorker?.(true);
    },
    install() {
      void promptInstall();
    },
    setLoad(multiplier) {
      load = multiplier;
      backdrop.setLoad(multiplier);
    },
    toggleDebug,
  };

  blockBrowserGestures();
  watchInputDevice((device) => ui.set({ device }));
  watchInstallPrompt((canInstall) => ui.set({ canInstall }));
  window.addEventListener('keydown', (event) => {
    if (event.code === 'F3' || event.code === 'Backquote') {
      event.preventDefault();
      toggleDebug();
    } else if (ui.get().screen === 'title' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
      actions.start();
    } else if (event.code === 'Escape' && ui.get().screen !== 'title') {
      go('menu');
    }
  });
  if (DEBUG_AVAILABLE && debugRequestedByUrl()) ui.set({ debug: true });
  const SCREEN_PARAM = { titulo: 'title', menu: 'menu', datos: 'data', ajustes: 'settings', instalar: 'install' } as const;
  const requested = debugParam('pantalla');
  if (requested && requested in SCREEN_PARAM) go(SCREEN_PARAM[requested as keyof typeof SCREEN_PARAM]);
  const requestedLoad = Number(debugParam('carga'));
  if (requestedLoad > 1) actions.setLoad(requestedLoad);

  render(h(App, { context: { data, save, actions } }), uiHost);

  if (!__SINGLE_FILE__ && 'serviceWorker' in navigator && import.meta.env.PROD) {
    updateServiceWorker = registerSW({
      onNeedRefresh: () => ui.set({ updateReady: true }),
      onOfflineReady: () => ui.set({ offlineReady: true }),
    });
  }

  // --- Main loop: fixed 60 Hz simulation, interpolated render ---------------------------------
  const loop = new FixedLoop(() => backdrop.step());
  let last = performance.now();
  let frames = 0;
  let fpsWindowStart = last;
  let fps = 60;

  const frame = (now: number): void => {
    const elapsed = now - last;
    last = now;
    quality.sample(elapsed);
    const alpha = loop.advance(elapsed);
    backdrop.render(alpha, quality.profile);
    stage.render();

    frames++;
    if (now - fpsWindowStart >= 500) {
      fps = (frames * 1000) / (now - fpsWindowStart);
      frames = 0;
      fpsWindowStart = now;
      if (ui.get().debug) {
        const { viewport } = stage;
        ui.set({
          debugInfo: {
            fps,
            frameMs: quality.frameMs,
            quality: quality.level,
            qualityMode: quality.mode,
            density: viewport.density,
            logical: `${Math.round(viewport.width)}×${Math.round(viewport.height)}`,
            canvas: `${stage.app.canvas.width}×${stage.app.canvas.height}`,
            ticks: loop.ticks,
            swimmers: backdrop.swimmerCount,
            load,
          },
        });
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Coming back from the background must not look like a performance drop.
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
    loop.reset();
    if (document.visibilityState === 'visible' && ui.get().screen !== 'title') void keepAwake(true);
  });
}
