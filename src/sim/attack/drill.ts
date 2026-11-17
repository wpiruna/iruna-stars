/**
 * Positional attack drill (F2): our six against six defenders and their keeper, from a set
 * attack until it ends (goal, save, miss, steal, interception, lost ball or shot clock), then
 * again. The AI keeps the structure; the player decides where the ball goes, who drives and
 * when to shoot (GDD §1, §5.3 and §6). Pure simulation, fixed 60 Hz steps, seeded randomness.
 */
import { STEP_MS } from '../../core/loop';
import { barFactor, clamp, lerp } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { Player } from '../../data/model';
import type { FormationsData } from '../../data/schema';
import { aimFromPad, type Aim, type DuelConfig } from '../duel/duel';
import type { Field, Goal, Vec2 } from '../field';
import { planShot, resolveShot, type KeeperTuning, type ShotPlan } from '../shooting/model';
import { ballAt, goalVelocity, keepInNet, POOL_WALL } from '../shooting/trajectory';
import { AttackInput, type PadState } from './control';
import { driveDestination, insidePoint, startDrive, stepDrive, type Drive } from './drive';
import { assign, slotCost, slotPoint } from './formation';
import { KeeperBody } from './keeper';
import { moveSwimmers, updateFacing } from './movement';
import { chooseDriver, choosePass, type DriveInfo, type PassCandidate, type PassChoice, type PassWorld } from './passing';
import type { AttackEvent, AttackResult, AttackTuning, BallState, Slot, Swimmer, TeamSide } from './types';
import { add, dir, dist, dot, lerp2, norm, sigmoid, toSegment, v2 } from './vec';

const DT = STEP_MS / 1000;

export type DefenseStyle = 'press' | 'zone';
export type AttackPhase = 'setup' | 'live' | 'ended';

export interface AttackSetup {
  field: Field;
  formations: FormationsData;
  /** Our players and their slots. */
  lineup: ReadonlyMap<Player, Slot>;
  /** Their field players and the slot of the attacker each one marks. */
  marking: ReadonlyMap<Player, Slot>;
  keeper: Player;
  defenseStyle: DefenseStyle;
  /** Scoreboard seconds of the first and second possession, and how fast that clock runs. */
  possession: { first: number; second: number; clockSpeed: number };
  tuning: AttackTuning;
  shot: DuelConfig['shot'];
  keeperTuning: KeeperTuning;
  /** Vertical squash of the camera, to turn screen pad directions into pool directions. */
  tilt: number;
  rng: Rng;
}

export interface Charging {
  shooter: Swimmer;
  time: number;
  charge: number;
  aim: Aim;
}

export interface Selection {
  swimmer: Swimmer;
  /** Where the drive would go; null for the centre (a fight for position). */
  destination: Vec2 | null;
}

export interface AttackStats {
  attacks: number;
  goals: number;
  shots: number;
  turnovers: number;
}

type Buffered = { kind: 'pass'; aim: Vec2; at: number } | { kind: 'shot'; at: number; released: number | null };

function makeSwimmer(player: Player, team: TeamSide, keeper: boolean, t: AttackTuning): Swimmer {
  return {
    id: `${team}-${player.id}`,
    player,
    team,
    keeper,
    topSpeed: lerp(t.nado.velocidad.min, t.nado.velocidad.max, barFactor(player.stats.speed)),
    pos: v2(),
    prev: v2(),
    vel: v2(),
    target: v2(),
    speedScale: 0.5,
    facing: 0,
    prevFacing: 0,
    desiredFacing: 0,
    slot: null,
    mark: null,
    rise: 0,
    armUp: 0,
    holdTime: -1,
    burstUntil: 0,
    burstDir: v2(),
    protectUntil: 0,
    cooldownUntil: 0,
    struggle: 0,
    anticipation: 0,
    speedPenalty: 1,
    contactPressure: 0,
  };
}

const angleTo = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x);

export class AttackDrill {
  phase: AttackPhase = 'setup';
  time = 0;
  readonly goal: Goal;
  readonly attackers: Swimmer[];
  readonly defenders: Swimmer[];
  readonly keeperSwimmer: Swimmer;
  readonly keeper: KeeperBody;
  /** Everybody, keeper included (for drawing). */
  readonly all: Swimmer[];
  readonly ball: BallState;
  readonly drives = new Map<Swimmer, Drive>();
  readonly stats: AttackStats = { attacks: 0, goals: 0, shots: 0, turnovers: 0 };
  /** Shot-clock seconds as the scoreboard shows them. */
  clock = 0;
  preview: PassChoice | null = null;
  selection: Selection | null = null;
  charging: Charging | null = null;
  /** The centre's position against their defender, −1 fronted … +1 won (GDD §6.6). */
  post = 0;
  lastResult: AttackResult | null = null;
  readonly slots: Slot[];

  private readonly t: AttackTuning;
  private readonly input: AttackInput;
  private readonly movers: Swimmer[];
  private phaseTimer = 0;
  private previewTarget: Swimmer | null = null;
  private buffer: Buffered | null = null;
  private postFight: { until: number; won: boolean } | null = null;
  private boyaTurn: { at: number; won: boolean; resolved: boolean } | null = null;

  constructor(readonly setup: AttackSetup) {
    this.t = setup.tuning;
    this.goal = setup.field.goalRight;
    this.input = new AttackInput(this.t.control);
    this.slots = [...setup.lineup.values()];
    this.attackers = [...setup.lineup.keys()].map((p) => makeSwimmer(p, 0, false, this.t));
    this.defenders = [...setup.marking.keys()].map((p) => makeSwimmer(p, 1, false, this.t));
    this.keeperSwimmer = makeSwimmer(setup.keeper, 1, true, this.t);
    this.keeper = new KeeperBody(
      this.keeperSwimmer,
      this.goal,
      {
        reflexes: setup.keeper.keeperStats?.reflexes ?? 3,
        positioning: setup.keeper.keeperStats?.positioning ?? 3,
        energy: 1,
      },
      setup.keeperTuning,
      this.t.portero,
    );
    this.movers = [...this.attackers, ...this.defenders];
    this.all = [...this.movers, this.keeperSwimmer];
    this.ball = {
      pos: { x: 0, y: 0, z: 0 },
      prev: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      holder: null,
      flight: null,
      free: false,
      dead: false,
      inNet: false,
      lastTouch: null,
    };
    this.reset([]);
  }

  /** The attacker playing in the centre spot right now. */
  get boya(): Swimmer | null {
    return this.attackers.find((a) => a.slot === 'boya') ?? null;
  }

  /** For the view: the keepers in the water. */
  get keepers(): KeeperBody[] {
    return [this.keeper];
  }

  /** For the view: the swimmer the player controls (the one with the ball). */
  get controlled(): Swimmer | null {
    return this.holder;
  }

  goalOf(): Goal {
    return this.goal;
  }

  /** Our player with the ball, if any: the one the human controls. */
  get holder(): Swimmer | null {
    const holder = this.ball.holder;
    return holder && holder.team === 0 ? holder : null;
  }

  defenderOf(attacker: Swimmer): Swimmer | null {
    return this.defenders.find((d) => d.mark === attacker) ?? null;
  }

  private rng(): Rng {
    return this.setup.rng;
  }

  // ------------------------------------------------------------------------------------------
  // Attack life cycle
  // ------------------------------------------------------------------------------------------

  private reset(events: AttackEvent[]): void {
    const { formations } = this.setup;
    this.stats.attacks++;
    this.phase = 'setup';
    this.phaseTimer = this.t.posesion.pausaInicio;
    this.clock = this.setup.possession.first;
    this.drives.clear();
    this.charging = null;
    this.preview = null;
    this.previewTarget = null;
    this.selection = null;
    this.buffer = null;
    this.postFight = null;
    this.boyaTurn = null;
    this.lastResult = null;
    this.post = 0;
    const rng = this.rng();

    const lineup = [...this.setup.lineup.values()];
    this.attackers.forEach((a, i) => {
      a.slot = lineup[i] ?? null;
      const point = slotPoint(formations, a.slot ?? 'cierre', this.goal, this.t.zona.distanciaMinima);
      this.place(a, { x: point.x + rng.range(-0.15, 0.15), y: point.y + rng.range(-0.15, 0.15) });
    });
    const marking = [...this.setup.marking.values()];
    this.defenders.forEach((d, i) => {
      d.slot = marking[i] ?? null;
      d.mark = this.attackers.find((a) => a.slot === d.slot) ?? null;
      this.place(d, d.mark ? insidePoint(d.mark.pos, this.goal, this.t.defensa.distancia) : { x: this.goal.x - 3, y: this.goal.y });
    });
    this.keeper.reset();

    const starter =
      (['cierre', 'lateralIzq', 'lateralDer', 'extremoIzq', 'extremoDer', 'boya'] as const)
        .map((slot) => this.attackers.find((a) => a.slot === slot))
        .find((a) => a !== undefined) ?? this.attackers[0];
    for (const s of this.all) {
      s.facing = s.prevFacing = s.desiredFacing = angleTo(s.pos, starter ? starter.pos : this.goal);
      s.holdTime = -1;
    }
    if (starter) {
      starter.facing = starter.prevFacing = starter.desiredFacing = angleTo(starter.pos, this.goal);
      starter.holdTime = 0;
    }
    const ball = this.ball;
    ball.holder = starter ?? null;
    ball.flight = null;
    ball.free = ball.dead = ball.inNet = false;
    ball.vel = { x: 0, y: 0, z: 0 };
    if (starter) this.placeBallInHand(starter);
    ball.prev = { ...ball.pos };
    this.keeper.reroll(rng);
    this.input.reset();
    events.push({ type: 'attackStart', number: this.stats.attacks });
  }

  private place(s: Swimmer, p: Vec2): void {
    s.pos = { ...p };
    s.prev = { ...p };
    s.target = { ...p };
    s.vel = v2();
    s.rise = s.armUp = s.struggle = 0;
    s.burstUntil = s.protectUntil = s.cooldownUntil = 0;
  }

  private end(result: AttackResult, events: AttackEvent[]): void {
    if (this.phase !== 'live') return;
    this.phase = 'ended';
    this.phaseTimer = this.t.posesion.pausaFinal;
    this.lastResult = result;
    if (result === 'goal') this.stats.goals++;
    if (result === 'steal' || result === 'intercept' || result === 'clock' || result === 'loose') this.stats.turnovers++;
    this.charging = null;
    this.preview = null;
    this.selection = null;
    this.buffer = null;
    this.drives.clear();
    this.input.reset();
    events.push({ type: 'attackEnd', result });
  }

  // ------------------------------------------------------------------------------------------
  // Step
  // ------------------------------------------------------------------------------------------

  step(pad: PadState): AttackEvent[] {
    const events: AttackEvent[] = [];
    this.time += DT;
    if (this.phase === 'setup') {
      this.phaseTimer -= DT;
      if (this.phaseTimer <= 0) {
        this.phase = 'live';
        this.input.reset();
        events.push({ type: 'whistle' });
      }
    } else if (this.phase === 'ended') {
      this.phaseTimer -= DT;
      if (this.phaseTimer <= 0) {
        this.reset(events);
        return events;
      }
    }

    const intents = this.input.update(pad, STEP_MS);
    if (this.phase === 'live') this.handle(intents, events);
    this.think(events);
    if (this.charging) this.updateCharging(pad, events);
    moveSwimmers(this.movers, DT, this.t.nado, this.setup.field.length, this.setup.field.width);
    const ballFree = this.ball.holder === this.keeperSwimmer || this.keeper.holding;
    this.keeper.step(ballFree ? null : this.ball.pos, this.time, DT);
    updateFacing(this.keeperSwimmer, DT, this.t.nado);
    this.stepBall(events);
    if (this.phase === 'live') {
      this.checkSteal(events);
      this.tickClock(events);
    }
    return events;
  }

  // ------------------------------------------------------------------------------------------
  // Player intents
  // ------------------------------------------------------------------------------------------

  private worldAim(x: number, y: number): Vec2 {
    return norm({ x, y: y / this.setup.tilt });
  }

  passWorld(holder: Swimmer): PassWorld {
    const drives = new Map<Swimmer, DriveInfo>();
    for (const drive of this.drives.values()) {
      drives.set(drive.driver, {
        destination: drive.destination,
        free: drive.phase === 'free',
        speed: drive.driver.topSpeed * this.t.entrada.velocidad,
      });
    }
    return {
      holder,
      from: { ...this.ball.pos },
      teammates: this.attackers.filter((a) => a !== holder),
      defenders: this.defenders,
      goal: this.goal,
      drives,
      boya: this.boya,
      post: this.post,
    };
  }

  private incomingPass(): boolean {
    const flight = this.ball.flight;
    return flight !== null && flight.kind === 'pass' && flight.receiver.team === 0;
  }

  private handle(intents: ReturnType<AttackInput['update']>, events: AttackEvent[]): void {
    for (const intent of intents) {
      const holder = this.holder;
      switch (intent.type) {
        case 'aim':
          if (holder && !this.charging) {
            this.preview = choosePass(this.passWorld(holder), this.worldAim(intent.x, intent.y), this.previewTarget, this.t.pase);
            this.previewTarget = this.preview.best?.receiver ?? null;
          } else {
            this.preview = null;
          }
          break;
        case 'aimClear':
          this.preview = null;
          this.previewTarget = null;
          break;
        case 'pass':
          if (holder && !this.charging) this.passFrom(holder, this.worldAim(intent.x, intent.y), events);
          else if (this.incomingPass()) this.buffer = { kind: 'pass', aim: this.worldAim(intent.x, intent.y), at: this.time };
          this.preview = null;
          break;
        case 'select':
          this.selection = holder ? this.selectFor(holder, this.worldAim(intent.x, intent.y)) : null;
          break;
        case 'selectClear':
          this.selection = null;
          break;
        case 'order':
          if (holder) this.order(holder, this.worldAim(intent.x, intent.y), events);
          this.selection = null;
          break;
        case 'skill':
          if (holder && !this.charging) this.skill(holder, events);
          break;
        case 'shotStart':
          if (holder) this.startCharge(holder, events);
          else if (this.incomingPass()) this.buffer = { kind: 'shot', at: this.time, released: null };
          break;
        case 'shotRelease':
          if (this.charging) this.releaseShot(events);
          else if (this.buffer?.kind === 'shot' && this.buffer.released === null) this.buffer.released = this.time;
          break;
      }
    }
  }

  private passFrom(holder: Swimmer, aim: Vec2, events: AttackEvent[]): void {
    const choice = choosePass(this.passWorld(holder), aim, this.previewTarget, this.t.pase);
    this.previewTarget = null;
    if (!choice.best) {
      events.push({ type: 'noReceiver', at: { ...holder.pos } });
      return;
    }
    this.launchPass(holder, choice.best, events);
  }

  /** Throws the pass. The interception roll uses exactly the risk shown in the preview. */
  private launchPass(holder: Swimmer, c: PassCandidate, events: AttackEvent[]): void {
    const rng = this.rng();
    const t = this.t.pase;
    const from = { ...this.ball.pos };
    let interceptor: Swimmer | null = null;
    let endAt = 1;
    for (const share of c.shares) {
      if (rng.chance(share.risk)) {
        interceptor = share.defender;
        endAt = share.s;
        break;
      }
    }
    // A pass is never perfect: Pase decides how far off the hand it lands.
    const sigma = lerp(t.error.max, t.error.min, barFactor(holder.player.stats.passing)) * Math.pow(Math.max(1, c.distance) / 6, 0.8);
    const across = norm({ x: -(c.point.y - from.y), y: c.point.x - from.x });
    const error = interceptor ? 0 : rng.gauss() * sigma;
    const to = { x: c.point.x + across.x * error, y: c.point.y + across.y * error, z: c.endZ };
    this.ball.flight = {
      kind: 'pass',
      type: c.type,
      passer: holder,
      receiver: c.receiver,
      from,
      to,
      arc: c.arc,
      duration: Math.max(0.08, dist(from, to) / c.speed),
      t: 0,
      interceptor,
      endAt,
    };
    this.ball.holder = null;
    holder.holdTime = -1;
    events.push({ type: 'pass', passer: holder, receiver: c.receiver, passType: c.type, risk: c.risk, intercepted: interceptor !== null });
  }

  private selectFor(holder: Swimmer, aim: Vec2): Selection | null {
    const swimmer = chooseDriver(this.passWorld(holder), aim, this.t.pase);
    if (!swimmer) return null;
    const destination = swimmer === this.boya ? null : driveDestination(swimmer, this.goal, this.attackers, this.t.entrada);
    return { swimmer, destination };
  }

  /** HABILIDAD + direction: the team-mate drives, or the centre fights for position. */
  private order(holder: Swimmer, aim: Vec2, events: AttackEvent[]): void {
    const target = chooseDriver(this.passWorld(holder), aim, this.t.pase);
    if (!target) {
      events.push({ type: 'noDrive', at: { ...holder.pos } });
      return;
    }
    if (target === this.boya) {
      if (this.postFight) return;
      const boya = target;
      const defender = this.defenderOf(boya);
      const won = this.rng().chance(this.fightChance(boya, defender));
      this.postFight = { until: this.time + this.t.boya.lucha.segundos, won };
      return;
    }
    if (this.drives.has(target) || this.drives.size >= this.t.entrada.maxSimultaneas) {
      events.push({ type: 'noDrive', at: { ...target.pos } });
      return;
    }
    const drive = startDrive(target, this.defenderOf(target), this.goal, this.attackers, this.ball.pos, this.time, this.rng(), this.t.entrada);
    this.drives.set(target, drive);
    events.push({ type: 'driveStart', driver: target, destination: drive.destination });
  }

  /** Mainly for tests and the lab: makes a team-mate drive right now. */
  orderDrive(target: Swimmer, events: AttackEvent[] = []): Drive | null {
    if (this.drives.has(target)) return null;
    const drive = startDrive(target, this.defenderOf(target), this.goal, this.attackers, this.ball.pos, this.time, this.rng(), this.t.entrada);
    this.drives.set(target, drive);
    events.push({ type: 'driveStart', driver: target, destination: drive.destination });
    return drive;
  }

  private centreStrength(boya: Swimmer, defender: Swimmer | null): { attack: number; defence: number } {
    const attack = 0.8 * barFactor(boya.player.stats.skill) + 0.2;
    const defence = defender ? (barFactor(defender.player.stats.defense) + barFactor(defender.player.stats.aggression)) / 2 : 0;
    return { attack, defence };
  }

  /** Chance that the centre wins a fight for position (also shown in the lab). */
  fightChance(boya: Swimmer, defender: Swimmer | null): number {
    const { attack, defence } = this.centreStrength(boya, defender);
    const l = this.t.boya.lucha;
    return sigmoid(l.pendiente * (attack - defence) + l.base);
  }

  turnChance(boya: Swimmer): number {
    const { attack, defence } = this.centreStrength(boya, this.defenderOf(boya));
    const g = this.t.boya.giro;
    return sigmoid(g.pendiente * (attack - defence) + g.peso * this.post + g.base);
  }

  /** HABILIDAD tap: the centre turns on their defender; anybody else breaks away (escapada). */
  private skill(holder: Swimmer, events: AttackEvent[]): void {
    if (holder === this.boya) {
      if (!this.boyaTurn) this.boyaTurn = { at: this.time + this.t.boya.giro.segundos, won: this.rng().chance(this.turnChance(holder)), resolved: false };
      return;
    }
    if (this.time < holder.cooldownUntil) return;
    const e = this.t.escapada;
    const defender = this.defenderOf(holder);
    const away = defender ? dir(defender.pos, holder.pos) : dir(this.goal, holder.pos);
    holder.burstDir = norm(add(lerp2(away, dir(holder.pos, this.goal), 0.4), v2()));
    holder.burstUntil = this.time + e.duracion;
    holder.protectUntil = this.time + e.proteccion;
    holder.cooldownUntil = this.time + e.enfriamiento;
    holder.vel = add(holder.vel, holder.burstDir, e.impulso * 0.6);
    events.push({ type: 'escape', who: holder });
  }

  // ------------------------------------------------------------------------------------------
  // Shooting
  // ------------------------------------------------------------------------------------------

  private startCharge(holder: Swimmer, events: AttackEvent[]): void {
    if (this.charging) return;
    this.charging = { shooter: holder, time: 0, charge: 0, aim: { side: 0, mode: 'direct' } };
    this.preview = null;
    this.selection = null;
    // The centre has to turn first: "giro y tiro".
    if (holder === this.boya && !this.boyaTurn) {
      this.boyaTurn = { at: this.time + this.t.boya.giro.segundos, won: this.rng().chance(this.turnChance(holder)), resolved: false };
    }
    events.push({ type: 'chargeStart', who: holder });
  }

  private updateCharging(pad: PadState, events: AttackEvent[]): void {
    const c = this.charging;
    if (!c) return;
    const t = this.setup.shot;
    c.time += DT;
    c.charge = clamp(c.time / t.segundosCarga, 0, 1);
    c.shooter.rise = clamp(c.time / t.segundosSubida, 0, 1);
    c.aim = aimFromPad({ x: pad.x, y: pad.y }, this.goal);
    c.shooter.desiredFacing = angleTo(c.shooter.pos, this.goal);
    if (c.time >= t.segundosMaximoCargado) this.releaseShot(events);
  }

  /** How much the defence bothers a shot: close and between the shooter and the goal. */
  shotPressure(shooter: Swimmer): number {
    const p = this.t.defensa.presion;
    const towardsGoal = dir(shooter.pos, this.goal);
    let pressure = 0;
    for (const d of this.defenders) {
      const distance = dist(d.pos, shooter.pos);
      if (distance > p.lejos) continue;
      const closeness = clamp(1 - (distance - p.cerca) / (p.lejos - p.cerca), 0, 1);
      const front = dot(dir(shooter.pos, d.pos), towardsGoal);
      const frontness = front > 0.3 ? 1 : front > -0.3 ? 0.55 : 0.25;
      pressure = Math.max(pressure, closeness * frontness);
    }
    return pressure;
  }

  private releaseShot(events: AttackEvent[]): void {
    const c = this.charging;
    if (!c) return;
    this.charging = null;
    const { shooter } = c;
    const shotTuning = this.setup.shot;
    const quick = c.time < shotTuning.segundosTiroRapido;
    const charge = quick ? null : c.charge;
    let pressure = this.shotPressure(shooter);
    if (shooter === this.boya) {
      const b = this.t.boya.presion;
      if (quick) pressure = lerp(b.rosca.perdida, b.rosca.ganada, (this.post + 1) / 2);
      else pressure = this.boyaTurn?.resolved && this.boyaTurn.won ? b.ganada : b.perdida;
    }
    this.boyaTurn = null;
    const rng = this.rng();
    const plan = planShot(
      {
        from: { x: this.ball.pos.x, y: this.ball.pos.y },
        releaseHeight: this.ball.pos.z,
        charge,
        side: c.aim.side,
        mode: c.aim.mode,
        pressure,
      },
      { power: shooter.player.stats.power, accuracy: shooter.player.stats.accuracy, energy: 1 },
      this.goal,
      this.keeper.u,
      rng,
      shotTuning,
    );
    this.stats.shots++;
    this.ball.holder = null;
    shooter.holdTime = -1;
    events.push({ type: 'release', plan, who: shooter });

    const blocker = this.rollBlock(shooter, plan);
    if (blocker) {
      const back = dir(blocker.pos, shooter.pos);
      this.ball.pos = { x: blocker.pos.x + back.x * 0.35, y: blocker.pos.y + back.y * 0.35, z: 0.9 };
      this.ball.vel = { x: back.x * rng.range(1.5, 3) + rng.range(-1.5, 1.5), y: back.y * rng.range(1.5, 3) + rng.range(-1.5, 1.5), z: 2 };
      this.ball.free = true;
      events.push({ type: 'block', by: blocker });
      return;
    }

    const result = resolveShot(
      plan,
      this.goal,
      this.keeper.profile,
      { u: this.keeper.u, set: clamp(c.time / 0.5, 0, 1) },
      'open',
      rng,
      shotTuning,
      this.setup.keeperTuning,
    );
    this.ball.flight = { kind: 'shot', shooter, plan, outcome: result.outcome, save: result.save, t: 0, bounced: false };
    if (result.outcome.type === 'save') {
      this.keeper.hands = clamp(plan.arrival.v, 0.1, this.goal.height + 0.2);
      this.keeper.dive(plan.arrival.u, plan.flightTime, this.time);
    } else if (plan.landing === 'onTarget') {
      // Beaten: goes the right way but arrives short.
      const short = clamp(-(result.save?.margin ?? -0.4), 0.2, 0.9);
      const direction = Math.sign(plan.arrival.u - this.keeper.u) || 1;
      this.keeper.hands = clamp(plan.arrival.v, 0.1, this.goal.height);
      this.keeper.dive(plan.arrival.u - direction * short, plan.flightTime, this.time);
    }
    const side = Math.sign(plan.arrival.u - this.keeper.u);
    if (plan.landing === 'onTarget') events.push({ type: 'dive', side: side === 0 ? 0 : side > 0 ? 1 : -1 });
  }

  /** Defenders with an arm up in the line of the shot can block it (not a lob). */
  private rollBlock(shooter: Swimmer, plan: ShotPlan): Swimmer | null {
    if (plan.mode === 'lob') return null;
    const b = this.t.defensa.bloqueo;
    const aim = { x: this.goal.x, y: this.goal.y + plan.arrival.u };
    for (const d of this.defenders) {
      if (d.armUp < 0.05 || dist(d.pos, shooter.pos) > b.distancia) continue;
      const along = toSegment(d.pos, shooter.pos, aim);
      if (along.distance > b.pasillo || along.t <= 0) continue;
      let p = lerp(b.prob.min, b.prob.max, barFactor(d.player.stats.defense)) * d.armUp * (1 - along.distance / b.pasillo);
      if (plan.mode === 'skip') p *= b.factorBote;
      if (this.rng().chance(p)) return d;
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------
  // AI: structure for both teams
  // ------------------------------------------------------------------------------------------

  private think(events: AttackEvent[]): void {
    const live = this.phase === 'live';
    const holder = this.ball.holder;
    const ballXY = { x: this.ball.pos.x, y: this.ball.pos.y };

    if (live) {
      for (const drive of [...this.drives.values()]) {
        const result = stepDrive(drive, this.goal, this.time, this.t.entrada, this.t.defensa.distancia);
        if (result === 'free') events.push({ type: 'driveFree', driver: drive.driver });
        else if (result) this.finishDrive(drive, result === 'end-free' ? 'free' : result === 'end-drag' ? 'drag' : 'fail', events);
      }
    }

    const loose = live && this.ball.free && !this.ball.dead;
    const chaser = (team: Swimmer[]): Swimmer | null =>
      loose ? team.reduce<Swimmer | null>((best, s) => (!best || dist(s.pos, ballXY) < dist(best.pos, ballXY) ? s : best), null) : null;
    const chaseA = chaser(this.attackers);
    const chaseD = chaser(this.defenders);
    const predicted = { x: ballXY.x + this.ball.vel.x * 0.3, y: ballXY.y + this.ball.vel.y * 0.3 };
    const pass = this.ball.flight?.kind === 'pass' ? this.ball.flight : null;

    for (const a of this.attackers) {
      if (a !== this.charging?.shooter) a.rise = Math.max(0, a.rise - DT * 2.5);
      a.struggle = Math.max(0, a.struggle - DT * 3);
      if (a === holder) {
        a.holdTime += DT;
        this.holderMove(a);
        continue;
      }
      if (!live) {
        a.target = { ...a.pos };
        a.speedScale = 0.3;
      } else if (a === chaseA) {
        a.target = predicted;
        a.speedScale = this.t.suelto.persecucion;
      } else if (pass && pass.receiver === a && !this.drives.has(a)) {
        a.target = { x: pass.to.x, y: pass.to.y };
        a.speedScale = 0.9;
      } else if (!this.drives.has(a)) {
        this.zoneTarget(a, holder);
      }
      if (!this.drives.has(a)) a.desiredFacing = angleTo(a.pos, ballXY);
    }

    const driveDefenders = new Set([...this.drives.values()].map((d) => d.defender));
    for (const d of this.defenders) {
      this.updateArm(d);
      d.struggle = Math.max(0, d.struggle - DT * 3);
      if (d === holder) {
        d.target = { ...d.pos };
        continue;
      }
      if (!live) {
        d.target = { ...d.pos };
        d.speedScale = 0.3;
      } else if (d === chaseD) {
        d.target = predicted;
        d.speedScale = this.t.suelto.persecucion;
      } else if (pass && pass.interceptor === d) {
        const s = pass.endAt;
        d.target = { x: pass.from.x + (pass.to.x - pass.from.x) * s, y: pass.from.y + (pass.to.y - pass.from.y) * s };
        d.speedScale = 1.3;
      } else if (!driveDefenders.has(d)) {
        this.markTarget(d, holder, ballXY);
      }
    }
    const kp = this.keeperSwimmer;
    kp.desiredFacing = angleTo(kp.pos, ballXY);
    if (live) this.updateCentre(events);
  }

  private holderMove(a: Swimmer): void {
    if (this.time < a.burstUntil) {
      a.target = add(a.pos, a.burstDir, 1.5);
      a.speedScale = this.t.escapada.impulso / a.topSpeed;
    } else {
      a.target = { ...a.pos };
      a.speedScale = 0.3;
    }
    const best = this.preview?.best;
    a.desiredFacing = this.charging ? angleTo(a.pos, this.goal) : best ? angleTo(a.pos, best.point) : angleTo(a.pos, this.goal);
  }

  private zoneTarget(a: Swimmer, holder: Swimmer | null): void {
    let target = slotPoint(this.setup.formations, a.slot ?? 'cierre', this.goal, this.t.zona.distanciaMinima);
    // Open the passing lane when the defender sits right in it.
    const defender = this.defenderOf(a);
    if (holder && holder.team === 0 && defender) {
      const lane = toSegment(defender.pos, holder.pos, a.pos);
      if (lane.distance < 0.6 && lane.t > 0.3) {
        const across = norm({ x: -(a.pos.y - holder.pos.y), y: a.pos.x - holder.pos.x });
        const side = dot(across, dir(defender.pos, a.pos)) >= 0 ? 1 : -1;
        target = add(target, across, side * this.t.zona.abrirLinea);
      }
    }
    a.target = target;
    a.speedScale = this.t.nado.zona;
  }

  /** Where a defender stands: inside water on their man; the centre's one in front, beside or behind. */
  private markTarget(d: Swimmer, holder: Swimmer | null, ballXY: Vec2): void {
    const m = d.mark;
    const t = this.t.defensa;
    d.speedScale = 0.85;
    if (!m) {
      d.target = { x: this.goal.x - this.goal.facing * 3, y: this.goal.y };
      return;
    }
    d.desiredFacing = angleTo(d.pos, m.pos);
    if (m === this.boya && m !== holder) {
      const distance = this.t.boya.distanciaDefensor;
      const behind = dir(m.pos, this.goal);
      const front = dir(m.pos, ballXY);
      let side = norm({ x: -front.y, y: front.x });
      if (dot(side, dir(m.pos, d.pos)) < 0) side = { x: -side.x, y: -side.y };
      const blend = norm(this.post >= 0 ? lerp2(side, behind, this.post) : lerp2(side, front, -this.post));
      // Move round the centre (never through him): at most ~50° of the circle at a time.
      const current = Math.atan2(d.pos.y - m.pos.y, d.pos.x - m.pos.x);
      let delta = Math.atan2(blend.y, blend.x) - current;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const angle = current + clamp(delta, -0.9, 0.9);
      d.target = { x: m.pos.x + Math.cos(angle) * distance, y: m.pos.y + Math.sin(angle) * distance };
      return;
    }
    let target = insidePoint(m.pos, this.goal, m === holder ? t.distanciaPoseedor : t.distancia);
    const boya = this.boya;
    const sag = this.setup.defenseStyle === 'zone' ? t.hundimiento.zona : t.hundimiento.presion;
    const perimeter = m.slot === 'lateralIzq' || m.slot === 'lateralDer' || m.slot === 'cierre';
    if (boya && m !== holder && perimeter && sag > 0) target = lerp2(target, add(boya.pos, dir(boya.pos, ballXY), 1.2), sag);
    d.target = target;
  }

  private updateArm(d: Swimmer): void {
    const c = this.charging;
    let up = false;
    if (c) {
      const shooter = c.shooter;
      const inFront = dot(dir(shooter.pos, d.pos), dir(shooter.pos, this.goal)) > 0.2;
      up = d.mark === shooter || (inFront && dist(d.pos, shooter.pos) < this.t.defensa.brazo.distancia);
    }
    const rate = lerp(this.t.defensa.brazo.subida.min, this.t.defensa.brazo.subida.max, barFactor(d.player.stats.defense));
    d.armUp = clamp(d.armUp + (up ? rate : -3) * DT, 0, 1);
    d.rise = d.armUp * 0.4;
  }

  /** The centre: position drifts with the stats, and the fights and turns resolve here. */
  private updateCentre(events: AttackEvent[]): void {
    const boya = this.boya;
    if (!boya) return;
    const defender = this.defenderOf(boya);
    const b = this.t.boya;
    const rng = this.rng();
    const { attack, defence } = this.centreStrength(boya, defender);
    this.post = clamp(this.post + (b.deriva * (attack - defence) - b.retorno * this.post) * DT + rng.gauss() * b.ruido * Math.sqrt(DT), -1, 1);

    if (this.postFight) {
      boya.struggle = 1;
      if (defender) defender.struggle = 1;
      if (this.time >= this.postFight.until) {
        this.post = clamp(this.post + (this.postFight.won ? b.lucha.empuje : -b.lucha.castigo), -1, 1);
        events.push({ type: 'postFight', boya, won: this.postFight.won });
        this.postFight = null;
      }
    }
    const turn = this.boyaTurn;
    if (turn && !turn.resolved) {
      boya.struggle = 1;
      if (defender) defender.struggle = 1;
      if (this.time >= turn.at) {
        turn.resolved = true;
        events.push({ type: 'turn', boya, won: turn.won });
        if (turn.won) this.post = 1;
        else this.post = Math.min(this.post, -0.2);
        // A failed turn without shooting can cost the ball.
        if (!turn.won && !this.charging && this.ball.holder === boya && defender && rng.chance(b.giro.robo)) {
          this.steal(defender, boya, events);
          return;
        }
        if (!this.charging) this.boyaTurn = null;
      }
    }
  }

  private finishDrive(drive: Drive, result: 'free' | 'drag' | 'fail', events: AttackEvent[]): void {
    this.drives.delete(drive.driver);
    events.push({ type: 'driveEnd', driver: drive.driver, result });
    this.reassignSlots();
  }

  /** After a drive or a rebound, the slots are shared out again by who is nearest. */
  private reassignSlots(): void {
    const free = this.attackers.filter((a) => !this.drives.has(a));
    const slots = free.map((a) => a.slot).filter((s): s is Slot => s !== null);
    if (slots.length !== free.length) return;
    const points = new Map(slots.map((s) => [s, slotPoint(this.setup.formations, s, this.goal, this.t.zona.distanciaMinima)]));
    const result = assign(free, slots, (a, slot) => dist(a.pos, points.get(slot) as Vec2) * 0.6 + slotCost(a.player, slot, this.t.zona.mano));
    for (const [a, slot] of result) a.slot = slot;
  }

  // ------------------------------------------------------------------------------------------
  // Ball
  // ------------------------------------------------------------------------------------------

  private placeBallInHand(s: Swimmer): void {
    const hand = s.player.hand === 'left' ? -1 : 1;
    const fx = Math.cos(s.facing);
    const fy = Math.sin(s.facing);
    const heights = this.setup.shot.alturaSuelta;
    const back = 0.12 + 0.5 * s.rise;
    this.ball.pos.x = s.pos.x - fx * back - fy * 0.55 * hand;
    this.ball.pos.y = s.pos.y - fy * back + fx * 0.55 * hand;
    this.ball.pos.z = heights.rapido + (heights.cargado - heights.rapido) * s.rise;
  }

  private stepBall(events: AttackEvent[]): void {
    const ball = this.ball;
    ball.prev = { ...ball.pos };
    if (this.keeper.holding) {
      ball.pos = { x: this.goal.x - this.goal.facing * 0.35, y: this.goal.y + this.keeper.u, z: this.keeper.hands };
      return;
    }
    if (ball.holder) {
      this.placeBallInHand(ball.holder);
      return;
    }
    const flight = ball.flight;
    if (flight?.kind === 'pass') {
      flight.t += DT;
      const s = Math.min(flight.endAt, flight.t / flight.duration);
      ball.pos.x = flight.from.x + (flight.to.x - flight.from.x) * s;
      ball.pos.y = flight.from.y + (flight.to.y - flight.from.y) * s;
      ball.pos.z = flight.from.z + (flight.to.z - flight.from.z) * s + flight.arc * 4 * s * (1 - s);
      if (s >= flight.endAt) this.arrivePass(events);
      return;
    }
    if (flight?.kind === 'shot') {
      flight.t += DT;
      const s = clamp(flight.t / flight.plan.flightTime, 0, 1);
      ballAt(flight.plan, this.goal, s, this.setup.shot, ball.pos);
      const plan = flight.plan;
      if (!flight.bounced && plan.bounce && plan.bounceAt !== undefined && s >= plan.bounceAt) {
        flight.bounced = true;
        events.push({ type: 'bounce', at: plan.bounce, speed: plan.speed });
      }
      if (flight.t >= plan.flightTime) this.arriveShot(events);
      return;
    }
    if (ball.free) this.stepFreeBall(events);
  }

  private arrivePass(events: AttackEvent[]): void {
    const ball = this.ball;
    const flight = ball.flight;
    if (!flight || flight.kind !== 'pass') return;
    ball.flight = null;
    if (flight.interceptor) {
      ball.holder = flight.interceptor;
      flight.interceptor.holdTime = 0;
      events.push({ type: 'intercept', by: flight.interceptor });
      this.end('intercept', events);
      return;
    }
    const receiver = flight.receiver;
    if (dist(receiver.pos, flight.to) <= this.t.pase.alcanceRecepcion) {
      this.catchBall(receiver, flight.type, events);
      return;
    }
    // Off target: it drops into the water and whoever gets there first keeps it.
    const along = dir(flight.from, flight.to);
    ball.free = true;
    ball.vel = { x: along.x * 1.2, y: along.y * 1.2, z: 0 };
    events.push({ type: 'splash', at: { x: ball.pos.x, y: ball.pos.y }, strength: 0.3 });
  }

  private catchBall(receiver: Swimmer, passType: PassFlight['type'], events: AttackEvent[]): void {
    this.ball.holder = receiver;
    this.ball.free = false;
    receiver.holdTime = 0;
    this.keeper.reroll(this.rng());
    events.push({ type: 'catch', by: receiver, passType });
    const drive = this.drives.get(receiver);
    if (drive) this.finishDrive(drive, drive.phase === 'free' ? 'free' : 'fail', events);

    // Input given while the ball was in the air (first-time shot or one-touch pass).
    const buffered = this.buffer;
    this.buffer = null;
    const windowS = this.t.control.bufferMs / 1000;
    if (!buffered || this.phase !== 'live') return;
    if (buffered.kind === 'pass' && this.time - buffered.at <= windowS) {
      this.passFrom(receiver, buffered.aim, events);
    } else if (buffered.kind === 'shot') {
      if (buffered.released === null) this.startCharge(receiver, events);
      else if (this.time - buffered.released <= windowS) {
        this.startCharge(receiver, events);
        this.releaseShot(events);
      }
    }
  }

  private arriveShot(events: AttackEvent[]): void {
    const ball = this.ball;
    const flight = ball.flight;
    if (!flight || flight.kind !== 'shot') return;
    ball.flight = null;
    const { plan, outcome } = flight;
    const goal = this.goal;
    const rng = this.rng();
    const dx = goal.x - plan.from.x;
    const dy = goal.y + plan.arrival.u - plan.from.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const speed = plan.arrivalSpeed;
    ball.pos = { x: goal.x, y: goal.y + plan.arrival.u, z: plan.arrival.v };
    ball.free = true;
    events.push({ type: 'outcome', outcome, plan, save: flight.save });

    switch (outcome.type) {
      case 'goal':
        ball.dead = true;
        ball.vel = goalVelocity(plan, goal, ux, uy, outcome.viaPost);
        if (outcome.viaPost) events.push({ type: 'frame', at: { ...ball.pos } });
        this.end('goal', events);
        break;
      case 'save':
        events.push({ type: 'splash', at: { x: goal.x - goal.facing * 0.3, y: goal.y + this.keeper.u }, strength: 0.9 });
        if (outcome.held) {
          this.keeper.holding = true;
          ball.free = false;
          ball.dead = true;
          ball.vel = { x: 0, y: 0, z: 0 };
          this.end('save', events);
        } else {
          // Pushed away: back into the pool, to the side of the dive. Live: the rebound is up for grabs.
          const away = Math.sign(plan.arrival.u) || (rng.chance(0.5) ? 1 : -1);
          ball.vel = { x: -goal.facing * speed * rng.range(0.18, 0.32), y: away * rng.range(2, 4.5), z: rng.range(2, 4) };
        }
        break;
      case 'post':
        ball.vel = {
          x: -goal.facing * speed * rng.range(0.3, 0.5),
          y: Math.sign(plan.arrival.u || 1) * rng.range(0.5, 3) * (plan.landing === 'bar' ? rng.range(-1, 1) : 1),
          z: plan.landing === 'bar' ? rng.range(2, 4.5) : rng.range(0.5, 2),
        };
        events.push({ type: 'frame', at: { ...ball.pos } });
        break;
      case 'miss':
        ball.dead = true;
        ball.vel = { x: ux * speed * 0.8, y: uy * speed * 0.8, z: outcome.where === 'over' ? 1.5 : 0 };
        this.end('miss', events);
        break;
    }
  }

  private stepFreeBall(events: AttackEvent[]): void {
    const ball = this.ball;
    const b = ball.pos;
    const v = ball.vel;
    const goal = this.goal;
    b.x += v.x * DT;
    b.y += v.y * DT;
    b.z += v.z * DT;
    if (b.z > 0) v.z -= 9.8 * DT;
    const depth = (b.x - goal.x) * goal.facing;
    // A goal stays in the net; anything else that crosses the line goes on to the wall.
    if (this.lastResult === 'goal' && keepInNet(b, v, goal) && !ball.inNet) {
      ball.inNet = true;
      events.push({ type: 'net', at: { ...b } });
    }
    if (depth > POOL_WALL) {
      b.x = goal.x + goal.facing * POOL_WALL;
      v.x = 0;
      v.y *= 0.5;
    }
    b.y = clamp(b.y, 0.2, this.setup.field.width - 0.2);
    if (b.z <= 0 && v.z <= 0) {
      const impact = Math.abs(v.z) + Math.hypot(v.x, v.y) * 0.3;
      if (impact > 1.2 && depth < 1) events.push({ type: 'splash', at: { x: b.x, y: b.y }, strength: clamp(impact / 8, 0.2, 1) });
      b.z = 0;
      v.z = 0;
      v.x *= 0.5;
      v.y *= 0.5;
    }
    if (b.z === 0) {
      const k = Math.exp(-this.t.suelto.frenado * DT);
      v.x *= k;
      v.y *= k;
    }
    if (ball.dead || this.phase !== 'live') return;

    // Up for grabs: the keeper first if it is at hand, then the nearest player within reach.
    if (b.z < 1.2 && dist(b, this.keeper.position) < this.t.suelto.recogerPortero) {
      this.keeper.holding = true;
      ball.free = false;
      ball.dead = true;
      events.push({ type: 'looseWon', by: this.keeperSwimmer });
      this.end('loose', events);
      return;
    }
    if (b.z > 0.6) return;
    let winner: Swimmer | null = null;
    let best = this.t.suelto.recoger;
    for (const s of this.movers) {
      const d = dist(s.pos, b);
      if (d < best) {
        best = d;
        winner = s;
      }
    }
    if (!winner) return;
    ball.free = false;
    ball.holder = winner;
    winner.holdTime = 0;
    events.push({ type: 'looseWon', by: winner });
    if (winner.team === 0) {
      // Second possession for the same team (GDD §12).
      this.clock = this.setup.possession.second;
      this.keeper.reroll(this.rng());
      this.reassignSlots();
    } else {
      this.end('loose', events);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Defence pressure and clock
  // ------------------------------------------------------------------------------------------

  private steal(defender: Swimmer, from: Swimmer, events: AttackEvent[]): void {
    this.charging = null;
    this.ball.holder = defender;
    from.holdTime = -1;
    defender.holdTime = 0;
    events.push({ type: 'steal', by: defender, from });
    this.end('steal', events);
  }

  /** The holder's defender can take the ball off a player who holds it too long, too close. */
  private checkSteal(events: AttackEvent[]): void {
    const holder = this.holder;
    if (!holder || this.charging || this.time < holder.protectUntil) return;
    const r = this.t.defensa.robo;
    if (holder.holdTime < r.tiempoMinimo) return;
    const defender = this.defenderOf(holder);
    if (!defender || dist(defender.pos, holder.pos) > r.distancia) return;
    let rate = lerp(
      r.porSegundo.min,
      r.porSegundo.max,
      sigmoid(r.pendiente * (barFactor(defender.player.stats.defense) - barFactor(holder.player.stats.skill))),
    );
    if (holder === this.boya) rate *= 1 + Math.max(0, -this.post);
    if (this.rng().chance(rate * DT)) this.steal(defender, holder, events);
  }

  private tickClock(events: AttackEvent[]): void {
    // The shot clock waits while a shot is in the air.
    if (this.ball.flight?.kind === 'shot') return;
    this.clock -= DT * this.setup.possession.clockSpeed;
    if (this.clock <= 0) {
      this.clock = 0;
      this.end('clock', events);
    }
  }
}

type PassFlight = Extract<BallState['flight'], { kind: 'pass' }>;
