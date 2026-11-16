/**
 * The AI that plays with the ball (GDD §15): circulates, orders drives, shoots when the chance
 * is worth it, breaks forward on the counter and starts it from the keeper. It sees exactly
 * what a player sees (the same pass risk and shot models) and acts through the same actions.
 * Style changes how it plays, difficulty how quick and how clean its decisions are.
 */
import { barFactor, clamp, lerp } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { Style } from '../../data/model';
import type { Goal } from '../field';
import { toGoal } from '../attack/formation';
import { evaluatePass, type PassCandidate, type PassWorld } from '../attack/passing';
import type { AttackTuning, Swimmer } from '../attack/types';
import type { Difficulty } from '../duel/ai';
import type { AimSide, ShotMode } from '../shooting/model';
import type { MatchTuning } from './types';

export type BrainAction =
  | { type: 'pass'; to: PassCandidate }
  | { type: 'shoot'; hold: number; side: AimSide; mode: ShotMode }
  | { type: 'drive'; driver: Swimmer }
  | { type: 'none' };

export interface BrainView {
  time: number;
  phase: 'transition' | 'positional';
  holder: Swimmer;
  world: PassWorld;
  /** The goal being attacked. */
  goal: Goal;
  shotClock: number;
  drivesActive: number;
  /** Lateral position of the keeper they shoot at. */
  keeperU: number;
  /** Estimated chance that a shot by this player right now ends up in goal. */
  goalChance(shooter: Swimmer): number;
  /** There is a numerical advantage on the break. */
  advantage: boolean;
  /** A set piece: the throw must be a pass. */
  mustPass: boolean;
}

const STYLE_KEY: Record<Style, keyof MatchTuning['ia']['estilos']> = {
  balanced: 'equilibrado',
  fast: 'rapido',
  shooters: 'lanzadores',
  defensive: 'defensivo',
  physical: 'fisico',
  stars: 'estrellas',
};

export class Brain {
  private holder: Swimmer | null = null;
  private actAt = 0;
  private driveAt = -1;
  private lastPasser: Swimmer | null = null;
  private waits = 0;
  private readonly style: MatchTuning['ia']['estilos'][keyof MatchTuning['ia']['estilos']];
  private readonly level: MatchTuning['ia']['dificultad'][Difficulty];

  constructor(
    private readonly rng: Rng,
    private readonly t: MatchTuning,
    private readonly passTuning: AttackTuning['pase'],
    private readonly shot: { segundosCarga: number; zonaOptimaCentro: number; segundosTiroRapido: number },
    style: Style | undefined,
    difficulty: Difficulty,
  ) {
    this.style = t.ia.estilos[STYLE_KEY[style ?? 'balanced']];
    this.level = t.ia.dificultad[difficulty];
  }

  /** Forgets every plan (possession changed hands). */
  reset(): void {
    this.holder = null;
    this.lastPasser = null;
    this.driveAt = -1;
    this.waits = 0;
  }

  /** Who passed last to the current holder: the AI avoids giving it straight back. */
  passedBy(passer: Swimmer): void {
    this.lastPasser = passer;
  }

  private delayFor(v: BrainView): number {
    const ia = this.t.ia;
    if (v.holder.keeper) return this.rng.range(this.t.portero.espera.min, this.t.portero.espera.max);
    if (v.mustPass) return this.rng.range(this.t.saque.iaEspera.min, this.t.saque.iaEspera.max);
    if (v.phase === 'transition') return 0.15 + this.level.reaccion;
    return this.rng.range(ia.circulacion.min, ia.circulacion.max) * this.style.circulacion + this.level.reaccion;
  }

  decide(v: BrainView): BrainAction {
    if (v.holder !== this.holder) {
      this.holder = v.holder;
      this.actAt = v.time + this.delayFor(v);
      this.waits = 0;
      // Sometimes, while holding, send a team-mate on a drive (rápido more often).
      const p = this.t.ia.probEntrada * this.style.entrada;
      this.driveAt = v.phase === 'positional' && !v.mustPass && !v.holder.keeper && this.rng.chance(p) ? v.time + (this.actAt - v.time) * 0.35 : -1;
    }

    if (this.driveAt >= 0 && v.time >= this.driveAt) {
      this.driveAt = -1;
      const options = v.world.teammates.filter((m) => !m.keeper && m !== v.world.boya && !v.world.drives.has(m));
      if (options.length > 0 && v.drivesActive < 2) {
        // Leave time for the drive to develop before deciding.
        this.actAt = Math.max(this.actAt, v.time + 1.1);
        return { type: 'drive', driver: this.rng.pick(options) };
      }
    }
    if (v.time < this.actAt) return { type: 'none' };

    if (v.holder.keeper) return this.keeperPass(v);
    if (v.phase === 'transition' && !v.mustPass) return this.onTheBreak(v);
    return this.setAttack(v);
  }

  private setAttack(v: BrainView): BrainAction {
    const ia = this.t.ia;
    const late = v.shotClock <= ia.relojFinal;
    if (!v.mustPass) {
      const threshold = late ? ia.umbralTiroFinal : ia.umbralTiro * this.style.umbralTiro;
      if (v.goalChance(v.holder) >= threshold) return this.shoot(v);
    }
    let best: PassCandidate | null = null;
    let bestValue = -Infinity;
    for (const mate of v.world.teammates) {
      if (mate.keeper) continue;
      const c = evaluatePass(v.world, mate, this.passTuning);
      const drive = v.world.drives.get(mate);
      let value = v.goalChance(mate) - c.risk * ia.pesoRiesgo + this.rng.gauss() * this.level.ruido;
      if (drive?.free) value += 0.25;
      if (mate === v.world.boya && v.world.post > 0.3) value += 0.1;
      if (mate === this.lastPasser) value -= 0.1;
      if (value > bestValue) {
        bestValue = value;
        best = { ...c, angleError: 0, score: value };
      }
    }
    if (!best) return v.mustPass ? { type: 'none' } : this.shoot(v);
    // Everything covered: hold a little longer (twice at most) unless time is running out.
    if (best.risk > ia.riesgoMax && !late && this.waits < 2) {
      this.waits++;
      this.actAt = v.time + 0.4;
      return { type: 'none' };
    }
    if (late && !v.mustPass && best.risk > ia.riesgoMax) return this.shoot(v);
    this.actAt = v.time + 0.5;
    return { type: 'pass', to: best };
  }

  private onTheBreak(v: BrainView): BrainAction {
    const tr = this.t.ia.transicion;
    const own = toGoal(v.goal, v.holder.pos).distance;
    this.actAt = v.time + 0.15 + this.level.reaccion;
    // Forward pass to a team-mate clearly further up and safe.
    let best: PassCandidate | null = null;
    for (const mate of v.world.teammates) {
      if (mate.keeper) continue;
      const ahead = own - toGoal(v.goal, mate.pos).distance;
      if (ahead < tr.avanceMin) continue;
      const c = evaluatePass(v.world, mate, this.passTuning);
      if (c.risk > tr.riesgoMax) continue;
      if (!best || toGoal(v.goal, c.point).distance < toGoal(v.goal, best.point).distance) best = { ...c, angleError: 0, score: 0 };
    }
    if (best) return { type: 'pass', to: best };
    // On the break only a clear chance is worth a shot; otherwise the attack settles.
    if (own <= tr.distanciaTiro && v.goalChance(v.holder) >= this.t.ia.umbralTiro * tr.umbralTiro) return this.shoot(v);
    return { type: 'none' };
  }

  private keeperPass(v: BrainView): BrainAction {
    let best: PassCandidate | null = null;
    let bestValue = -Infinity;
    let safest: PassCandidate | null = null;
    for (const mate of v.world.teammates) {
      if (mate.keeper) continue;
      const c = evaluatePass(v.world, mate, this.passTuning);
      if (!safest || c.risk < safest.risk) safest = { ...c, angleError: 0, score: 0 };
      if (c.risk > this.t.portero.riesgoMax) continue;
      // The further up the pool, the better: that starts the counter.
      const value = (1 - toGoal(v.goal, c.point).distance / 25) * 1.5 - c.risk * 2 + this.rng.gauss() * this.level.ruido;
      if (value > bestValue) {
        bestValue = value;
        best = { ...c, angleError: 0, score: value };
      }
    }
    const choice = best ?? safest;
    return choice ? { type: 'pass', to: choice } : { type: 'none' };
  }

  /** How the AI releases a shot: a charge near the sweet spot, to the side the keeper leaves open. */
  private shoot(v: BrainView): BrainAction {
    const ia = this.t.ia;
    const distance = toGoal(v.goal, v.holder.pos).distance;
    const accuracy = barFactor(v.holder.player.stats.accuracy);
    const error = lerp(ia.carga.error.max, ia.carga.error.min, accuracy) * this.level.errorCarga;
    const quick = distance < 3.2 && this.rng.chance(0.6);
    const charge = clamp(this.shot.zonaOptimaCentro + this.rng.gauss() * error, 0.3, 1);
    const hold = quick ? this.shot.segundosTiroRapido * 0.5 : charge * this.shot.segundosCarga;
    const away: AimSide = v.keeperU > 0.05 ? -1 : v.keeperU < -0.05 ? 1 : this.rng.chance(0.5) ? -1 : 1;
    const side: AimSide = this.rng.chance(0.75) ? away : ((-away) as AimSide);
    let mode: ShotMode = 'direct';
    if (!quick && distance > 4) {
      const roll = this.rng.next() * (ia.modos.directo + ia.modos.bote + ia.modos.vaselina);
      mode = roll < ia.modos.directo ? 'direct' : roll < ia.modos.directo + ia.modos.bote ? 'skip' : 'lob';
    }
    this.actAt = v.time + 1;
    return { type: 'shoot', hold, side, mode };
  }
}
