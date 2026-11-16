import { useState } from 'preact/hooks';
import { STYLE_LABEL } from '../../data/model';
import { Shield } from '../components/Shield';
import { useApp } from '../context';
import type { AttackScenario } from '../hud';
import { go } from '../state';

const SCENARIOS: { id: AttackScenario; title: string; text: string }[] = [
  { id: 'completo', title: '6 contra 6', text: 'El ataque entero: boya, extremos, laterales y cierre.' },
  { id: 'entradas', title: 'Entradas', text: 'Sin boya: todo el centro libre para entrar y recibir.' },
  { id: 'boya', title: 'Juego con el boya', text: 'Cierre, laterales y boya: pasar dentro, luchar, girarse.' },
];

/** Before the attack training: what to practise and against whom. */
export function AttackSetup() {
  const { data, actions } = useApp();
  const [scenario, setScenario] = useState<AttackScenario>('completo');
  const rivals = [...data.rivals].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  return (
    <section class="screen panel-screen">
      <header class="panel-screen__header">
        <button class="btn btn--back" onClick={() => go('menu')}>
          ‹ Volver
        </button>
        <h2 class="heading heading--big">Entrenamiento de ataque</h2>
      </header>
      <div class="panel-screen__body setup setup--attack">
        <div>
          <h3 class="heading">Qué practicar</h3>
          <div class="scenarios">
            {SCENARIOS.map((s) => (
              <button class={`scenario${scenario === s.id ? ' scenario--on' : ''}`} onClick={() => setScenario(s.id)}>
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </button>
            ))}
          </div>
          <p class="hint">
            Pad: pasar (la flecha te dice a quién y su color, el riesgo). HABILIDAD + dirección: el compañero de esa
            zona entra (o el boya lucha la posición). TIRO: tirar.
          </p>
        </div>
        <div class="setup__rivals">
          <h3 class="heading">Contra quién</h3>
          <div class="rival-grid">
            {rivals.map((team) => (
              <button class="rival" onClick={() => actions.startAttack(team.id, scenario)}>
                <Shield id={team.id} code={team.code} image={team.shield} size={3.6} />
                <span class="rival__name">{team.name}</span>
                <span class="rival__info">
                  Nivel {team.level} · {team.style ? STYLE_LABEL[team.style] : ''}
                  {team.style === 'defensive' ? ' · defensa en zona' : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
