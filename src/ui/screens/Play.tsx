/** In-game HUD: scoreboard, big captions, who is up, control hints, pause and the lab panel. */
import { useState } from 'preact/hooks';
import type { InputDevice } from '../../app/platform';
import { DEFAULT_LAB_SETTINGS } from '../../app/play';
import { imageUrl, playerPlaceholder } from '../../data/images';
import { LAB_SPOTS, type LabSettings } from '../../sim/duel/lab';
import { Shield } from '../components/Shield';
import { useApp } from '../context';
import { hud, type HudMatchStats, type HudTeam } from '../hud';
import { useStore } from '../store';

const SHOOT_HINT: Record<InputDevice, string> = {
  touch: 'Mantén TIRO para cargar y suelta en la zona verde. Con el pad: ↑ ↓ palo, → bote, ← vaselina.',
  keyboard: 'Mantén K (o X) para cargar y suelta en la zona verde. Flechas: ↑ ↓ palo, → bote, ← vaselina.',
  gamepad: 'Mantén A / ✕ para cargar y suelta en la zona verde. Stick: ↑ ↓ palo, → bote, ← vaselina.',
};
const KEEP_HINT: Record<InputDevice, string> = {
  touch: 'Fíjate en sus hombros y, cuando tire, pad ↑ o ↓ para lanzarte.',
  keyboard: 'Fíjate en sus hombros y, cuando tire, flecha ↑ o ↓ para lanzarte.',
  gamepad: 'Fíjate en sus hombros y, cuando tire, stick ↑ o ↓ para lanzarte.',
};

function Marks({ team, total }: { team: HudTeam; total: number }) {
  // Sudden death keeps adding marks; only the latest ones are shown.
  const shown = Math.max(total, team.kicks.length);
  const from = Math.max(0, shown - Math.max(total, 5));
  return (
    <span class="marks">
      {Array.from({ length: shown - from }, (_, i) => {
        const kick = team.kicks[from + i];
        return <i class={kick === undefined ? '' : kick ? 'in' : 'out'} />;
      })}
    </span>
  );
}

function Scoreboard() {
  const { teams, kicksPerTeam, suddenDeath } = useStore(hud);
  if (!teams) return null;
  const goals = (team: HudTeam): number => team.kicks.filter(Boolean).length;
  return (
    <div class="scoreboard">
      <div class="scoreboard__team">
        <Shield id={teams[0].id} code={teams[0].code} image={teams[0].shield} size={2.6} />
        <span class="scoreboard__code">{teams[0].code}</span>
        <Marks team={teams[0]} total={kicksPerTeam} />
      </div>
      <div class="scoreboard__score">
        <b>{goals(teams[0])}</b>
        <span>{suddenDeath ? 'MUERTE SÚBITA' : 'PENALTIS'}</span>
        <b>{goals(teams[1])}</b>
      </div>
      <div class="scoreboard__team scoreboard__team--right">
        <Marks team={teams[1]} total={kicksPerTeam} />
        <span class="scoreboard__code">{teams[1].code}</span>
        <Shield id={teams[1].id} code={teams[1].code} image={teams[1].shield} size={2.6} />
      </div>
    </div>
  );
}

function Banner() {
  const { banner } = useStore(hud);
  if (!banner) return null;
  return (
    <div class={`banner banner--${banner.tone}`} key={banner.id}>
      <span class="banner__text">{banner.text}</span>
      {banner.detail && <span class="banner__detail">{banner.detail}</span>}
    </div>
  );
}

function TurnCard() {
  const { role, actor, rival, aim, timeLeft, device, mode } = useStore(hud);
  if (mode !== 'shootout' || !actor || !role) return null;
  const photo = imageUrl(actor.photo) ?? playerPlaceholder(actor.number, actor.keeper);
  return (
    <div class="turn">
      <div class="turn__photo">
        <img src={photo} alt="" />
      </div>
      <div class="turn__text">
        <span class="turn__role">{role === 'shooter' ? 'Tiras tú' : 'Paras tú'}</span>
        <strong>
          <b>{actor.number}</b> {actor.nickname}
        </strong>
        <span class="turn__rival">
          {role === 'shooter' ? 'contra' : 'tira'} el Nº {rival?.number} {rival?.nickname}
        </span>
      </div>
      <p class="turn__hint">{aim !== '' ? aim : role === 'shooter' ? SHOOT_HINT[device] : KEEP_HINT[device]}</p>
      {timeLeft !== null && role === 'shooter' && timeLeft <= 5 && <span class="turn__clock">{timeLeft}</span>}
    </div>
  );
}

const PAD_LABEL: Record<string, Record<InputDevice, string>> = {
  sprint: { touch: '¡Machaca HABILIDAD!', keyboard: '¡Machaca J!', gamepad: '¡Machaca X/□!' },
  pass: { touch: '⇄ Pad: pasar', keyboard: '⇄ Flechas: pasar', gamepad: '⇄ Stick: pasar' },
  swim: { touch: '✋ Mantén: nadar · toque: pasar', keyboard: '✋ Mantén: nadar · toque: pasar', gamepad: '✋ Mantén: nadar · toque: pasar' },
  keeper: { touch: 'Toca hacia un compañero para sacar', keyboard: 'Toca una flecha para sacar', gamepad: 'Toca el stick para sacar' },
  defend: {
    touch: '🛡 Toque: cambiar · mantén: nadar · HABILIDAD: robar · TIRO: agarrar',
    keyboard: '🛡 Toque: cambiar · mantén: nadar · J: robar · K: agarrar',
    gamepad: '🛡 Toque: cambiar · mantén: nadar · X/□: robar · A/✕: agarrar',
  },
  shoot: {
    touch: '¡PENALTI! Mantén TIRO para cargar · pad: apuntar',
    keyboard: '¡PENALTI! Mantén K para cargar · flechas: apuntar',
    gamepad: '¡PENALTI! Mantén A/✕ para cargar · stick: apuntar',
  },
  save: {
    touch: '¡PENALTI! Pad ↑ o ↓ para estirarte cuando tire',
    keyboard: '¡PENALTI! ↑ o ↓ para estirarte cuando tire',
    gamepad: '¡PENALTI! Stick ↑ o ↓ para estirarte cuando tire',
  },
};

const clockText = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const PERIOD = ['', '1º', '2º', '3º', '4º', '5º', '6º'];

/** Television scoreboard and what the pad does right now (GDD §4 and §16). */
function MatchHud() {
  const { match, device, replay } = useStore(hud);
  if (!match) return null;
  if (replay) {
    return (
      <div class="replay-tag">
        <b>● REPETICIÓN</b>
        <span>{device === 'touch' ? 'Toca para saltar' : 'Pulsa un botón para saltar'}</span>
      </div>
    );
  }
  const shotUrgent = match.shotClock <= 5 && (match.phase === 'transition' || match.phase === 'positional');
  const label = PAD_LABEL[match.padMode]?.[device];
  return (
    <>
      <div class="scoreboard scoreboard--match">
        <div class={`scoreboard__team${match.possession === 0 ? ' scoreboard__team--ball' : ''}`}>
          <Shield id={match.ours.id} code={match.ours.code} image={match.ours.shield} size={2.6} />
          <span class="scoreboard__code">{match.ours.code}</span>
        </div>
        <div class="scoreboard__score">
          <b>{match.score[0]}</b>
          <span class="scoreboard__time">
            <em>{PERIOD[match.period]}</em>
            {clockText(match.clock)}
          </span>
          <b>{match.score[1]}</b>
        </div>
        <div class={`scoreboard__team scoreboard__team--right${match.possession === 1 ? ' scoreboard__team--ball' : ''}`}>
          <span class="scoreboard__code">{match.rival.code}</span>
          <Shield id={match.rival.id} code={match.rival.code} image={match.rival.shield} size={2.6} />
        </div>
        <div class={`scoreboard__shot${shotUrgent ? ' scoreboard__shot--urgent' : ''}`}>{match.shotClock}</div>
      </div>
      {match.manUp && (
        <div class={`man-up man-up--${match.manUp.ours ? 'ours' : 'theirs'}`}>
          {match.manUp.ours ? 'SUPERIORIDAD' : 'INFERIORIDAD'} <b>{match.manUp.count}</b> · {match.manUp.seconds}
        </div>
      )}
      {label && match.padMode !== 'none' && <div class={`pad-mode pad-mode--${match.padMode}`}>{label}</div>}
    </>
  );
}

const ATTACK_HINT: Record<InputDevice, string> = {
  touch: 'Pad: pasar · HABILIDAD + pad: entrada · TIRO: tirar · HABILIDAD sola: escapada / giro del boya',
  keyboard: 'Flechas: pasar · J + flecha: entrada · K: tirar · J sola: escapada / giro del boya',
  gamepad: 'Stick: pasar · X/□ + stick: entrada · A/✕: tirar · X/□ sola: escapada / giro del boya',
};

const MAN_UP_HINT: Record<InputDevice, string> = {
  touch: 'Pad: pasar rápido · HABILIDAD + pad: rotar 4-2 ⇄ 3-3 · TIRO: tirar',
  keyboard: 'Flechas: pasar rápido · J + flecha: rotar 4-2 ⇄ 3-3 · K: tirar',
  gamepad: 'Stick: pasar rápido · X/□ + stick: rotar 4-2 ⇄ 3-3 · A/✕: tirar',
};

const DEFEND_HINT: Record<InputDevice, string> = {
  touch: 'Toque: cambiar de defensor · HABILIDAD: robar o tapar · TIRO: agarrar (¡cuidado con el árbitro!)',
  keyboard: 'Flechas: cambiar de defensor · J: robar o tapar · K: agarrar (¡cuidado con el árbitro!)',
  gamepad: 'Stick: cambiar de defensor · X/□: robar o tapar · A/✕: agarrar (¡cuidado con el árbitro!)',
};

/** Attack training strip: shot clock, score of the session and a one-line reminder of the controls. */
function AttackHud() {
  const { attack, device } = useStore(hud);
  if (!attack) return null;
  const urgent = attack.clock <= 5;
  return (
    <>
      <div class="scoreboard scoreboard--attack">
        <div class="scoreboard__team">
          <Shield id={attack.ours.id} code={attack.ours.code} image={attack.ours.shield} size={2.6} />
          <span class="scoreboard__code">{attack.ours.code}</span>
        </div>
        <div class={`scoreboard__clock${urgent ? ' scoreboard__clock--urgent' : ''}`}>
          <b>{attack.clock}</b>
          <span>POSESIÓN</span>
        </div>
        <div class="scoreboard__team scoreboard__team--right">
          <span class="scoreboard__code">{attack.rival.code}</span>
          <Shield id={attack.rival.id} code={attack.rival.code} image={attack.rival.shield} size={2.6} />
        </div>
      </div>
      <div class="attack-tally">
        {attack.defending ? 'Defensa' : 'Ataque'} <b>{attack.attacks}</b> · <b>{attack.goals}</b> {attack.goals === 1 ? 'gol' : 'goles'}
        {attack.defending ? ' encajados' : ''} · <b>{attack.shots}</b> {attack.shots === 1 ? 'tiro' : 'tiros'} · <b>{attack.turnovers}</b>{' '}
        {attack.defending ? (attack.turnovers === 1 ? 'balón recuperado' : 'balones recuperados') : attack.turnovers === 1 ? 'pérdida' : 'pérdidas'}
      </div>
      <p class="attack-hint">{attack.defending ? DEFEND_HINT[device] : attack.scenario === 'superioridad' ? MAN_UP_HINT[device] : ATTACK_HINT[device]}</p>
    </>
  );
}

function Bar(props: { label: string; value: number; onChange(value: number): void }) {
  return (
    <label class="lab__bar">
      <span>
        {props.label} <b>{props.value}</b>
      </span>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={props.value}
        onInput={(event) => props.onChange(Number((event.target as HTMLInputElement).value))}
      />
    </label>
  );
}

function LabPanel() {
  const { actions } = useApp();
  const { lab, aim, device } = useStore(hud);
  const [settings, setSettings] = useState<LabSettings>(DEFAULT_LAB_SETTINGS);
  // Closed by default so it never covers the shooter; one tap opens the sliders.
  const [open, setOpen] = useState(false);
  if (!lab) return null;
  const change = (patch: Partial<LabSettings>): void => {
    const next = { ...settings, ...patch };
    setSettings(next);
    actions.configureLab(next);
  };
  const rate = lab.shots === 0 ? '–' : `${Math.round((lab.goals / lab.shots) * 100)} %`;
  return (
    <aside class={`lab${open ? '' : ' lab--closed'}`}>
      <header>
        <strong>Laboratorio de tiro</strong>
        <button class="lab__toggle" onClick={() => setOpen(!open)}>
          {open ? 'Ocultar' : 'Ajustar'}
        </button>
      </header>
      {open && (
        <>
          <div class="lab__spots">
            {LAB_SPOTS.map((spot) => (
              <button class={settings.spot.id === spot.id ? 'on' : ''} onClick={() => change({ spot })}>
                {spot.label}
              </button>
            ))}
          </div>
          <div class="lab__bars">
            <Bar label="Potencia" value={settings.power} onChange={(power) => change({ power })} />
            <Bar label="Precisión" value={settings.accuracy} onChange={(accuracy) => change({ accuracy })} />
            <Bar label="Reflejos del portero" value={settings.reflexes} onChange={(reflexes) => change({ reflexes })} />
            <Bar label="Colocación del portero" value={settings.positioning} onChange={(positioning) => change({ positioning })} />
          </div>
        </>
      )}
      <p class="lab__stats">
        <b>{lab.goals}</b> goles de <b>{lab.shots}</b> ({rate}) · {lab.saves} paradas · {lab.posts} palos · {lab.misses} fuera
        <button class="lab__reset" onClick={actions.resetLabStats}>
          A cero
        </button>
      </p>
      <p class="lab__last">{aim !== '' ? aim : lab.last !== '' ? lab.last : SHOOT_HINT[device]}</p>
    </aside>
  );
}

function PauseMenu() {
  const { actions } = useApp();
  const { paused, mode } = useStore(hud);
  if (!paused) return null;
  return (
    <div class="pause">
      <div class="pause__box">
        <h2 class="heading heading--big">Pausa</h2>
        <button class="btn" onClick={() => actions.setPaused(false)}>
          Continuar
        </button>
        <button class="btn" onClick={actions.restartPlay}>
          {mode === 'lab'
            ? 'Reiniciar el laboratorio'
            : mode === 'attack'
              ? 'Empezar de cero'
              : mode === 'match'
                ? 'Empezar el partido de nuevo'
                : 'Empezar la tanda de nuevo'}
        </button>
        <button class="btn" onClick={actions.exitPlay}>
          Salir al menú
        </button>
      </div>
    </div>
  );
}

export function Play() {
  const { actions } = useApp();
  const { device, paused, mode } = useStore(hud);
  return (
    <section class="play">
      <Scoreboard />
      <AttackHud />
      <MatchHud />
      <Banner />
      <TurnCard />
      <LabPanel />
      {/* Touch has its own pause button next to the controls. */}
      {device !== 'touch' && !paused && (
        <button class="play__pause" onClick={() => actions.setPaused(true)}>
          {mode === 'lab' ? 'Salir / pausa' : 'Pausa'} <kbd>{device === 'gamepad' ? 'Start' : 'Esc'}</kbd>
        </button>
      )}
      <PauseMenu />
    </section>
  );
}

export function ShootoutResult() {
  const { actions } = useApp();
  const { result, teams } = useStore(hud);
  if (!result || !teams) return null;
  return (
    <section class={`screen result result--${result.won ? 'won' : 'lost'}`}>
      <h2 class="result__title">{result.won ? '¡VICTORIA!' : 'DERROTA'}</h2>
      <div class="result__score">
        <div>
          <Shield id={teams[0].id} code={teams[0].code} image={teams[0].shield} size={6} />
          <span>{teams[0].name}</span>
        </div>
        <strong>
          {result.score[0]} – {result.score[1]}
        </strong>
        <div>
          <Shield id={teams[1].id} code={teams[1].code} image={teams[1].shield} size={6} />
          <span>{teams[1].name}</span>
        </div>
      </div>
      {result.phrase !== '' && <p class="result__phrase">«{result.phrase}»</p>}
      <div class="result__actions">
        <button class="btn" onClick={actions.restartPlay}>
          Otra tanda
        </button>
        <button class="btn" onClick={actions.exitPlay}>
          Menú
        </button>
      </div>
    </section>
  );
}

const STAT_ROWS: [Exclude<keyof HudMatchStats, 'possession' | 'goals'>, string][] = [
  ['shots', 'Tiros'],
  ['onTarget', 'Tiros a puerta'],
  ['saves', 'Paradas'],
  ['steals', 'Robos'],
  ['turnovers', 'Pérdidas'],
  ['counterattacks', 'Contras con superioridad'],
  ['fouls', 'Faltas'],
  ['exclusions', 'Exclusiones'],
  ['penalties', 'Penaltis cometidos'],
];

const cards = (s: HudMatchStats): string => [s.yellows > 0 ? `${s.yellows} 🟨` : '', s.reds > 0 ? `${s.reds} 🟥` : ''].filter(Boolean).join(' ') || '—';

/** Final whistle: score, statistics and a line from the bench. */
export function MatchResult() {
  const { actions } = useApp();
  const { result, match } = useStore(hud);
  if (!result || !match) return null;
  const title = result.draw ? 'EMPATE' : result.won ? '¡VICTORIA!' : 'DERROTA';
  const stats = match.stats;
  const total = stats ? stats[0].possession + stats[1].possession : 0;
  return (
    <section class={`screen result result--${result.draw ? 'draw' : result.won ? 'won' : 'lost'}`}>
      <h2 class="result__title">{title}</h2>
      <div class="result__score">
        <div>
          <Shield id={match.ours.id} code={match.ours.code} image={match.ours.shield} size={5} />
          <span>{match.ours.name}</span>
        </div>
        <strong>
          {result.score[0]} – {result.score[1]}
        </strong>
        <div>
          <Shield id={match.rival.id} code={match.rival.code} image={match.rival.shield} size={5} />
          <span>{match.rival.name}</span>
        </div>
      </div>
      {stats && (
        <table class="match-stats">
          <tbody>
            {STAT_ROWS.map(([key, label]) => (
              <tr>
                <td>{stats[0][key]}</td>
                <th>{label}</th>
                <td>{stats[1][key]}</td>
              </tr>
            ))}
            <tr>
              <td>
                {stats[0].manUpGoals}/{stats[0].manUp}
              </td>
              <th>Goles en superioridad</th>
              <td>
                {stats[1].manUpGoals}/{stats[1].manUp}
              </td>
            </tr>
            {stats[0].yellows + stats[1].yellows + stats[0].reds + stats[1].reds > 0 && (
              <tr>
                <td>{cards(stats[0])}</td>
                <th>Tarjetas</th>
                <td>{cards(stats[1])}</td>
              </tr>
            )}
            <tr>
              <td>{total > 0 ? Math.round((100 * stats[0].possession) / total) : 50} %</td>
              <th>Posesión</th>
              <td>{total > 0 ? Math.round((100 * stats[1].possession) / total) : 50} %</td>
            </tr>
          </tbody>
        </table>
      )}
      {match.referee !== '' && <p class="result__referee">Árbitro: {match.referee}</p>}
      {result.phrase !== '' && <p class="result__phrase">«{result.phrase}»</p>}
      <div class="result__actions">
        <button class="btn" onClick={actions.restartPlay}>
          Revancha
        </button>
        <button class="btn" onClick={actions.exitPlay}>
          Menú
        </button>
      </div>
    </section>
  );
}
