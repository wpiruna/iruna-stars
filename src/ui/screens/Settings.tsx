import { useState } from 'preact/hooks';
import { isIos } from '../../app/platform';
import type { Settings as SettingsData } from '../../persist/storage';
import { useApp } from '../context';
import { go } from '../state';

function Choice<K extends keyof SettingsData>(props: {
  label: string;
  hint?: string;
  setting: K;
  options: { value: SettingsData[K]; label: string }[];
}) {
  const { save } = useApp();
  const [, refresh] = useState(0);
  const current = save.settings[props.setting];
  return (
    <div class="setting">
      <div class="setting__label">
        <strong>{props.label}</strong>
        {props.hint && <span>{props.hint}</span>}
      </div>
      <div class="segmented">
        {props.options.map((option) => (
          <button
            class={current === option.value ? 'on' : ''}
            onClick={() => {
              save.setSetting(props.setting, option.value);
              refresh((n) => n + 1);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const yesNo = [
  { value: true, label: 'Sí' },
  { value: false, label: 'No' },
];

export function Settings() {
  const { save } = useApp();
  const [confirming, setConfirming] = useState(false);
  return (
    <section class="screen panel-screen">
      <header class="panel-screen__header">
        <button class="btn btn--back" onClick={() => go('menu')}>
          ‹ Volver
        </button>
        <h2 class="heading heading--big">Ajustes</h2>
      </header>
      <div class="panel-screen__body settings">
        <Choice
          label="Calidad gráfica"
          hint="En Automática baja sola si el móvil no llega a 60 fps."
          setting="quality"
          options={[
            { value: 'auto', label: 'Automática' },
            { value: 'alta', label: 'Alta' },
            { value: 'media', label: 'Media' },
            { value: 'baja', label: 'Baja' },
          ]}
        />
        <Choice
          label="Pad táctil"
          hint="Flotante: aparece donde apoyas el pulgar. Fijo: siempre en el mismo sitio."
          setting="padMode"
          options={[
            { value: 'flotante', label: 'Flotante' },
            { value: 'fijo', label: 'Fijo' },
          ]}
        />
        <Choice
          label="Lado del pad"
          hint="Para zurdos: pad a la derecha y botones a la izquierda."
          setting="swapSides"
          options={[
            { value: false, label: 'Pad a la izquierda' },
            { value: true, label: 'Pad a la derecha' },
          ]}
        />
        <Choice
          label="Tamaño de los controles"
          setting="controlScale"
          options={[
            { value: 0.85, label: 'Pequeños' },
            { value: 1, label: 'Normales' },
            { value: 1.2, label: 'Grandes' },
          ]}
        />
        <Choice
          label="Vibración"
          hint={isIos() ? 'El iPhone no permite vibrar desde el navegador.' : 'En tiros, goles y exclusiones.'}
          setting="vibration"
          options={yesNo}
        />
        <Choice label="Cambio automático de defensor" setting="autoSwitchDefender" options={yesNo} />
        <Choice label="Sonido" setting="sound" options={yesNo} />
        <Choice
          label="Dificultad"
          hint="Cambia los reflejos y las decisiones del rival, no al árbitro."
          setting="difficulty"
          options={[
            { value: 'facil', label: 'Fácil' },
            { value: 'normal', label: 'Normal' },
            { value: 'dificil', label: 'Difícil' },
          ]}
        />
        <p class="hint">
          Los controles, el sonido y la dificultad se guardan ya, pero empiezan a notarse cuando lleguen el tiro (Fase 1)
          y el partido (Fase 3).
        </p>
        <div class="setting setting--danger">
          <div class="setting__label">
            <strong>Borrar la partida guardada</strong>
            <span>Ajustes, Copa en curso, historial, récords y álbum de este dispositivo.</span>
          </div>
          {confirming ? (
            <div class="segmented">
              <button
                class="danger"
                onClick={() => {
                  save.reset();
                  setConfirming(false);
                }}
              >
                Sí, borrar
              </button>
              <button onClick={() => setConfirming(false)}>Cancelar</button>
            </div>
          ) : (
            <button class="btn btn--small" onClick={() => setConfirming(true)}>
              Borrar…
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
