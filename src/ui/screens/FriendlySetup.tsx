import { useState } from 'preact/hooks';
import { STYLE_LABEL } from '../../data/model';
import { Shield } from '../components/Shield';
import { useApp } from '../context';
import { go, ui } from '../state';

/** Friendly match: pick the referee (or leave it to chance) and the rival; then the convocatoria and the cap. */
export function FriendlySetup() {
  const { data, actions } = useApp();
  const [referee, setReferee] = useState<string | null>(null);
  const rivals = [...data.rivals].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  const minutes = data.rules.partido.minutosMarcador;
  const real = Math.round((minutes * 60) / data.rules.velocidadRelojes.partido);
  const chosen = data.referees.find((r) => r.id === referee);
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
          reales cada uno).
        </p>
        <h3 class="heading">Árbitro</h3>
        <div class="referee-pick">
          <button class={`scenario${referee === null ? ' scenario--on' : ''}`} onClick={() => setReferee(null)}>
            <strong>Al azar</strong>
            <span>Como en la Copa</span>
          </button>
          {data.referees.map((r) => (
            <button class={`scenario${referee === r.id ? ' scenario--on' : ''}`} onClick={() => setReferee(r.id)}>
              <strong>{r.name}</strong>
              <span>{refereeLine(r)}</span>
            </button>
          ))}
        </div>
        {chosen && chosen.phrases[0] && <p class="hint">«{chosen.phrases[0]}»</p>}
        <h3 class="heading">Rival</h3>
        <div class="rival-grid">
          {rivals.map((team) => (
            <button
              class="rival"
              onClick={() => {
                actions.click();
                ui.set({ friendly: { rivalId: team.id, refereeId: referee } });
                go('squad');
              }}
            >
              <Shield id={team.id} code={team.code} image={team.shield} size={3.6} />
              <span class="rival__name">{team.name}</span>
              <span class="rival__info">
                Nivel {team.level} · {team.style ? STYLE_LABEL[team.style] : ''}
              </span>
            </button>
          ))}
        </div>
        <p class="hint">Después eliges la convocatoria y el gorro.</p>
      </div>
    </section>
  );
}

/** One line on how a referee whistles, from the bars of the sheet. */
function refereeLine(r: { contactTolerance: number; exclusionTendency: number; bias: number }): string {
  const strict = r.contactTolerance <= 3 || r.exclusionTendency >= 7 ? 'Estricto' : r.contactTolerance >= 7 ? 'Deja jugar' : 'Normal';
  const bias = r.bias > 0 ? ' · ¿nos tiene manía?' : r.bias < 0 ? ' · nos mira con cariño' : '';
  return strict + bias;
}
