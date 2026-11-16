import { STYLE_LABEL } from '../../data/model';
import { pickKeeper, pickShooters } from '../../sim/duel/shootout';
import { Shield } from '../components/Shield';
import { useApp } from '../context';
import { go } from '../state';

/** Before a shoot-out: who we send and who we face. */
export function ShootoutSetup() {
  const { data, actions } = useApp();
  const shooters = pickShooters(data.ourTeam, data.rules.tandaPenaltis.lanzadores);
  const keeper = pickKeeper(data.ourTeam);
  const rivals = [...data.rivals].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  return (
    <section class="screen panel-screen">
      <header class="panel-screen__header">
        <button class="btn btn--back" onClick={() => go('menu')}>
          ‹ Volver
        </button>
        <h2 class="heading heading--big">Tanda de penaltis</h2>
      </header>
      <div class="panel-screen__body setup">
        <div class="setup__ours">
          <h3 class="heading">Tiran</h3>
          <ol class="lineup">
            {shooters.map((player) => (
              <li>
                <b>{player.number}</b> {player.nickname}
              </li>
            ))}
          </ol>
          <h3 class="heading">Para</h3>
          <ol class="lineup lineup--keeper">
            <li>
              <b>{keeper.number}</b> {keeper.nickname}
            </li>
          </ol>
          <p class="hint">
            Salen los cinco mejores lanzadores según sus barras de Potencia y Precisión. La convocatoria a mano llega en
            la Fase 5.
          </p>
        </div>
        <div class="setup__rivals">
          <h3 class="heading">Elige rival</h3>
          <div class="rival-grid">
            {rivals.map((team) => (
              <button class="rival" onClick={() => actions.startShootout(team.id)}>
                <Shield id={team.id} code={team.code} image={team.shield} size={3.6} />
                <span class="rival__name">{team.name}</span>
                <span class="rival__info">
                  Nivel {team.level} · {team.style ? STYLE_LABEL[team.style] : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
