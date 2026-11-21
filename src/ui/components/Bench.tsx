/**
 * The bench (GDD §11.3): who is in the water and who is waiting, with their energy; tap the one
 * going off and then the one coming in. Also Emilio's speech bubble in the match.
 */
import { useState } from 'preact/hooks';
import { imageUrl, personPlaceholder, playerPlaceholder } from '../../data/images';
import { POSITION_LABEL } from '../../data/model';
import { useApp } from '../context';
import { hud, type HudBenchPlayer } from '../hud';
import { useStore } from '../store';

function EnergyBar({ energy }: { energy: number }) {
  const pct = Math.round(energy * 100);
  const tone = energy < 0.25 ? 'low' : energy < 0.5 ? 'mid' : 'ok';
  return (
    <span class={`energy energy--${tone}`} title={`Energía ${pct} %`}>
      <i style={{ width: `${pct}%` }} />
      <b>{pct} %</b>
    </span>
  );
}

function BenchCard(props: { player: HudBenchPlayer; tag?: string; tone?: 'out' | 'in'; picked?: boolean; onPick(): void }) {
  const { player, tag, tone, picked } = props;
  const photo = imageUrl(player.photo) ?? playerPlaceholder(player.number, player.position === 'goalkeeper');
  const classes = ['bench-card', `bench-card--${player.position}`, picked ? 'bench-card--picked' : '', tone ? `bench-card--${tone}` : '', player.excluded ? 'bench-card--excluded' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button class={classes} onClick={props.onPick} disabled={player.excluded}>
      <span class={`portrait${player.photo ? ' portrait--photo' : ''}`}>
        <img src={photo} alt="" draggable={false} />
      </span>
      <span class="bench-card__number">{player.number}</span>
      {tag && <span class="bench-card__tag">{tag}</span>}
      <span class="bench-card__name">{player.nickname}</span>
      <span class="bench-card__position">{player.excluded ? 'Excluido' : POSITION_LABEL[player.position]}</span>
      <EnergyBar energy={player.energy} />
    </button>
  );
}

export function EmilioFace({ size = 4 }: { size?: number }) {
  const { data } = useApp();
  const photo = imageUrl(data.club.presidentPhoto) ?? personPlaceholder('president');
  return (
    <span class="emilio__face" style={{ width: `${size}rem`, height: `${size}rem` }}>
      <img src={photo} alt={data.club.president} draggable={false} />
    </span>
  );
}

const TITLE = { pause: 'Banquillo', timeout: 'Tiempo muerto', break: 'Descanso' } as const;

export function BenchPanel() {
  const { actions, data } = useApp();
  const { bench } = useStore(hud);
  const [picked, setPicked] = useState<string | null>(null);
  if (!bench) return null;
  const outOf = new Map(bench.changes.map((c) => [c.out, c.in]));
  const inFor = new Map(bench.changes.map((c) => [c.in, c.out]));
  const numberOf = (id: string): number | undefined => [...bench.water, ...bench.bench].find((p) => p.id === id)?.number;
  const now = bench.reason !== 'pause';
  const pickWater = (id: string): void => {
    actions.click();
    if (outOf.has(id)) {
      actions.benchChange(id, null);
      setPicked(null);
    } else setPicked(picked === id ? null : id);
  };
  const pickBench = (id: string): void => {
    if (!picked) {
      actions.click();
      return;
    }
    actions.benchChange(picked, id);
    setPicked(null);
  };
  const hint = picked
    ? 'Ahora toca al suplente que entra.'
    : bench.bench.length === 0
      ? 'No quedan suplentes en el banquillo.'
      : `Toca al que sale y luego al que entra. ${
          now || bench.deadBall ? 'Los cambios entran al volver al juego.' : 'Entran en la próxima parada del juego: una falta, un gol, un fuera…'
        }`;
  return (
    <div class="bench">
      <div class="bench__box">
        <header class="bench__header">
          <h2 class="heading heading--big">{TITLE[bench.reason]}</h2>
          <p class="bench__hint">{hint}</p>
        </header>
        {bench.tip !== '' && (
          <div class="bench__tip">
            <EmilioFace size={3.4} />
            <p>
              <b>{data.club.president}:</b> «{bench.tip}»
            </p>
          </div>
        )}
        <h3 class="bench__row-title">En el agua</h3>
        <div class="bench__row">
          {bench.water.map((p) => {
            const going = outOf.get(p.id);
            const tag = going ? `SALE · entra el ${numberOf(going) ?? ''}` : undefined;
            return <BenchCard player={p} picked={picked === p.id} onPick={() => pickWater(p.id)} {...(tag ? { tag, tone: 'out' as const } : {})} />;
          })}
        </div>
        <h3 class="bench__row-title">Banquillo</h3>
        <div class="bench__row">
          {bench.bench.length === 0 && <p class="bench__empty">Sin suplentes.</p>}
          {bench.bench.map((p) => {
            const coming = inFor.get(p.id);
            const tag = coming ? `ENTRA · por el ${numberOf(coming) ?? ''}` : undefined;
            return <BenchCard player={p} onPick={() => pickBench(p.id)} {...(tag ? { tag, tone: 'in' as const } : {})} />;
          })}
        </div>
        <div class="bench__actions">
          <button
            class="btn"
            onClick={() => {
              setPicked(null);
              actions.closeBench();
            }}
          >
            {now ? '¡A jugar!' : 'Volver'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Emilio shouting from the bench in the match (a player is exhausted). */
export function EmilioBubble() {
  const { emilio, bench, paused } = useStore(hud);
  if (!emilio || bench || paused) return null;
  return (
    <div class="emilio" key={emilio.id}>
      <EmilioFace />
      <p class="emilio__bubble">
        <b>{emilio.text}</b>
        {emilio.who && <span>{emilio.who}</span>}
      </p>
    </div>
  );
}
