/**
 * Draws a shooter-against-keeper duel: water, pool, goal, the two players, the ball and its
 * shadow, the charge bar and the impact effects. Reads the simulation, never changes it.
 */
import { Container, Graphics, Sprite, type Renderer } from 'pixi.js';
import { clamp, lerp } from '../core/math';
import type { Rng } from '../core/rng';
import type { Duel, DuelEvent } from '../sim/duel/duel';
import type { Field } from '../sim/field';
import { optimalZone, type ShotTuning } from '../sim/shooting/model';
import { actorTextures, BallView, Splashes, SwimmerView } from './actors';
import { Camera, TILT } from './camera';
import { rippleTexture, type CapColor } from './caps';
import { BEHIND_GOAL, PoolView } from './pool';
import type { QualityProfile } from './quality';
import { Water } from './water';

export interface DuelLook {
  shooter: { color: CapColor; number: number; leftHanded: boolean };
  keeper: { number: number };
  /** Charge bar and aim marker are only shown when the player is the one shooting. */
  playerShoots: boolean;
}

/** Requests the view makes to whoever runs the clock: freeze frames and slow motion. */
export interface TimeEffects {
  hitStop(frames: number): void;
  slowMotion(scale: number, seconds: number): void;
}

interface Ripple {
  sprite: Sprite;
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
}

export class ShotView {
  readonly view = new Container();
  readonly camera: Camera;
  private readonly water = new Water();
  private readonly pool: PoolView;
  private readonly rippleLayer = new Container();
  private readonly shadowLayer = new Container();
  private readonly actorLayer = new Container();
  private readonly hudLayer = new Container();
  private readonly shooter: SwimmerView;
  private readonly keeper: SwimmerView;
  private readonly ball: BallView;
  private readonly splashes: Splashes;
  private readonly bar = new Graphics();
  private readonly aim: Sprite;
  private readonly bounceMark: Sprite;
  private readonly ripples: Ripple[] = [];
  private readonly ripplePool: Sprite[] = [];
  private readonly projected = { x: 0, y: 0 };

  private duel: Duel | null = null;
  private look: DuelLook | null = null;
  private time = 0;
  private spin = 0;
  private particleAmount = 1;

  constructor(
    private readonly renderer: Renderer,
    private readonly field: Field,
    private readonly shotTuning: ShotTuning,
    private readonly rng: Rng,
    private readonly effects: TimeEffects,
  ) {
    this.camera = new Camera(rng, field.length / 2);
    this.pool = new PoolView(field);
    this.shooter = new SwimmerView(renderer);
    this.keeper = new SwimmerView(renderer);
    this.ball = new BallView(renderer);
    this.splashes = new Splashes(renderer);
    const textures = actorTextures(renderer);
    this.aim = new Sprite(textures.aim);
    this.aim.anchor.set(0.5);
    this.bounceMark = new Sprite(rippleTexture(renderer));
    this.bounceMark.anchor.set(0.5);
    this.bounceMark.tint = 0xffd23f;
    this.aim.visible = this.bounceMark.visible = this.bar.visible = false;

    this.shadowLayer.addChild(this.ball.shadow);
    this.actorLayer.addChild(this.keeper.view, this.shooter.view, ...this.ball.trail, this.ball.ball);
    this.hudLayer.addChild(this.bounceMark, this.aim, this.bar);
    this.view.addChild(
      this.water.view,
      this.pool.floor,
      this.rippleLayer,
      this.shadowLayer,
      this.actorLayer,
      this.pool.front,
      this.splashes.view,
      this.hudLayer,
    );
  }

  layout(width: number, height: number): void {
    this.camera.setViewport(width, height);
    this.water.resize(width, height);
    if (this.duel) this.frameDuel(this.duel, true);
    else this.lookAtGoal(this.field.fiveMetres);
  }

  /** Points the camera at a goal before any duel exists (intro of a shoot-out). */
  lookAtGoal(distance: number): void {
    const goal = this.field.goalRight;
    this.camera.frame(
      this.camera.fit(goal.x - distance - 2.4, goal.x + BEHIND_GOAL + 0.6, goal.y - goal.halfWidth - 2.3, goal.y + goal.halfWidth + 2, 118),
      true,
    );
  }

  /** Starts showing a duel. `snap` jumps the camera instead of gliding to the new framing. */
  setDuel(duel: Duel, look: DuelLook, snap = false): void {
    this.duel = duel;
    this.look = look;
    this.shooter.setCap(look.shooter.color, look.shooter.number);
    this.keeper.setCap('red', look.keeper.number);
    this.ball.clearTrail();
    this.frameDuel(duel, snap);
  }

  private frameDuel(duel: Duel, snap: boolean): void {
    const { goal, position } = duel.config;
    const behind = goal.x + (goal.facing === 1 ? BEHIND_GOAL + 0.6 : -(BEHIND_GOAL + 0.6));
    const back = position.x - goal.facing * 2.4;
    const minY = Math.min(position.y, goal.y - goal.halfWidth) - 2.3;
    const maxY = Math.max(position.y, goal.y + goal.halfWidth) + 2.0;
    this.camera.frame(this.camera.fit(Math.min(back, behind), Math.max(back, behind), minY, maxY, 118), snap);
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

  /** Reacts to what just happened in the simulation with effects (GDD §16, impact effects). */
  onEvent(event: DuelEvent): void {
    const duel = this.duel;
    if (!duel) return;
    const goal = duel.config.goal;
    switch (event.type) {
      case 'release':
        // A hard shot gets a few frozen frames and a nudge of the camera on release.
        if (event.plan.speed > 18) {
          this.effects.hitStop(event.plan.speed > 22 ? 5 : 3);
          this.camera.zoomPunch(0.035);
        }
        this.splash(duel.config.position.x, duel.config.position.y, 0.35);
        break;
      case 'bounce':
        this.splash(event.at.x, event.at.y, clamp(event.speed / 26, 0.4, 1));
        break;
      case 'splash':
        this.splash(event.at.x, event.at.y, event.strength);
        break;
      case 'dive':
        this.ripple(goal.x - goal.facing * 0.35, goal.y + duel.keeperU, 0.6);
        break;
      case 'frame':
        this.camera.shake(11);
        break;
      case 'net':
        this.pool.hitNet(goal, event.at.y - goal.y, event.at.z, clamp((duel.plan?.arrivalSpeed ?? 15) / 26, 0.2, 1));
        break;
      case 'outcome':
        if (event.outcome.type === 'goal') {
          this.effects.slowMotion(0.3, 0.45);
          this.camera.zoomPunch(0.06);
        } else if (event.outcome.type === 'save') {
          this.camera.shake(event.outcome.held ? 3 : 7);
          // Sparks of water off the keeper's hands.
          this.splashes.burst(goal.x - goal.facing * 0.3, goal.y + duel.keeperU, 0.8, this.particleAmount, () => this.rng.next());
        }
        break;
      default:
        break;
    }
  }

  render(alpha: number, dt: number, profile: QualityProfile): void {
    const { camera } = this;
    this.time += dt;
    this.particleAmount = profile.particles;
    camera.update(dt);
    this.water.setView(-camera.offsetX / camera.scale, -camera.offsetY / (camera.scale * TILT), TILT);
    this.water.update(this.time, profile.caustics, camera.scale);
    this.pool.update(dt);
    this.pool.sync(camera);

    const duel = this.duel;
    const look = this.look;
    if (duel && look) this.drawDuel(duel, look, alpha);

    this.splashes.update(dt, (x, y, z, out) => this.project(x, y, z, out), camera.actorScale);
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

  private drawDuel(duel: Duel, look: DuelLook, alpha: number): void {
    const { camera } = this;
    const { goal, position } = duel.config;
    const scale = camera.actorScale;
    const toGoal = goal.facing === 1 ? 0 : Math.PI;
    const hand = look.shooter.leftHanded ? -1 : 1;

    // --- Ball position (needed first: the throwing hand follows it) ----------------------------
    const bx = lerp(duel.prevBall.x, duel.ball.x, alpha);
    const by = lerp(duel.prevBall.y, duel.ball.y, alpha);
    const bz = lerp(duel.prevBall.z, duel.ball.z, alpha);
    const ballX = camera.projectX(bx, bz);
    const ballY = camera.projectY(by, bz);

    // --- Shooter -----------------------------------------------------------------------------
    const rise = duel.rise;
    const throwing = duel.throwing;
    const holding = duel.ballHolder === 'shooter';
    // After the release the throwing arm follows through towards the goal, then relaxes.
    const followThrough = lerp(1.2, 0.15, throwing);
    const restAngle = -Math.PI / 2 + 0.5 * rise;
    const throwArm = { angle: followThrough, reach: holding ? 0.6 : lerp(0.8, 1, throwing) };
    const otherArm = { angle: restAngle, reach: 0.55 + 0.25 * rise };
    this.shooter.pose({
      x: camera.projectX(position.x),
      y: camera.projectY(position.y),
      scale,
      rise,
      facing: toGoal,
      twist: duel.tell * 0.32 + hand * 0.3 * rise * (1 - throwing) - hand * 0.25 * throwing,
      rightArm: hand === 1 ? throwArm.angle : -otherArm.angle,
      rightReach: hand === 1 ? throwArm.reach : otherArm.reach,
      leftArm: hand === 1 ? otherArm.angle : -throwArm.angle,
      leftReach: hand === 1 ? otherArm.reach : throwArm.reach,
      time: this.time,
      ...(holding ? { grip: { hand: hand === 1 ? ('right' as const) : ('left' as const), x: ballX, y: ballY } } : {}),
    });

    // --- Keeper ------------------------------------------------------------------------------
    const keeperU = lerp(duel.prevKeeperU, duel.keeperU, alpha);
    const stretch = duel.keeperStretch;
    const moving = Math.sign(duel.keeperU - duel.prevKeeperU);
    // Seen from the keeper (who faces the field), which arm leads the dive.
    const lead = moving * -goal.facing;
    this.keeper.pose({
      x: camera.projectX(goal.x - goal.facing * 0.35),
      y: camera.projectY(goal.y + keeperU),
      scale,
      rise: 0.25 + 0.75 * stretch,
      facing: toGoal + Math.PI,
      twist: lead * 0.35 * stretch,
      // Set: arms out and a little forward. Diving: the leading arm opens wide and reaches.
      rightArm: Math.PI / 2 - 0.5 + (lead > 0 ? 0.6 * stretch : 0),
      rightReach: 0.7 + (lead >= 0 ? 0.3 * stretch : 0),
      leftArm: -Math.PI / 2 + 0.5 - (lead < 0 ? 0.6 * stretch : 0),
      leftReach: 0.7 + (lead <= 0 ? 0.3 * stretch : 0),
      time: this.time + 1.3,
    });

    // --- Ball --------------------------------------------------------------------------------
    const speed = duel.phase === 'flight' ? (duel.plan?.speed ?? 0) : 0;
    this.spin += speed * 0.02;
    this.ball.place(ballX, ballY, camera.projectX(bx), camera.projectY(by), bz, scale, speed, this.spin);
    // Held low in the water the ball has no visible shadow of its own.
    this.ball.shadow.visible = duel.ballHolder === null || bz > 0.4;

    // --- Charge bar and aim ------------------------------------------------------------------
    const charging = duel.phase === 'charging' && look.playerShoots;
    this.bar.visible = charging;
    this.aim.visible = charging;
    this.bounceMark.visible = charging && duel.aim.mode === 'skip';
    if (!charging) return;

    const zone = optimalZone(duel.config.shooter.accuracy, this.shotTuning);
    const barHeight = 170 * scale;
    const barWidth = 24 * scale;
    const x = camera.projectX(position.x) - goal.facing * 92 * scale - barWidth / 2;
    const y = camera.projectY(position.y) - barHeight * 0.62;
    const fill = duel.charge;
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

    const aimU = duel.aim.side * (goal.halfWidth - this.shotTuning.apuntadoPalo);
    const aimV = duel.aim.mode === 'lob' ? this.shotTuning.vaselina.alturaApuntado : this.shotTuning.alturaApuntado;
    this.aim.position.set(camera.projectX(goal.x, aimV), camera.projectY(goal.y + aimU, aimV));
    this.aim.scale.set(scale * (1 + 0.08 * Math.sin(this.time * 9)));
    this.aim.alpha = duel.aim.side === 0 ? 0.45 : 1;
    if (this.bounceMark.visible) {
      const before = this.shotTuning.bote.distanciaAntesDeGol;
      const k = 1 - before / Math.max(before + 0.5, Math.abs(goal.x - position.x));
      const markY = lerp(position.y, goal.y + aimU, k);
      this.bounceMark.position.set(camera.projectX(goal.x - goal.facing * before), camera.projectY(markY));
      this.bounceMark.scale.set(0.5 * scale, 0.5 * scale * TILT);
    }
  }

}
