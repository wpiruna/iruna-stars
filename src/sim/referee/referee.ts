/**
 * The referee (GDD §13): decides whether to whistle what the rules engine has classified.
 *
 * Safeguards so it feels like a referee and not like a game that cheats:
 * - it never invents: it can only call what the rules say is a foul, and it may let it go as
 *   something lighter, never heavier;
 * - most of its randomness is drawn once per match (its "day"): it calls things in a similar way
 *   all match long, so the player can learn how it whistles;
 * - the bias moves a probability by a bounded amount and every probability stays within limits.
 */
import { clamp } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { Referee as RefereeData } from '../../data/model';
import type { CardMode } from '../../data/schema';
import type { TeamSide } from '../attack/types';
import { softer, type Classified, type Contact, type Motive, type Sanction } from '../rules/rules';

export type RefereeTuning = (typeof import('../../../data/tuning.json'))['arbitro'];

export type RefereeProfile = Pick<RefereeData, 'contactTolerance' | 'exclusionTendency' | 'cardTendency' | 'bias' | 'consistency'>;

export interface Offender {
  /** Stable id of the player (for cards). */
  id: string;
  /** 0 = our team: the bias of the referee is measured against it. */
  side: TeamSide;
  /** Agresividad, 1–10. */
  aggression: number;
}

export interface Call {
  sanction: Sanction;
  motive: Motive;
  card: 'yellow' | 'red' | null;
  /** In "reglamento" mode: the referee warns the whole team (yellow to the team, WP 18.2.4). */
  teamWarning: boolean;
  /** Probability with which the call was made (for the debug layer and the tests). */
  chance: number;
}

const logit = (p: number): number => Math.log(p / (1 - p));
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

const BASE_KEY: Record<Exclude<Sanction, 'none'>, keyof RefereeTuning['base']> = {
  ordinary: 'ordinaria',
  exclusion: 'exclusion',
  penalty: 'penalti',
  violent: 'violenta',
};

export class Referee {
  /** The referee's "day": a shift of its whole scale, drawn once per match. */
  readonly day: number;
  private readonly yellows = new Map<string, number>();
  private readonly teamExclusions: [number, number] = [0, 0];
  readonly warned: [boolean, boolean] = [false, false];

  constructor(
    readonly profile: RefereeProfile,
    private readonly t: RefereeTuning,
    private readonly cardMode: CardMode,
    private readonly yellowsForRed: number,
    private readonly rng: Rng,
  ) {
    this.day = rng.gauss() * t.ruido.dia * this.spread;
  }

  /** 0 for the most consistent referee (10), 1 for the least (1). */
  private get spread(): number {
    return clamp((10 - this.profile.consistency) / 9, 0, 1);
  }

  yellowsOf(id: string): number {
    return this.yellows.get(id) ?? 0;
  }

  /**
   * Probability of whistling a sanction of this kind for this contact, without the per-call noise
   * (that is added when judging). The bias is applied last and bounded.
   */
  chance(sanction: Exclude<Sanction, 'none'>, contact: Pick<Contact, 'intensity' | 'inSixMetres' | 'counterAttack'>, offender: Offender, noise = 0): number {
    const { t, profile } = this;
    const w = t.pesos;
    let x = logit(t.base[BASE_KEY[sanction]]);
    x += w.intensidad * (contact.intensity - 0.5);
    x += w.agresividad * (offender.aggression - 5);
    x -= w.tolerancia * (profile.contactTolerance - 5);
    if (sanction !== 'ordinary') x += w.exclusiones * (profile.exclusionTendency - 5);
    if (contact.inSixMetres) x += t.zona.seisMetros;
    if (contact.counterAttack) x += t.zona.contraataque;
    x += this.day + noise;
    const p = sigmoid(x);
    // Bias: against us it multiplies, in our favour it shrinks (GDD §13), bounded either way.
    const b = profile.bias;
    const factor = offender.side === 0 ? 1 + t.sesgo.contraNosotros * b : 1 - t.sesgo.aFavor * b;
    const biased = p + clamp(p * factor - p, -t.sesgo.maximo, t.sesgo.maximo);
    return clamp(biased, t.limites.min, t.limites.max);
  }

  /** Decides on a classified contact: whistle it, let it go as something lighter, or play on. */
  judge(classified: Classified, contact: Contact, offender: Offender): Call {
    const none: Call = { sanction: 'none', motive: classified.motive, card: null, teamWarning: false, chance: 0 };
    let sanction = classified.sanction;
    let motive = classified.motive;
    let damping = 1;
    while (sanction !== 'none') {
      const noise = this.rng.gauss() * this.t.ruido.jugada * this.spread;
      const p = this.chance(sanction, contact, offender, noise) * damping;
      if (this.rng.chance(p)) return this.cards({ sanction, motive, card: null, teamWarning: false, chance: p }, contact, offender);
      // Not that: maybe something lighter, less and less likely.
      const next = softer(sanction, contact.victimHasBall);
      if (next !== 'none' && motive === 'GOL CLARO') motive = 'FALTA';
      sanction = next;
      damping *= this.t.rebaja;
    }
    return none;
  }

  private cards(call: Call, contact: Contact, offender: Offender): Call {
    const t = this.t.tarjetas;
    if (call.sanction === 'violent') return { ...call, card: 'red' };
    if (call.sanction === 'exclusion' || call.sanction === 'penalty') this.teamExclusions[offender.side]++;
    const hard = contact.intensity >= t.intensidad;
    const p = sigmoid(logit(t.base) + t.peso * (this.profile.cardTendency - 5) + t.porIntensidad * (contact.intensity - t.intensidad));
    if (this.cardMode === 'arcade') {
      // Yellow: a warning to the player for a very aggressive contact; another one is a red.
      if (!hard || call.sanction === 'none' || !this.rng.chance(p)) return call;
      const count = this.yellowsOf(offender.id) + 1;
      this.yellows.set(offender.id, count);
      return { ...call, card: count >= this.yellowsForRed ? 'red' : 'yellow' };
    }
    // Rulebook: persistent fouls earn the team a yellow; after it, the next hard one is a red (WP 18.4).
    if (this.warned[offender.side]) {
      if (hard && this.rng.chance(p)) return { ...call, card: 'red' };
      return call;
    }
    if (this.teamExclusions[offender.side] >= t.avisoEquipoTrasExclusiones && this.rng.chance(p)) {
      this.warned[offender.side] = true;
      return { ...call, teamWarning: true };
    }
    return call;
  }
}
