/**
 * Goal replay (Julián's request after F4): the seconds before a goal again, closer and in slow
 * motion. Every step the match session records what the view draws (swimmers, ball, keepers)
 * into buffers reserved once; after a goal it plays them back through the same view and then
 * puts the live state back exactly as it was, so the simulation never notices.
 */
import type { KeeperBody } from '../sim/attack/keeper';
import type { AttackEvent, BallState, Swimmer } from '../sim/attack/types';

/** Values kept per swimmer and frame: x, y, facing, vx, vy, rise, armUp, struggle. */
const PER_SWIMMER = 8;
/** Values kept per keeper and frame: u, stretch, hands, holding. */
const PER_KEEPER = 4;
/** Visual events replayed with the pictures (splashes, the net, the throw). */
const VISUAL = new Set(['pass', 'release', 'bounce', 'dive', 'block', 'frame', 'net', 'splash', 'outcome']);
const MAX_EVENTS = 96;

const lerpAngle = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class GoalReplay {
  /** Frames recorded so far (the newest is `frame`). */
  private count = 0;
  private readonly size: number;
  private readonly swim: Float32Array;
  private readonly ballPos: Float32Array;
  private readonly holder: Int16Array;
  private readonly flight: BallState['flight'][];
  private readonly keep: Float32Array;
  private readonly eventFrames = new Int32Array(MAX_EVENTS);
  private readonly eventList: (AttackEvent | null)[] = new Array<AttackEvent | null>(MAX_EVENTS).fill(null);
  private eventCount = 0;

  /** The live state, saved when a replay starts and put back when it ends. */
  // Full precision: the live state must come back bit for bit.
  private readonly liveSwim: Float64Array;
  private readonly livePrev: Float64Array;
  private readonly liveKeep: Float64Array;
  private readonly liveBall = new Float64Array(6);
  private liveHolder: Swimmer | null = null;
  private liveFlight: BallState['flight'] = null;
  private readonly liveFacing: Float64Array;

  private cursor = 0;
  private end = 0;
  private speed = 0.4;
  private nextEvent = 0;
  playing = false;

  constructor(
    private readonly swimmers: readonly Swimmer[],
    private readonly keepers: readonly KeeperBody[],
    private readonly ball: BallState,
    seconds: number,
  ) {
    this.size = Math.ceil(seconds * 60);
    this.swim = new Float32Array(this.size * swimmers.length * PER_SWIMMER);
    this.ballPos = new Float32Array(this.size * 3);
    this.holder = new Int16Array(this.size);
    this.flight = new Array<BallState['flight']>(this.size).fill(null);
    this.keep = new Float32Array(this.size * keepers.length * PER_KEEPER);
    this.liveSwim = new Float64Array(swimmers.length * PER_SWIMMER);
    this.livePrev = new Float64Array(swimmers.length * 2);
    this.liveFacing = new Float64Array(swimmers.length);
    this.liveKeep = new Float64Array(keepers.length * 2 + keepers.length * PER_KEEPER);
  }

  /** The newest recorded frame. */
  get frame(): number {
    return this.count - 1;
  }

  /** The oldest frame still kept. */
  get oldest(): number {
    return Math.max(0, this.count - this.size);
  }

  /** Records the state after one simulation step, and the visual events of that step. */
  record(events: readonly { type: string }[]): void {
    const f = this.count % this.size;
    const n = this.swimmers.length;
    let o = f * n * PER_SWIMMER;
    for (const s of this.swimmers) {
      this.swim[o] = s.pos.x;
      this.swim[o + 1] = s.pos.y;
      this.swim[o + 2] = s.facing;
      this.swim[o + 3] = s.vel.x;
      this.swim[o + 4] = s.vel.y;
      this.swim[o + 5] = s.rise;
      this.swim[o + 6] = s.armUp;
      this.swim[o + 7] = s.struggle;
      o += PER_SWIMMER;
    }
    const b = this.ball;
    this.ballPos[f * 3] = b.pos.x;
    this.ballPos[f * 3 + 1] = b.pos.y;
    this.ballPos[f * 3 + 2] = b.pos.z;
    this.holder[f] = b.holder ? this.swimmers.indexOf(b.holder) : -1;
    this.flight[f] = b.flight;
    let k = f * this.keepers.length * PER_KEEPER;
    for (const body of this.keepers) {
      this.keep[k] = body.u;
      this.keep[k + 1] = body.stretch;
      this.keep[k + 2] = body.hands;
      this.keep[k + 3] = body.holding ? 1 : 0;
      k += PER_KEEPER;
    }
    for (const event of events) {
      if (!VISUAL.has(event.type)) continue;
      const slot = this.eventCount % MAX_EVENTS;
      this.eventFrames[slot] = this.count;
      this.eventList[slot] = event as AttackEvent;
      this.eventCount++;
    }
    this.count++;
  }

  /** Starts playing frames `from`…`to` at `speed` (0.4 = slow motion). Saves the live state first. */
  start(from: number, to: number, speed: number): boolean {
    const first = Math.max(this.oldest, Math.floor(from));
    const last = Math.min(this.frame, Math.floor(to));
    if (last - first < 10) return false;
    this.saveLive();
    this.cursor = first;
    this.end = last;
    this.speed = speed;
    // The first event at or after the start.
    this.nextEvent = Math.max(0, this.eventCount - MAX_EVENTS);
    while (this.nextEvent < this.eventCount && (this.eventFrames[this.nextEvent % MAX_EVENTS] ?? 0) < first) this.nextEvent++;
    this.playing = true;
    this.apply(this.cursor, this.cursor);
    return true;
  }

  /**
   * One step of playback: moves on by `speed` frames and hands over the visual events passed.
   * Returns false once the replay is over (the live state is already back).
   */
  step(onEvent: (event: AttackEvent) => void): boolean {
    if (!this.playing) return false;
    const before = this.cursor;
    this.cursor = Math.min(this.end, this.cursor + this.speed);
    while (this.nextEvent < this.eventCount && (this.eventFrames[this.nextEvent % MAX_EVENTS] ?? Infinity) <= this.cursor) {
      const event = this.eventList[this.nextEvent % MAX_EVENTS];
      if (event) onEvent(event);
      this.nextEvent++;
    }
    this.apply(before, this.cursor);
    if (this.cursor >= this.end) {
      this.stop();
      return false;
    }
    return true;
  }

  /** Ends the replay now (skipped, or finished) and puts the live state back. */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.restoreLive();
  }

  /** Where the ball is in the replay (the camera follows it). */
  get ballAt(): { x: number; y: number } {
    return { x: this.ball.pos.x, y: this.ball.pos.y };
  }

  private index(frame: number): number {
    return Math.floor(frame) % this.size;
  }

  /** Writes the interpolated state at `to` (and `from` as the previous position, for smooth drawing). */
  private apply(from: number, to: number): void {
    const n = this.swimmers.length;
    const a0 = this.index(from);
    const a1 = this.index(Math.min(this.end, Math.floor(from) + 1));
    const b0 = this.index(to);
    const b1 = this.index(Math.min(this.end, Math.floor(to) + 1));
    const ta = from - Math.floor(from);
    const tb = to - Math.floor(to);
    const at = (base: number, i: number, field: number, t: number, next: number): number => {
      const x = this.swim[(base * n + i) * PER_SWIMMER + field] ?? 0;
      const y = this.swim[(next * n + i) * PER_SWIMMER + field] ?? x;
      return x + (y - x) * t;
    };
    this.swimmers.forEach((s, i) => {
      s.prev.x = at(a0, i, 0, ta, a1);
      s.prev.y = at(a0, i, 1, ta, a1);
      s.pos.x = at(b0, i, 0, tb, b1);
      s.pos.y = at(b0, i, 1, tb, b1);
      const fa = this.swim[(a0 * n + i) * PER_SWIMMER + 2] ?? 0;
      const fb0 = this.swim[(b0 * n + i) * PER_SWIMMER + 2] ?? 0;
      const fb1 = this.swim[(b1 * n + i) * PER_SWIMMER + 2] ?? fb0;
      s.prevFacing = fa;
      s.facing = lerpAngle(fb0, fb1, tb);
      s.vel.x = at(b0, i, 3, tb, b1);
      s.vel.y = at(b0, i, 4, tb, b1);
      s.rise = at(b0, i, 5, tb, b1);
      s.armUp = at(b0, i, 6, tb, b1);
      s.struggle = at(b0, i, 7, tb, b1);
    });
    const ball = this.ball;
    const bx = (f: number, c: number): number => this.ballPos[f * 3 + c] ?? 0;
    ball.prev.x = bx(a0, 0) + (bx(a1, 0) - bx(a0, 0)) * ta;
    ball.prev.y = bx(a0, 1) + (bx(a1, 1) - bx(a0, 1)) * ta;
    ball.prev.z = bx(a0, 2) + (bx(a1, 2) - bx(a0, 2)) * ta;
    ball.pos.x = bx(b0, 0) + (bx(b1, 0) - bx(b0, 0)) * tb;
    ball.pos.y = bx(b0, 1) + (bx(b1, 1) - bx(b0, 1)) * tb;
    ball.pos.z = bx(b0, 2) + (bx(b1, 2) - bx(b0, 2)) * tb;
    const h = this.holder[b0] ?? -1;
    ball.holder = h >= 0 ? (this.swimmers[h] ?? null) : null;
    ball.flight = this.flight[b0] ?? null;
    const m = this.keepers.length;
    this.keepers.forEach((body, i) => {
      const ka = (a0 * m + i) * PER_KEEPER;
      const kb = (b0 * m + i) * PER_KEEPER;
      const kb1 = (b1 * m + i) * PER_KEEPER;
      body.prevU = this.keep[ka] ?? 0;
      const u0 = this.keep[kb] ?? 0;
      body.u = u0 + ((this.keep[kb1] ?? u0) - u0) * tb;
      body.stretch = this.keep[kb + 1] ?? 0;
      body.hands = this.keep[kb + 2] ?? 0.35;
      body.holding = (this.keep[kb + 3] ?? 0) > 0.5;
      body.place();
      body.swimmer.prev.x = body.swimmer.pos.x;
      body.swimmer.prev.y = body.swimmer.pos.y;
    });
  }

  private saveLive(): void {
    this.swimmers.forEach((s, i) => {
      const o = i * PER_SWIMMER;
      this.liveSwim[o] = s.pos.x;
      this.liveSwim[o + 1] = s.pos.y;
      this.liveSwim[o + 2] = s.facing;
      this.liveSwim[o + 3] = s.vel.x;
      this.liveSwim[o + 4] = s.vel.y;
      this.liveSwim[o + 5] = s.rise;
      this.liveSwim[o + 6] = s.armUp;
      this.liveSwim[o + 7] = s.struggle;
      this.livePrev[i * 2] = s.prev.x;
      this.livePrev[i * 2 + 1] = s.prev.y;
      this.liveFacing[i] = s.prevFacing;
    });
    const b = this.ball;
    this.liveBall.set([b.pos.x, b.pos.y, b.pos.z, b.prev.x, b.prev.y, b.prev.z]);
    this.liveHolder = b.holder;
    this.liveFlight = b.flight;
    const m = this.keepers.length;
    this.keepers.forEach((body, i) => {
      this.liveKeep[i * 2] = body.u;
      this.liveKeep[i * 2 + 1] = body.prevU;
      const o = m * 2 + i * PER_KEEPER;
      this.liveKeep[o] = body.stretch;
      this.liveKeep[o + 1] = body.hands;
      this.liveKeep[o + 2] = body.holding ? 1 : 0;
    });
  }

  private restoreLive(): void {
    this.swimmers.forEach((s, i) => {
      const o = i * PER_SWIMMER;
      s.pos.x = this.liveSwim[o] ?? s.pos.x;
      s.pos.y = this.liveSwim[o + 1] ?? s.pos.y;
      s.facing = this.liveSwim[o + 2] ?? s.facing;
      s.vel.x = this.liveSwim[o + 3] ?? 0;
      s.vel.y = this.liveSwim[o + 4] ?? 0;
      s.rise = this.liveSwim[o + 5] ?? 0;
      s.armUp = this.liveSwim[o + 6] ?? 0;
      s.struggle = this.liveSwim[o + 7] ?? 0;
      s.prev.x = this.livePrev[i * 2] ?? s.pos.x;
      s.prev.y = this.livePrev[i * 2 + 1] ?? s.pos.y;
      s.prevFacing = this.liveFacing[i] ?? s.facing;
    });
    const b = this.ball;
    const l = this.liveBall;
    b.pos.x = l[0] ?? 0;
    b.pos.y = l[1] ?? 0;
    b.pos.z = l[2] ?? 0;
    b.prev.x = l[3] ?? 0;
    b.prev.y = l[4] ?? 0;
    b.prev.z = l[5] ?? 0;
    b.holder = this.liveHolder;
    b.flight = this.liveFlight;
    const m = this.keepers.length;
    this.keepers.forEach((body, i) => {
      body.u = this.liveKeep[i * 2] ?? 0;
      body.prevU = this.liveKeep[i * 2 + 1] ?? 0;
      const o = m * 2 + i * PER_KEEPER;
      body.stretch = this.liveKeep[o] ?? 0;
      body.hands = this.liveKeep[o + 1] ?? 0.35;
      body.holding = (this.liveKeep[o + 2] ?? 0) > 0.5;
      // The keeper's swimmer goes back where it was (it is part of the swimmers restored above).
    });
  }
}
