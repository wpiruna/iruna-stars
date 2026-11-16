/** Always-on overlays: rotate hint, new-version toast and the debug layer. */
import { DEBUG_AVAILABLE } from '../../debug/config';
import { QUALITY_CHOICES } from '../../persist/storage';
import { useApp } from '../context';
import { hud } from '../hud';
import { ui } from '../state';
import { useStore } from '../store';

/** Shown by CSS only on touch devices held upright. */
export function RotateOverlay() {
  return (
    <div class="rotate" role="alert">
      <div class="rotate__phone" />
      <p class="rotate__title">Gira el móvil</p>
      <p class="rotate__text">Waterpolo Iruña Stars se juega en horizontal.</p>
    </div>
  );
}

export function UpdateToast() {
  const { updateReady, offlineReady } = useStore(ui);
  const { actions } = useApp();
  if (updateReady) {
    return (
      <div class="toast">
        <span>Hay una versión nueva del juego.</span>
        <button class="btn btn--small" onClick={actions.applyUpdate}>
          Actualizar
        </button>
      </div>
    );
  }
  if (offlineReady) {
    return (
      <div class="toast toast--quiet" onClick={() => ui.set({ offlineReady: false })}>
        <span>Listo para jugar sin conexión.</span>
      </div>
    );
  }
  return null;
}

const LOADS = [1, 4, 16, 40];
const DEVICE_LABEL = { touch: 'táctil', keyboard: 'teclado', gamepad: 'mando' } as const;

export function DebugPanel() {
  const state = useStore(ui);
  const { mode } = useStore(hud);
  const { save, actions } = useApp();
  if (!DEBUG_AVAILABLE || !state.debug) return null;
  const info = state.debugInfo;
  return (
    <aside class="debug">
      <header>
        <strong>Depuración</strong>
        <button class="debug__close" onClick={actions.toggleDebug} aria-label="Cerrar">
          ×
        </button>
      </header>
      <dl>
        <dt>fps</dt>
        <dd class={info.fps < 50 ? 'bad' : ''}>
          {info.fps.toFixed(0)} · {info.frameMs.toFixed(1)} ms
        </dd>
        <dt>calidad</dt>
        <dd>
          {info.quality} ({info.qualityMode})
        </dd>
        <dt>densidad</dt>
        <dd>
          {info.density.toFixed(2)} · lienzo {info.canvas}
        </dd>
        <dt>lógica</dt>
        <dd>{info.logical}</dd>
        <dt>pantalla</dt>
        <dd>{state.screen}</dd>
        <dt>pasos sim</dt>
        <dd>{info.ticks}</dd>
        <dt>jugadores</dt>
        <dd>
          {info.swimmers} (carga ×{info.load})
        </dd>
        <dt>entrada</dt>
        <dd>{DEVICE_LABEL[state.device]}</dd>
        {info.seed && (
          <>
            <dt>semilla</dt>
            <dd>{info.seed}</dd>
          </>
        )}
        <dt>build</dt>
        <dd>
          {__BUILD_ID__}
          {__SINGLE_FILE__ ? ' · HTML único' : ' · web'}
        </dd>
      </dl>
      {info.sim && <p class="debug__sim">{info.sim}</p>}
      <div class="debug__row">
        <span>Calidad</span>
        {QUALITY_CHOICES.map((choice) => (
          <button class={save.settings.quality === choice ? 'on' : ''} onClick={() => save.setSetting('quality', choice)}>
            {choice}
          </button>
        ))}
      </div>
      {(mode === 'match' || mode === 'attack') && (
        <div class="debug__row">
          <span>Árbitro</span>
          <button onClick={() => actions.debugCall('exclusionRival')}>excluir rival</button>
          <button onClick={() => actions.debugCall('exclusionOurs')}>excluir nuestro</button>
          <button onClick={() => actions.debugCall('penaltyFor')}>penalti a favor</button>
          <button onClick={() => actions.debugCall('penaltyAgainst')}>penalti en contra</button>
        </div>
      )}
      <div class="debug__row">
        <span>Carga</span>
        {LOADS.map((load) => (
          <button class={info.load === load ? 'on' : ''} onClick={() => actions.setLoad(load)}>
            ×{load}
          </button>
        ))}
      </div>
    </aside>
  );
}
