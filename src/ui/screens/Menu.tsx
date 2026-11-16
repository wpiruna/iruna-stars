import { useRef } from 'preact/hooks';
import { Shield } from '../components/Shield';
import { useApp, type AppActions } from '../context';
import { go } from '../state';
import { Logo } from './Title';

interface Mode {
  title: string;
  text: string;
  /** Phase in which the mode arrives (docs/GDD.md §21), while it is not playable yet. */
  phase?: string;
  open?(actions: AppActions): void;
}

const MODES: Mode[] = [
  { title: 'Copa de Euskal Herria', text: 'Cuartos, semifinal y final. Si pierdes, a casa.', phase: 'Fase 6' },
  { title: 'Amistoso', text: 'Un partido entero contra el rival que elijas.', open: () => go('friendlySetup') },
  { title: 'Entrenamiento del jueves', text: 'Ataque, contras, superioridad e inferioridad contra una defensa de verdad.', open: () => go('attackSetup') },
  { title: 'Tanda de penaltis', text: 'Cinco lanzamientos por equipo y muerte súbita.', open: () => go('shootoutSetup') },
];

export function Menu() {
  const { data, actions } = useApp();
  const taps = useRef({ count: 0, last: 0 });

  // Five quick taps on the build label open the debug layer on a phone.
  const onBuildTap = (): void => {
    const now = performance.now();
    taps.current.count = now - taps.current.last < 600 ? taps.current.count + 1 : 1;
    taps.current.last = now;
    if (taps.current.count >= 5) {
      taps.current.count = 0;
      actions.toggleDebug();
    }
  };

  return (
    <section class="screen menu">
      <header class="menu__header">
        <Logo compact />
        <div class="menu__club">
          <Shield id="nuestro" code={data.club.code} image={data.ourTeam.shield} size={4.2} />
          <span>{data.club.name}</span>
        </div>
      </header>

      <div class="menu__body">
        <ul class="menu__modes">
          {MODES.map((mode) => (
            <li>
              <button
                class="btn btn--mode"
                disabled={!mode.open}
                onClick={() => {
                  actions.click();
                  mode.open?.(actions);
                }}
              >
                <span class="btn__title">{mode.title}</span>
                <span class="btn__text">{mode.text}</span>
                {mode.phase && <span class="btn__badge">Próximamente · {mode.phase}</span>}
              </button>
            </li>
          ))}
        </ul>

        <div class="menu__extras">
          <h2 class="heading">Extras</h2>
          <button class="btn" onClick={actions.startLab}>
            Laboratorio de tiro
          </button>
          <button class="btn" onClick={() => go('data')}>
            Datos del juego
          </button>
          <button class="btn" onClick={() => go('settings')}>
            Ajustes
          </button>
          <button class="btn" onClick={() => go('install')}>
            {__SINGLE_FILE__ ? 'Versión web' : 'Instalar y versión de PC'}
          </button>
        </div>
      </div>

      <footer class="menu__footer" onClick={onBuildTap}>
        Fase 4 · Reglas y árbitro · versión {__BUILD_ID__}
      </footer>
    </section>
  );
}
