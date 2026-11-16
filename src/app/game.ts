/** Wires everything together: data, saved settings, renderer, fixed-step loop, input and UI. */
import { h, render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { Sfx } from '../audio/sfx';
import { FixedLoop } from '../core/loop';
import { loadGameData } from '../data/load';
import { DEBUG_AVAILABLE, debugParam, debugRequestedByUrl } from '../debug/config';
import { Controller } from '../input/controller';
import { TouchControls } from '../input/touch';
import { SaveStore } from '../persist/storage';
import { Backdrop } from '../render/backdrop';
import { NUMBER_FONT } from '../render/caps';
import { QualityManager } from '../render/quality';
import { Stage } from '../render/stage';
import type { LabSettings } from '../sim/duel/lab';
import { App } from '../ui/App';
import type { AppActions } from '../ui/context';
import { emptyHud, hud } from '../ui/hud';
import { go, ui } from '../ui/state';
import {
  blockBrowserGestures,
  enterImmersive,
  isTouchDevice,
  keepAwake,
  promptInstall,
  watchInputDevice,
  watchInstallPrompt,
} from './platform';
import { AttackSession } from './attack';
import { DEFAULT_LAB_SETTINGS, PlaySession, type PlayRequest } from './play';
import type { Session } from './session';
import type { AttackScenario } from '../ui/hud';

type Request = PlayRequest | { kind: 'attack'; rivalId: string; scenario: AttackScenario };

export async function startGame(gameHost: HTMLElement, controlsHost: HTMLElement, uiHost: HTMLElement): Promise<void> {
  const data = loadGameData();
  const save = new SaveStore();
  const quality = new QualityManager(data.tuning.calidad);
  quality.setChoice(save.settings.quality);
  const sfx = new Sfx();
  sfx.enabled = save.settings.sound;

  // Cap numbers are baked into textures: the font has to be ready before the first one.
  try {
    await document.fonts.load(`32px ${NUMBER_FONT}`);
  } catch {
    // Without the Font Loading API the browser falls back to a system font for a moment.
  }

  const stage = await Stage.create(gameHost, quality);
  const backdrop = new Backdrop(stage.app.renderer);
  stage.root.addChild(backdrop.view);

  // --- Input ------------------------------------------------------------------------------------
  const controller = new Controller();
  controller.attach(window);
  const touch = new TouchControls(controlsHost, () => session?.setPaused(true));
  touch.apply(save.settings);
  controller.touch = touch;
  let touchSeen = isTouchDevice();

  save.subscribe((saved) => {
    if (saved.settings.quality !== quality.mode) quality.setChoice(saved.settings.quality);
    sfx.enabled = saved.settings.sound;
    touch.apply(saved.settings);
  });

  // --- Play session -----------------------------------------------------------------------------
  let session: Session | null = null;
  let lastRequest: Request | null = null;
  let labSettings: LabSettings = DEFAULT_LAB_SETTINGS;

  const endSession = (): void => {
    if (!session) return;
    stage.root.removeChild(session.view);
    session.view.destroy({ children: true });
    session = null;
    backdrop.view.visible = true;
    touch.setVisible(false);
  };

  const startSession = (request: Request): void => {
    endSession();
    lastRequest = request;
    sfx.unlock();
    void keepAwake(true);
    const renderer = stage.app.renderer;
    if (request.kind === 'attack') {
      const rival = data.rivals.find((team) => team.id === request.rivalId) ?? data.rivals[0];
      if (!rival) return;
      session = new AttackSession({ renderer, data, save, controller, sfx }, rival, request.scenario);
    } else {
      session = new PlaySession({ renderer, data, save, controller, sfx, onFinished: () => go('shootoutResult') }, request, labSettings);
    }
    session.layout(stage.viewport.width, stage.viewport.height);
    stage.root.addChild(session.view);
    backdrop.view.visible = false;
    go('play');
  };

  stage.onResize((viewport) => {
    backdrop.layout(viewport.width, viewport.height);
    session?.layout(viewport.width, viewport.height);
    touch.apply(save.settings);
  });

  let load = 1;
  let updateServiceWorker: ((reload?: boolean) => Promise<void>) | null = null;
  const toggleDebug = (): void => {
    if (DEBUG_AVAILABLE) ui.set({ debug: !ui.get().debug });
  };
  const actions: AppActions = {
    start() {
      sfx.unlock();
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
    startShootout(rivalId) {
      void enterImmersive();
      startSession({ kind: 'shootout', rivalId });
    },
    startLab() {
      void enterImmersive();
      startSession({ kind: 'lab' });
    },
    startAttack(rivalId, scenario) {
      void enterImmersive();
      startSession({ kind: 'attack', rivalId, scenario });
    },
    exitPlay() {
      endSession();
      hud.set(emptyHud());
      go('menu');
    },
    restartPlay() {
      if (lastRequest) startSession(lastRequest);
    },
    setPaused(paused) {
      session?.setPaused(paused);
    },
    configureLab(settings) {
      labSettings = settings;
      if (session instanceof PlaySession) session.configureLab(settings);
    },
    resetLabStats() {
      if (session instanceof PlaySession) session.resetLabStats();
    },
    click() {
      sfx.unlock();
      sfx.play('click');
    },
  };

  blockBrowserGestures();
  watchInputDevice((device) => ui.set({ device }));
  watchInstallPrompt((canInstall) => ui.set({ canInstall }));
  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') touchSeen = true;
    sfx.unlock();
  });
  window.addEventListener('keydown', (event) => {
    sfx.unlock();
    const screen = ui.get().screen;
    if (event.code === 'F3' || event.code === 'Backquote') {
      event.preventDefault();
      toggleDebug();
    } else if (screen === 'title' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
      actions.start();
    } else if (event.code === 'Escape' && screen !== 'title' && screen !== 'play') {
      // In play, Escape is the pause button and is handled by the controller.
      if (screen === 'shootoutResult') actions.exitPlay();
      else go('menu');
    }
  });

  if (DEBUG_AVAILABLE && debugRequestedByUrl()) ui.set({ debug: true });
  const SCREEN_PARAM = {
    titulo: 'title',
    menu: 'menu',
    datos: 'data',
    ajustes: 'settings',
    instalar: 'install',
    tanda: 'shootoutSetup',
    entrenamiento: 'attackSetup',
  } as const;
  const requested = debugParam('pantalla');
  const scenario = debugParam('escenario');
  if (requested === 'laboratorio') startSession({ kind: 'lab' });
  else if (requested === 'ataque') {
    startSession({
      kind: 'attack',
      rivalId: debugParam('rival') ?? data.rivals[0]?.id ?? '',
      scenario: scenario === 'entradas' || scenario === 'boya' ? scenario : 'completo',
    });
  }
  else if (requested === 'penaltis') startSession({ kind: 'shootout', rivalId: debugParam('rival') ?? data.rivals[0]?.id ?? '' });
  else if (requested && requested in SCREEN_PARAM) go(SCREEN_PARAM[requested as keyof typeof SCREEN_PARAM]);
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
  const loop = new FixedLoop(() => {
    if (session) session.step();
    else backdrop.step();
  });
  let last = performance.now();
  let frames = 0;
  let fpsWindowStart = last;

  const frame = (now: number): void => {
    const elapsed = Math.min(now - last, 250);
    last = now;
    quality.sample(elapsed);
    // Slow motion stretches simulated time; the picture keeps its full frame rate.
    const alpha = loop.advance(elapsed * (session?.timeScale ?? 1));
    if (session) session.render(alpha, elapsed / 1000, quality.profile);
    else backdrop.render(alpha, quality.profile);
    stage.render();

    const playing = session !== null && ui.get().screen === 'play';
    touch.setVisible(playing && touchSeen && !hud.get().paused && !hud.get().result);
    touch.frame();

    frames++;
    if (now - fpsWindowStart >= 500) {
      const fps = (frames * 1000) / (now - fpsWindowStart);
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
            sim: session?.debugLine() ?? '',
            seed: session ? String(session.seed) : '',
          },
        });
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Coming back from the background must not look like a performance drop; and a game left
  // in the background pauses itself.
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
    loop.reset();
    if (document.visibilityState === 'hidden') {
      if (session && ui.get().screen === 'play') session.setPaused(true);
      touch.release();
    } else if (ui.get().screen !== 'title') {
      void keepAwake(true);
    }
  });
}
