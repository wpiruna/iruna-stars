import { STYLE_LABEL } from '../../data/model';
import { Shield } from '../components/Shield';
import { useApp } from '../context';
import { go } from '../state';

/** Friendly match: pick the rival. Referee and cap colour arrive with phases 4 and 5. */
export function FriendlySetup() {
  const { data, actions } = useApp();
  const rivals = [...data.rivals].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  const minutes = data.rules.partido.minutosMarcador;
  const real = Math.round((minutes * 60) / data.rules.velocidadRelojes.partido);
  return (
    <section class="screen panel-screen">
      <header class="panel-screen__header">
        <button class="btn btn--back" onClick={() => go('menu')}>
          ‹ Volver
        </button>
        <h2 class="heading heading--big">Amistoso</h2>
      </header>
      <div class="panel-screen__body">
        <p class="lead">
          {data.rules.partido.periodos} periodos de {minutes} minutos (unos {Math.floor(real / 60)}:{String(real % 60).padStart(2, '0')}{' '}
          reales cada uno). Elige rival:
        </p>
        <div class="rival-grid">
          {rivals.map((team) => (
            <button class="rival" onClick={() => actions.startMatch(team.id)}>
              <Shield id={team.id} code={team.code} image={team.shield} size={3.6} />
              <span class="rival__name">{team.name}</span>
              <span class="rival__info">
                Nivel {team.level} · {team.style ? STYLE_LABEL[team.style] : ''}
              </span>
            </button>
          ))}
        </div>
        <p class="hint">
          Todavía sin árbitro ni faltas (Fase 4) y sin cambios ni energía (Fase 5): de momento juegan los seis mejores
          de cada equipo todo el partido.
        </p>
      </div>
    </section>
  );
}
