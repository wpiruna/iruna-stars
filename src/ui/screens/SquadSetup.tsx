/**
 * The convocatoria (GDD §3.2): our squad as cards with photo, dorsal, nickname, position and
 * bars; six starters, a keeper and the substitutes, and the cap. It starts from the last one
 * (or the automatic choice) and is saved for the next match.
 */
import { useState } from 'preact/hooks';
import { autoSquad, resolveSquad, squadProblems, type SavedSquad } from '../../app/squad';
import { imageUrl, playerPlaceholder } from '../../data/images';
import { KEEPER_STAT_ORDER, POSITION_LABEL, STAT_LABEL, STAT_ORDER, type Player } from '../../data/model';
import { Shield } from '../components/Shield';
import { useApp } from '../context';
import { go, ui } from '../state';
import { useStore } from '../store';

type Role = 'starter' | 'keeper' | 'bench' | 'out';
const ROLE_LABEL: Record<Role, string> = { starter: 'Titular', keeper: 'Portero', bench: 'Suplente', out: '' };
const POSITION_ORDER = ['goalkeeper', 'center', 'point', 'driver', 'wing'];

function roleOf(squad: SavedSquad, p: Player): Role {
  if (squad.keeper === p.id) return 'keeper';
  if (squad.starters.includes(p.id)) return 'starter';
  if (squad.bench.includes(p.id)) return 'bench';
  return 'out';
}

function setRole(squad: SavedSquad, p: Player, role: Role): SavedSquad {
  const next: SavedSquad = {
    starters: squad.starters.filter((id) => id !== p.id),
    bench: squad.bench.filter((id) => id !== p.id),
    keeper: squad.keeper === p.id ? null : squad.keeper,
  };
  if (role === 'starter') next.starters.push(p.id);
  else if (role === 'bench') next.bench.push(p.id);
  else if (role === 'keeper') next.keeper = p.id;
  return next;
}

function Card({ player, role, selected, onPick }: { player: Player; role: Role; selected: boolean; onPick(): void }) {
  const photo = imageUrl(player.photos[0]) ?? playerPlaceholder(player.number, player.position === 'goalkeeper');
  const classes = ['squad-card', `squad-card--${player.position}`, `squad-card--${role}`, selected ? 'squad-card--selected' : ''].filter(Boolean).join(' ');
  return (
    <button class={classes} onClick={onPick}>
      <span class={`portrait${player.photos[0] ? ' portrait--photo' : ''}`}>
        <img src={photo} alt="" draggable={false} />
      </span>
      <span class="squad-card__number">{player.number}</span>
      {role !== 'out' && <span class="squad-card__role">{ROLE_LABEL[role]}</span>}
      <span class="squad-card__name">{player.nickname}</span>
      <span class="squad-card__position">
        {POSITION_LABEL[player.position]}
        {player.hand === 'left' ? ' · Zurdo' : ''}
      </span>
    </button>
  );
}

function Bars({ player }: { player: Player }) {
  const bars = STAT_ORDER.map((key) => ({ label: STAT_LABEL[key], value: player.stats[key] }));
  if (player.keeperStats) for (const key of KEEPER_STAT_ORDER) bars.push({ label: STAT_LABEL[key], value: player.keeperStats[key] });
  return (
    <ul class="squad-bars">
      {bars.map((b) => (
        <li>
          <span>{b.label}</span>
          <i>
            <b style={{ width: `${b.value * 10}%` }} />
          </i>
          <em>{b.value}</em>
        </li>
      ))}
    </ul>
  );
}

function Cap({ color, number }: { color: 'white' | 'blue'; number: number }) {
  return <span class={`cap cap--${color}`}>{number}</span>;
}

export function SquadSetup() {
  const { data, save, actions } = useApp();
  const { friendly } = useStore(ui);
  const team = data.ourTeam;
  const benchSize = data.rules.convocatoria.suplentes;
  const hand = data.tuning.ataque.zona.mano;
  // Start from the last convocatoria, cleaned up against today's data.
  const [squad, setSquad] = useState<SavedSquad>(() => {
    const saved = save.get().squad;
    if (!saved) return autoSquad(team, benchSize, hand);
    const resolved = resolveSquad(team, saved, benchSize, hand);
    return { starters: resolved.field.map((p) => p.id), keeper: resolved.keeper.id, bench: resolved.bench.map((p) => p.id) };
  });
  const [cap, setCap] = useState(save.settings.cap);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rival = data.rivals.find((t) => t.id === friendly?.rivalId);
  if (!friendly || !rival) {
    return (
      <section class="screen panel-screen">
        <button class="btn btn--back" onClick={() => go('friendlySetup')}>
          ‹ Elige rival
        </button>
      </section>
    );
  }
  const players = [...team.players].sort((a, b) => POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position) || a.number - b.number);
  const selected = players.find((p) => p.id === selectedId) ?? null;
  const role = selected ? roleOf(squad, selected) : 'out';
  const problems = squadProblems(squad, benchSize);
  const change = (r: Role): void => {
    if (!selected) return;
    actions.click();
    setSquad(setRole(squad, selected, r));
  };
  const play = (): void => {
    save.update((draft) => {
      draft.squad = squad;
      draft.settings.cap = cap;
    });
    actions.startMatch(friendly.rivalId, friendly.refereeId);
  };
  const keeper = selected?.position === 'goalkeeper';
  const startersFull = squad.starters.length >= 6 && role !== 'starter';
  const benchFull = squad.bench.length >= benchSize && role !== 'bench';
  return (
    <section class="screen panel-screen squad">
      <header class="panel-screen__header">
        <button class="btn btn--back" onClick={() => go('friendlySetup')}>
          ‹ Volver
        </button>
        <h2 class="heading heading--big">Convocatoria</h2>
        <span class="squad__rival">
          contra <Shield id={rival.id} code={rival.code} image={rival.shield} size={2} /> {rival.name}
        </span>
        <span class="squad__count">
          <b class={squad.starters.length === 6 ? 'ok' : ''}>{squad.starters.length}/6</b> titulares ·{' '}
          <b class={squad.keeper ? 'ok' : ''}>{squad.keeper ? 1 : 0}/1</b> portero ·{' '}
          <b class={squad.bench.length === benchSize ? 'ok' : ''}>
            {squad.bench.length}/{benchSize}
          </b>{' '}
          suplentes
        </span>
      </header>
      <div class="squad__layout">
        <div class="panel-screen__body squad__grid">
          {players.map((p) => (
            <Card
              player={p}
              role={roleOf(squad, p)}
              selected={p.id === selectedId}
              onPick={() => {
                actions.click();
                setSelectedId(p.id === selectedId ? null : p.id);
              }}
            />
          ))}
        </div>
        <aside class="squad__side">
          {selected ? (
            <div class="squad__detail">
              <strong>
                <b>{selected.number}</b> {selected.nickname}
              </strong>
              <span class="squad__detail-position">
                {POSITION_LABEL[selected.position]}
                {selected.hand === 'left' ? ' · Zurdo' : ''}
                {selected.origin === 'provisional' ? ' · PROVISIONAL' : ''}
              </span>
              <Bars player={selected} />
              {selected.emptyBars > 0 && <p class="hint">{selected.emptyBars} barras sin rellenar en la hoja (valen 5).</p>}
              <div class="squad__roles">
                {keeper ? (
                  <button class={`chip${role === 'keeper' ? ' chip--on' : ''}`} onClick={() => change('keeper')}>
                    Portero
                  </button>
                ) : (
                  <>
                    <button class={`chip${role === 'starter' ? ' chip--on' : ''}`} disabled={startersFull} onClick={() => change('starter')}>
                      Titular
                    </button>
                    <button class={`chip${role === 'bench' ? ' chip--on' : ''}`} disabled={benchFull} onClick={() => change('bench')}>
                      Suplente
                    </button>
                  </>
                )}
                <button class={`chip${role === 'out' ? ' chip--on' : ''}`} onClick={() => change('out')}>
                  Fuera
                </button>
              </div>
              {startersFull && !keeper && <p class="hint">Ya hay 6 titulares: quita uno para meter a este.</p>}
            </div>
          ) : (
            <p class="hint squad__help">Toca un cromo para ver sus barras y decidir si es titular, suplente o se queda fuera.</p>
          )}
          <div class="squad__caps">
            <span>Gorro</span>
            {(['white', 'blue'] as const).map((c) => (
              <button
                class={`squad__cap${cap === c ? ' squad__cap--on' : ''}`}
                onClick={() => {
                  actions.click();
                  setCap(c);
                }}
              >
                <Cap color={c} number={7} />
                {c === 'white' ? 'Blanco' : 'Azul'}
              </button>
            ))}
          </div>
          <div class="squad__actions">
            <button
              class="btn btn--small"
              onClick={() => {
                actions.click();
                setSquad(autoSquad(team, benchSize, hand));
              }}
            >
              Automática
            </button>
            <button class="btn" disabled={problems.length > 0} onClick={play}>
              ¡A jugar!
            </button>
          </div>
          {problems.length > 0 && <p class="hint squad__problems">{problems.join(' · ')}</p>}
        </aside>
      </div>
    </section>
  );
}
