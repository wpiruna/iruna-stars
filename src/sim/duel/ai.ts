/**
 * AI for the shooter and the goalkeeper. Both produce the same inputs a human would (GDD: the
 * AI plays through the same interface), so the duel does not know who is in control.
 */
import { barFactor, clamp, lerp } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { AimSide, ShotMode } from '../shooting/model';
import type { Duel, KeeperInput, ShooterInput } from './duel';

export type Difficulty = 'facil' | 'normal' | 'dificil';

interface Range {
  min: number;
  max: number;
}
export interface PenaltyAiTuning {
  ia: {
    esperaAntesDeCargar: Range;
    errorCarga: Range;
    probTiroRapido: number;
    modos: { directo: number; bote: number; vaselina: number };
    probCentro: number;
    leerAlLanzador: Range;
    probQuedarse: number;
  };
  portero: { anticipoMaximo: number; probReapuntar: Record<Difficulty, number> };
  dificultad: Record<Difficulty, { leer: number; errorCarga: number }>;
}

export interface ShooterAiProfile {
  accuracy: number;
  skill: number;
}

/** Takes a penalty: waits, winds up towards the sweet spot and picks a corner. */
export class AiShooter {
  private readonly wait: number;
  private readonly hold: number;
  private side: AimSide;
  private readonly mode: ShotMode;
  private readonly fake: boolean;
  private reconsidered = false;

  constructor(
    private readonly rng: Rng,
    profile: ShooterAiProfile,
    private readonly tuning: PenaltyAiTuning,
    private readonly difficulty: Difficulty,
    shot: { segundosCarga: number; zonaOptimaCentro: number; segundosTiroRapido: number },
  ) {
    const ai = tuning.ia;
    this.wait = rng.range(ai.esperaAntesDeCargar.min, ai.esperaAntesDeCargar.max);
    const error =
      lerp(ai.errorCarga.max, ai.errorCarga.min, barFactor(profile.accuracy)) * tuning.dificultad[difficulty].errorCarga;
    const quick = rng.chance(ai.probTiroRapido);
    const charge = clamp(shot.zonaOptimaCentro + rng.gauss() * error, 0.3, 1);
    this.hold = quick ? shot.segundosTiroRapido * 0.5 : charge * shot.segundosCarga;

    const sideRoll = rng.next();
    this.side = sideRoll < ai.probCentro ? 0 : sideRoll < ai.probCentro + (1 - ai.probCentro) / 2 ? -1 : 1;
    const modeRoll = rng.next() * (ai.modos.directo + ai.modos.bote + ai.modos.vaselina);
    this.mode = modeRoll < ai.modos.directo ? 'direct' : modeRoll < ai.modos.directo + ai.modos.bote ? 'skip' : 'lob';
    // Skilful shooters sell the wrong corner more often.
    this.fake = rng.chance(lerp(0.04, 0.3, barFactor(profile.skill)));
  }

  next(duel: Duel): ShooterInput {
    const facing = duel.config.goal.facing;
    if (duel.phase === 'ready') {
      duel.tell = 0;
      return { shot: duel.time >= this.wait, pad: { x: 0, y: 0 } };
    }
    if (duel.phase !== 'charging') return { shot: false, pad: { x: 0, y: 0 } };

    // A keeper who moves too early gets punished: the shooter may change corner.
    if (!this.reconsidered && duel.chargeTime >= this.hold - 0.12) {
      this.reconsidered = true;
      const early = duel.commit && duel.commitAge > this.tuning.portero.anticipoMaximo;
      if (early && this.rng.chance(this.tuning.portero.probReapuntar[this.difficulty])) {
        this.side = (duel.commit?.side === 1 ? -1 : 1) as AimSide;
      }
    }
    // Body language: from mid wind-up the shoulders lean towards a corner (not always the real one).
    const shown = this.fake && duel.chargeTime < this.hold - 0.1 ? -this.side : this.side;
    duel.tell = duel.chargeTime > this.hold * 0.4 ? shown * 0.8 : 0;

    const x = this.mode === 'skip' ? facing : this.mode === 'lob' ? -facing : 0;
    return { shot: duel.chargeTime < this.hold, pad: { x, y: this.side } };
  }
}

/**
 * Keeps goal in a penalty: once the ball leaves, either reads the shot (better with Reflejos)
 * or guesses, and dives a few hundredths later the worse those reflexes are.
 */
export class AiKeeper {
  private choice: AimSide | null = null;
  private delay = 0;

  constructor(
    private readonly rng: Rng,
    private readonly reflexes: number,
    private readonly tuning: PenaltyAiTuning,
    private readonly difficulty: Difficulty,
  ) {}

  next(duel: Duel): KeeperInput {
    if (duel.phase !== 'flight' || !duel.plan) return { pad: { x: 0, y: 0 } };
    if (this.choice === null) {
      const ai = this.tuning.ia;
      const f = barFactor(this.reflexes);
      const read = clamp(lerp(ai.leerAlLanzador.min, ai.leerAlLanzador.max, f) * this.tuning.dificultad[this.difficulty].leer, 0, 0.9);
      const real: AimSide = Math.abs(duel.plan.aim.u) < 0.3 ? 0 : duel.plan.aim.u < 0 ? -1 : 1;
      if (this.rng.chance(read)) this.choice = real;
      else {
        const roll = this.rng.next();
        this.choice = roll < ai.probQuedarse ? 0 : roll < ai.probQuedarse + (1 - ai.probQuedarse) / 2 ? -1 : 1;
      }
      this.delay = lerp(0.06, 0, f);
    }
    return { pad: { x: 0, y: duel.flightTime >= this.delay ? this.choice : 0 } };
  }
}
