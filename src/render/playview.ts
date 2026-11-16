/**
 * Draws a game in the water: pool, swimmers, ball and shadow, and the HUD that lives in the
 * water (GDD §16): ring under the player you control, pass preview with the receiver's number
 * in the risk colour, drive arrows, "¡LIBRE!", the shot bar and aim marker. Used by the attack
 * training and by the full match. It reads the simulation and never changes it; where the
 * camera looks is decided by whoever owns the view.
 */
import { Container, Graphics, Sprite, Text, type Renderer } from 'pixi.js';
import { clamp, lerp } from '../core/math';
import type { Rng } from '../core/rng';
import type { Charging, Selection } from '../sim/attack/drill';
import type { Drive } from '../sim/attack/drive';
import type { KeeperBody } from '../sim/attack/keeper';
import { riskColor, type PassChoice } from '../sim/attack/passing';
import type { AttackEvent, AttackTuning, BallState, Swimmer, TeamSide } from '../sim/attack/types';
import type { Field, Goal } from '../sim/field';
import { optimalZone, type ShotTuning } from '../sim/shooting/model';
import { actorTextures, BallView, Splashes, SwimmerView } from './actors';
import { Camera, TILT } from './camera';
import { NUMBER_FONT, rippleTexture } from './caps';
import { BEHIND_GOAL, PoolView } from './pool';
import type { QualityProfile } from './quality';
import type { TimeEffects } from './shotview';
import { Water } from './water';

const RISK_COLORS = { green: 0x62e08f, amber: 0xffb02e, red: 0xe23b46 } as const;
const SELECT_COLOR = 0x7fd3ff;
/** Players are drawn a little smaller than in the penalty close-up so 13 fit and stay readable. */
const ACTOR_SIZE = 0.85;

interface Ripple {
  sprite: Sprite;
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
}

interface Label {
  text: Text;
  /** Follows a swimmer, or sits at a fixed pool point. */
  swimmer: Swimmer | null;
  x: number;
  y: number;
  until: number;
  /** Removed when the swimmer's drive ends instead of on a timer. */
  sticky: boolean;
}

const lerpAngle = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** What the view needs to read from a simulation. */
export interface ViewSource {
  readonly all: readonly Swimmer[];
  readonly ball: BallState;
  readonly keepers: readonly KeeperBody[];
  readonly drives: ReadonlyMap<Swimmer, Drive>;
  readonly preview: PassChoice | null;
  readonly selection: Selection | null;
  readonly charging: Charging | null;
  /** The swimmer the player controls: ring in the water. */
  readonly controlled: Swimmer | null;
  /** The goal a team attacks. */
  goalOf(team: TeamSide): Goal;
}

/** Sets where the camera should look this frame. */
export type CameraDirector = (camera: Camera, snap: boolean) => void;

export class PlayView {
  readonly view = new Container();
  readonly camera: Camera;
  private readonly water = new Water();
  private readonly pool: PoolView;
  private readonly rippleLayer = new Container();
  private readonly underLayer = new Container();
  private readonly shadowLayer = new Container();
  private readonly actorLayer = new Container();
  private readonly overlay = new Container();
  private readonly swimmers = new Map<Swimmer, SwimmerView>();
  private readonly ball: BallView;
  private readonly splashes: Splashes;
  private readonly holderRing: Sprite;
  private readonly selectRing: Sprite;
  private readonly lines = new Graphics();
  private readonly bar = new Graphics();
  private readonly aim: Sprite;
  private readonly bounceMark: Sprite;
  private readonly badge = new Container();
  private readonly badgeDisc = new Graphics();
  private readonly badgeText: Text;
  private readonly labels: Label[] = [];
  private readonly ripples: Ripple[] = [];
  private readonly ripplePool: Sprite[] = [];
  /** View-only animation: the throwing arm follows through after a release. */
  private readonly throws = new Map<Swimmer, number>();
  private time = 0;
  private spin = 0;
  private particleAmount = 1;
  private badgeNumber = -1;
  private badgeColor = -1;

  constructor(
    private readonly renderer: Renderer,
    private readonly field: Field,
    private readonly drill: ViewSource,
    private readonly shotTuning: ShotTuning,
    private readonly passTuning: AttackTuning['pase'],
    private readonly rng: Rng,
    private readonly effects: TimeEffects,
    private readonly director: CameraDirector,
    capColors: Record<TeamSide, 'white' | 'blue'> = { 0: 'white', 1: 'blue' },
  ) {
    this.camera = new Camera(rng, field.length / 2);
    this.pool = new PoolView(field);
    this.ball = new BallView(renderer);
    this.splashes = new Splashes(renderer);
    const textures = actorTextures(renderer);
    this.holderRing = new Sprite(rippleTexture(renderer));
    this.holderRing.anchor.set(0.5);
    this.holderRing.tint = 0xffd23f;
    this.selectRing = new Sprite(rippleTexture(renderer));
    this.selectRing.anchor.set(0.5);
    this.selectRing.tint = SELECT_COLOR;
    this.aim = new Sprite(textures.aim);
    this.aim.anchor.set(0.5);
    this.bounceMark = new Sprite(rippleTexture(renderer));
    this.bounceMark.anchor.set(0.5);
    this.bounceMark.tint = 0xffd23f;
    this.badgeText = new Text({ text: '', style: { fontFamily: NUMBER_FONT, fontSize: 30, fill: 0xffffff } });
    this.badgeText.anchor.set(0.5, 0.54);
    this.badge.addChild(this.badgeDisc, this.badgeText);
    this.actorLayer.sortableChildren = true;

    for (const s of drill.all) {
      const view = new SwimmerView(renderer);
      view.setCap(s.keeper ? 'red' : capColors[s.team], s.player.number);
      this.swimmers.set(s, view);
      this.actorLayer.addChild(view.view);
    }
    this.actorLayer.addChild(...this.ball.trail, this.ball.ball);
    this.shadowLayer.addChild(this.ball.shadow);
    this.underLayer.addChild(this.holderRing, this.selectRing);
    this.overlay.addChild(this.lines, this.bounceMark, this.aim, this.badge, this.bar);
    this.view.addChild(
      this.water.view,
      this.pool.floor,
      this.rippleLayer,
      this.underLayer,
      this.shadowLayer,
      this.actorLayer,
      this.pool.front,
      this.splashes.view,
      this.overlay,
    );
  }

  layout(width: number, height: number): void {
    this.camera.setViewport(width, height);
    this.water.resize(width, height);
    this.frame(true);
  }

  private frame(snap: boolean): void {
    this.director(this.camera, snap);
  }

  private project(x: number, y: number, z: number, out: { x: number; y: number }): void {
    out.x = this.camera.projectX(x, z);
    out.y = this.camera.projectY(y, z);
  }

  private ripple(x: number, y: number, size: number): void {
    let sprite = this.ripplePool.pop();
    if (!sprite) {
      sprite = new Sprite(rippleTexture(this.renderer));
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      this.rippleLayer.addChild(sprite);
    }
    sprite.visible = true;
    this.ripples.push({ sprite, x, y, age: 0, life: 0.9 + size * 0.5, size });
  }

  private splash(x: number, y: number, strength: number): void {
    this.splashes.burst(x, y, strength, this.particleAmount, () => this.rng.next());
    this.ripple(x, y, strength);
  }

  /** A short arcade caption in the water. */
  private label(text: string, color: number, swimmer: Swimmer | null, at: { x: number; y: number }, seconds: number, sticky = false): void {
    let label = this.labels.find((l) => l.swimmer === swimmer && swimmer !== null);
    if (!label) {
      const t = new Text({
        text,
        style: { fontFamily: NUMBER_FONT, fontSize: 30, fill: color, stroke: { color: 0x04112a, width: 6, join: 'round' } },
      });
      t.anchor.set(0.5, 1);
      this.overlay.addChild(t);
      label = { text: t, swimmer, x: at.x, y: at.y, until: 0, sticky };
      this.labels.push(label);
    }
    label.text.text = text;
    label.text.style.fill = color;
    label.x = at.x;
    label.y = at.y;
    label.until = this.time + seconds;
    label.sticky = sticky;
    label.text.scale.set(1.6);
  }

  /** A caption in the water at a pool point (the referee's reasons, ¡PASA!, the rotation…). */
  caption(text: string, color: number, at: { x: number; y: number }, seconds: number): void {
    this.label(text, color, null, { x: at.x, y: at.y }, seconds);
  }

  /** A caption that follows a swimmer until it is removed (the seconds of an exclusion). */
  tag(swimmer: Swimmer, text: string | null, color = 0xffd23f): void {
    if (text === null) {
      this.dropLabel(swimmer);
      return;
    }
    this.label(text, color, swimmer, swimmer.pos, 0, true);
  }

  private dropLabel(swimmer: Swimmer): void {
    const index = this.labels.findIndex((l) => l.swimmer === swimmer);
    if (index < 0) return;
    this.labels[index]?.text.destroy();
    this.labels.splice(index, 1);
  }

  /** Snaps the camera to its framing (after a cut: restart, new period…). */
  snapCamera(): void {
    this.frame(true);
  }

  private goalNear(x: number): Goal {
    return x > this.field.length / 2 ? this.field.goalRight : this.field.goalLeft;
  }

  onEvent(event: AttackEvent | { type: string }): void {
    if (!isAttackEvent(event)) return;
    switch (event.type) {
      case 'attackStart':
        this.ball.clearTrail();
        for (const l of this.labels) l.text.destroy();
        this.labels.length = 0;
        this.frame(true);
        break;
      case 'pass':
        this.throws.set(event.passer, 0);
        break;
      case 'catch':
        if (event.passType === 'wet' || event.passType === 'lead') this.ripple(event.by.pos.x, event.by.pos.y, 0.4);
        break;
      case 'noReceiver':
        this.label('✖', 0xe23b46, null, event.at, 0.7);
        break;
      case 'noDrive':
        this.label('✖', SELECT_COLOR, null, event.at, 0.7);
        break;
      case 'driveStart':
        this.ripple(event.driver.pos.x, event.driver.pos.y, 0.5);
        break;
      case 'driveFree':
        this.label('¡LIBRE!', 0xffd23f, event.driver, event.driver.pos, 3, true);
        break;
      case 'driveEnd':
        this.dropLabel(event.driver);
        break;
      case 'postFight':
        this.label(event.won ? '¡POSICIÓN!' : 'PIERDE LA POSICIÓN', event.won ? 0xffd23f : 0xff8b8b, null, event.boya.pos, 1);
        break;
      case 'turn':
        this.label(event.won ? '¡GIRO!' : 'NO SE GIRA', event.won ? 0xffd23f : 0xff8b8b, null, event.boya.pos, 0.9);
        break;
      case 'escape':
        this.label('¡ESCAPADA!', 0x7fd3ff, null, event.who.pos, 0.7);
        this.splash(event.who.pos.x, event.who.pos.y, 0.4);
        break;
      case 'steal':
        this.label('¡ROBO!', 0xff8b8b, null, event.by.pos, 1.2);
        this.splash(event.from.pos.x, event.from.pos.y, 0.5);
        break;
      case 'intercept':
        this.label('¡CORTADO!', 0xff8b8b, null, event.by.pos, 1.2);
        break;
      case 'block':
        this.label('¡TAPÓN!', 0xff8b8b, null, event.by.pos, 1);
        this.splash(event.by.pos.x, event.by.pos.y, 0.6);
        this.camera.shake(5);
        break;
      case 'release':
        this.throws.set(event.who, 0);
        if (event.plan.speed > 18) {
          this.effects.hitStop(event.plan.speed > 22 ? 5 : 3);
          this.camera.zoomPunch(0.03);
        }
        this.splash(event.who.pos.x, event.who.pos.y, 0.35);
        break;
      case 'bounce':
        this.splash(event.at.x, event.at.y, clamp(event.speed / 26, 0.4, 1));
        break;
      case 'splash':
        this.splash(event.at.x, event.at.y, event.strength);
        break;
      case 'frame':
        this.camera.shake(11);
        break;
      case 'net': {
        const goal = this.goalNear(event.at.x);
        this.pool.hitNet(goal, event.at.y - goal.y, event.at.z, 0.8);
        break;
      }
      case 'outcome':
        if (event.outcome.type === 'goal') {
          this.effects.slowMotion(0.3, 0.45);
          this.camera.zoomPunch(0.05);
        } else if (event.outcome.type === 'save') {
          this.camera.shake(event.outcome.held ? 3 : 7);
          const goal = this.goalNear(this.drill.ball.pos.x);
          const keeper = this.drill.keepers.find((k) => k.goal === goal) ?? this.drill.keepers[0];
          if (keeper) this.splashes.burst(keeper.position.x, keeper.position.y, 0.8, this.particleAmount, () => this.rng.next());
        }
        break;
      default:
        break;
    }
  }

  render(alpha: number, dt: number, profile: QualityProfile): void {
    const { camera, drill } = this;
    this.time += dt;
    this.particleAmount = profile.particles;
    this.frame(false);
    camera.update(dt);
    this.water.setView(-camera.offsetX / camera.scale, -camera.offsetY / (camera.scale * TILT), TILT);
    this.water.update(this.time, profile.caustics, camera.scale);
    this.pool.update(dt);
    this.pool.sync(camera);
    const scale = camera.actorScale * ACTOR_SIZE;

    // --- Ball first: the hand that holds it follows it -------------------------------------
    const ball = drill.ball;
    const bx = lerp(ball.prev.x, ball.pos.x, alpha);
    const by = lerp(ball.prev.y, ball.pos.y, alpha);
    const bz = lerp(ball.prev.z, ball.pos.z, alpha);
    const ballX = camera.projectX(bx, bz);
    const ballY = camera.projectY(by, bz);
    const shot = ball.flight?.kind === 'shot' ? ball.flight : null;
    const speed = shot ? shot.plan.speed : ball.flight ? 8 : 0;
    this.spin += speed * 0.02;
    this.ball.place(ballX, ballY, camera.projectX(bx), camera.projectY(by), bz, scale, speed, this.spin);
    this.ball.shadow.visible = ball.holder === null || bz > 0.4;

    // --- Swimmers ----------------------------------------------------------------------------
    for (const [s, view] of this.swimmers) this.poseSwimmer(s, view, alpha, scale, ballX, ballY);
    for (const [s, k] of this.throws) {
      const next = k + dt / 0.22;
      if (next >= 1) this.throws.delete(s);
      else this.throws.set(s, next);
    }

    // --- In-water HUD ------------------------------------------------------------------------
    this.drawRings(alpha, scale);
    this.drawLines(alpha, scale, ballX, ballY);
    this.drawCharge(alpha, scale);
    this.drawLabels(alpha);

    this.splashes.update(dt, (x, y, z, out) => this.project(x, y, z, out), scale);
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i] as Ripple;
      r.age += dt;
      if (r.age >= r.life) {
        r.sprite.visible = false;
        this.ripplePool.push(r.sprite);
        this.ripples.splice(i, 1);
        continue;
      }
      const k = r.age / r.life;
      const size = (0.3 + k * (0.9 + r.size)) * (camera.scale / 60);
      r.sprite.position.set(camera.projectX(r.x), camera.projectY(r.y));
      r.sprite.scale.set(size, size * TILT);
      r.sprite.alpha = (1 - k) * 0.45;
    }
  }

  private poseSwimmer(s: Swimmer, view: SwimmerView, alpha: number, scale: number, ballX: number, ballY: number): void {
    const { camera, drill } = this;
    const x = lerp(s.prev.x, s.pos.x, alpha);
    const y = lerp(s.prev.y, s.pos.y, alpha);
    const facing = lerpAngle(s.prevFacing, s.facing, alpha);
    const t = this.time + (s.player.number % 7) * 0.37;
    const speed = Math.hypot(s.vel.x, s.vel.y);
    const sx = camera.projectX(x);
    const sy = camera.projectY(y);
    view.view.zIndex = sy;
    // Substitutes on the bench and players gone for good are not in the water; the excluded fade.
    view.view.visible = s.away !== true;
    view.view.alpha = s.excluded ? 0.55 : 1;

    const keeper = s.keeper ? drill.keepers.find((k) => k.swimmer === s) : undefined;
    if (keeper) {
      const stretch = keeper.stretch;
      const lead = Math.sign(keeper.u - keeper.prevU) * -keeper.goal.facing;
      view.pose({
        x: sx,
        y: sy,
        scale,
        rise: 0.25 + 0.75 * stretch,
        facing,
        twist: lead * 0.35 * stretch,
        rightArm: Math.PI / 2 - 0.5 + (lead > 0 ? 0.6 * stretch : 0),
        rightReach: 0.7 + (lead >= 0 ? 0.3 * stretch : 0),
        leftArm: -Math.PI / 2 + 0.5 - (lead < 0 ? 0.6 * stretch : 0),
        leftReach: 0.7 + (lead <= 0 ? 0.3 * stretch : 0),
        time: t,
        ...(keeper.holding ? { grip: { hand: 'right' as const, x: ballX, y: ballY } } : {}),
      });
      return;
    }

    const hand = s.player.hand === 'left' ? -1 : 1;
    const scull = Math.PI / 2 - 0.6 + 0.15 * Math.sin(t * 3);
    let right = scull;
    let left = -scull;
    let rightReach = 0.55;
    let leftReach = 0.55;
    let twist = 0;
    if (speed > 0.7 && drill.ball.holder !== s) {
      // Front crawl: the arms take turns reaching forward.
      const phase = t * (4 + speed * 2);
      right = 0.7 + 0.9 * Math.sin(phase);
      left = -(0.7 + 0.9 * Math.sin(phase + Math.PI));
      rightReach = 0.6 + 0.4 * Math.cos(phase);
      leftReach = 0.6 + 0.4 * Math.cos(phase + Math.PI);
      twist = 0.12 * Math.sin(phase);
    }
    if (s.armUp > 0) {
      // Blocking: the arm goes up and forward, towards the shooter.
      right = lerp(right, 0.2, s.armUp);
      rightReach = lerp(rightReach, 1.15, s.armUp);
    }
    if (s.struggle > 0) twist += Math.sin(this.time * 18 + s.player.number) * 0.25 * s.struggle;
    const throwing = this.throws.get(s);
    if (throwing !== undefined) {
      // Follow-through of a pass or a shot.
      const arm = lerp(1.2, 0.1, throwing);
      if (hand === 1) {
        right = arm;
        rightReach = 1;
      } else {
        left = -arm;
        leftReach = 1;
      }
      twist -= hand * 0.25 * (1 - throwing);
    }
    const holding = drill.ball.holder === s;
    view.pose({
      x: sx,
      y: sy,
      scale,
      rise: s.rise,
      facing,
      twist: twist + (holding ? hand * 0.3 * s.rise : 0),
      rightArm: right,
      rightReach,
      leftArm: left,
      leftReach,
      time: t,
      ...(holding ? { grip: { hand: hand === 1 ? ('right' as const) : ('left' as const), x: ballX, y: ballY } } : {}),
    });
  }

  private placeRing(sprite: Sprite, s: Swimmer, alpha: number, scale: number, size: number): void {
    const x = lerp(s.prev.x, s.pos.x, alpha);
    const y = lerp(s.prev.y, s.pos.y, alpha);
    sprite.position.set(this.camera.projectX(x), this.camera.projectY(y));
    sprite.scale.set(size * scale, size * scale * TILT);
  }

  private drawRings(alpha: number, scale: number): void {
    const holder = this.drill.controlled;
    this.holderRing.visible = holder !== null;
    if (holder) {
      this.placeRing(this.holderRing, holder, alpha, scale, 0.62 + 0.03 * Math.sin(this.time * 6));
      this.holderRing.alpha = 0.95;
    }
    const selection = this.drill.selection;
    this.selectRing.visible = selection !== null;
    if (selection) {
      this.placeRing(this.selectRing, selection.swimmer, alpha, scale, 0.66 + 0.06 * Math.sin(this.time * 10));
      this.selectRing.alpha = 1;
    }
  }

  private dashed(g: Graphics, ax: number, ay: number, bx: number, by: number, dash: number, gap: number): void {
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1) return;
    const ux = (bx - ax) / length;
    const uy = (by - ay) / length;
    for (let d = 0; d < length; d += dash + gap) {
      const e = Math.min(length, d + dash);
      g.moveTo(ax + ux * d, ay + uy * d).lineTo(ax + ux * e, ay + uy * e);
    }
  }

  private arrowHead(g: Graphics, tipX: number, tipY: number, fromX: number, fromY: number, size: number, color: number): void {
    const angle = Math.atan2(tipY - fromY, tipX - fromX);
    g.poly([
      tipX,
      tipY,
      tipX - Math.cos(angle - 0.45) * size,
      tipY - Math.sin(angle - 0.45) * size,
      tipX - Math.cos(angle + 0.45) * size,
      tipY - Math.sin(angle + 0.45) * size,
    ]).fill(color);
  }

  private drawLines(alpha: number, scale: number, ballX: number, ballY: number): void {
    const { camera, drill } = this;
    const g = this.lines.clear();

    // Drives in progress: a subtle dashed arrow to where each one is going.
    for (const drive of drill.drives.values()) {
      const d = drive.driver;
      const fx = camera.projectX(lerp(d.prev.x, d.pos.x, alpha));
      const fy = camera.projectY(lerp(d.prev.y, d.pos.y, alpha));
      const tx = camera.projectX(drive.destination.x);
      const ty = camera.projectY(drive.destination.y);
      this.dashed(g, fx, fy, tx, ty, 14 * scale, 10 * scale);
      g.stroke({ color: drive.phase === 'free' ? 0xffd23f : 0xffffff, width: 3 * scale, alpha: 0.55 });
    }

    // HABILIDAD held: where the chosen team-mate would drive.
    const selection = drill.selection;
    if (selection?.destination) {
      const s = selection.swimmer;
      const fx = camera.projectX(s.pos.x);
      const fy = camera.projectY(s.pos.y);
      const tx = camera.projectX(selection.destination.x);
      const ty = camera.projectY(selection.destination.y);
      this.dashed(g, fx, fy, tx, ty, 16 * scale, 9 * scale);
      g.stroke({ color: SELECT_COLOR, width: 4 * scale, alpha: 0.9 });
      this.arrowHead(g, tx, ty, fx, fy, 16 * scale, SELECT_COLOR);
    }

    // Pass preview: arrow to the receiving point and the receiver's number, coloured by risk.
    const best = drill.preview?.best ?? null;
    this.badge.visible = best !== null;
    if (!best) return;
    const color = RISK_COLORS[riskColor(best.risk, this.passTuning)];
    const tx = camera.projectX(best.point.x, best.endZ);
    const ty = camera.projectY(best.point.y, best.endZ);
    const length = Math.hypot(tx - ballX, ty - ballY);
    const trim = Math.max(0, length - 18 * scale);
    const ex = ballX + ((tx - ballX) / (length || 1)) * trim;
    const ey = ballY + ((ty - ballY) / (length || 1)) * trim;
    g.moveTo(ballX, ballY).lineTo(ex, ey).stroke({ color: 0x04112a, width: 9 * scale, alpha: 0.45, cap: 'round' });
    g.moveTo(ballX, ballY).lineTo(ex, ey).stroke({ color, width: 5.5 * scale, cap: 'round' });
    this.arrowHead(g, tx, ty, ballX, ballY, 20 * scale, color);

    const r = best.receiver;
    const rx = camera.projectX(lerp(r.prev.x, r.pos.x, alpha));
    const ry = camera.projectY(lerp(r.prev.y, r.pos.y, alpha));
    if (this.badgeNumber !== r.player.number || this.badgeColor !== color) {
      this.badgeNumber = r.player.number;
      this.badgeColor = color;
      this.badgeText.text = String(r.player.number);
      this.badgeDisc.clear().circle(0, 0, 24).fill(color).stroke({ color: 0x04112a, width: 4 });
    }
    this.badge.position.set(rx, ry - 58 * scale);
    this.badge.scale.set(scale * (1 + 0.06 * Math.sin(this.time * 8)));
  }

  private drawCharge(alpha: number, scale: number): void {
    const { camera, drill } = this;
    const c = drill.charging;
    this.bar.visible = c !== null;
    this.aim.visible = c !== null;
    this.bounceMark.visible = c !== null && c.aim.mode === 'skip';
    if (!c) return;
    const s = c.shooter;
    const goal = drill.goalOf(s.team);
    const px = lerp(s.prev.x, s.pos.x, alpha);
    const py = lerp(s.prev.y, s.pos.y, alpha);
    const zone = optimalZone(s.player.stats.accuracy, this.shotTuning);
    const barHeight = 150 * scale;
    const barWidth = 22 * scale;
    const x = camera.projectX(px) - goal.facing * 78 * scale - barWidth / 2;
    const y = camera.projectY(py) - barHeight * 0.62;
    const fill = c.charge;
    const inZone = fill >= zone.start && fill <= zone.end;
    const color = fill < zone.start ? 0x7fd3ff : inZone ? 0x62e08f : 0xe23b46;
    this.bar
      .clear()
      .roundRect(x - 4, y - 4, barWidth + 8, barHeight + 8, 8)
      .fill({ color: 0x04112a, alpha: 0.85 })
      .rect(x, y + barHeight * (1 - zone.end), barWidth, barHeight * (zone.end - zone.start))
      .fill({ color: 0x62e08f, alpha: 0.45 })
      .rect(x, y + barHeight * (1 - fill), barWidth, barHeight * fill)
      .fill(color)
      .rect(x - 6, y + barHeight * (1 - zone.end) - 1.5, barWidth + 12, 3)
      .rect(x - 6, y + barHeight * (1 - zone.start) - 1.5, barWidth + 12, 3)
      .fill(0xffffff);

    const aimU = c.aim.side * (goal.halfWidth - this.shotTuning.apuntadoPalo);
    const aimV = c.aim.mode === 'lob' ? this.shotTuning.vaselina.alturaApuntado : this.shotTuning.alturaApuntado;
    this.aim.position.set(camera.projectX(goal.x, aimV), camera.projectY(goal.y + aimU, aimV));
    this.aim.scale.set(scale * (1 + 0.08 * Math.sin(this.time * 9)));
    this.aim.alpha = c.aim.side === 0 ? 0.45 : 1;
    if (this.bounceMark.visible) {
      const before = this.shotTuning.bote.distanciaAntesDeGol;
      const k = 1 - before / Math.max(before + 0.5, Math.abs(goal.x - px));
      this.bounceMark.position.set(camera.projectX(goal.x - goal.facing * before), camera.projectY(lerp(py, goal.y + aimU, k)));
      this.bounceMark.scale.set(0.5 * scale, 0.5 * scale * TILT);
    }
  }

  private drawLabels(alpha: number): void {
    const { camera } = this;
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i] as Label;
      if (!l.sticky && this.time >= l.until) {
        l.text.destroy();
        this.labels.splice(i, 1);
        continue;
      }
      const x = l.swimmer ? lerp(l.swimmer.prev.x, l.swimmer.pos.x, alpha) : l.x;
      const y = l.swimmer ? lerp(l.swimmer.prev.y, l.swimmer.pos.y, alpha) : l.y;
      l.text.position.set(camera.projectX(x), camera.projectY(y) - 40 * camera.actorScale);
      // Pops in big, settles, then fades at the end.
      const settle = Math.max(1, l.text.scale.x - 0.08);
      l.text.scale.set(settle);
      l.text.alpha = l.sticky ? 1 : clamp((l.until - this.time) / 0.25, 0, 1);
    }
  }
}

const ATTACK_EVENTS = new Set<string>([
  'attackStart', 'whistle', 'pass', 'noReceiver', 'catch', 'intercept', 'driveStart', 'driveFree', 'driveEnd', 'noDrive',
  'postFight', 'turn', 'escape', 'steal', 'chargeStart', 'release', 'block', 'bounce', 'dive', 'outcome', 'net', 'frame',
  'splash', 'looseWon', 'attackEnd',
]);
function isAttackEvent(event: { type: string }): event is AttackEvent {
  return ATTACK_EVENTS.has(event.type);
}
