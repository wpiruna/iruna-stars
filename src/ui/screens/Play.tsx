/** In-game HUD: scoreboard, big captions, who is up, control hints, pause and the lab panel. */
import { useState } from 'preact/hooks';
import type { InputDevice } from '../../app/platform';
import { DEFAULT_LAB_SETTINGS } from '../../app/play';
import { imageUrl, playerPlaceholder } from '../../data/images';
import { LAB_SPOTS, type LabSettings } from '../../sim/duel/lab';
import { Shield } from '../components/Shield';
import { useApp } from '../context';
import { hud, type HudTeam } from '../hud';
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
          {mode === 'lab' ? 'Reiniciar el laboratorio' : 'Empezar la tanda de nuevo'}
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
