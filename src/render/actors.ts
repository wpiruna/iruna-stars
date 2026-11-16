/**
 * Players and ball as seen from above (GDD §16), built from a handful of baked textures:
 * cap with number, shoulders, arms. Poses are just sprite transforms, so animating costs nothing.
 */
import { Container, Graphics, Sprite, type Renderer, type Texture } from 'pixi.js';
import { CAP_RADIUS, capTexture, type CapColor } from './caps';

const SKIN = 0xd9a07c;
const SKIN_SHADE = 0xb9805e;
const R = CAP_RADIUS;

interface Textures {
  torso: Texture;
  under: Texture;
  arm: Texture;
  hand: Texture;
  ball: Texture;
  shadow: Texture;
  dot: Texture;
  aim: Texture;
}
let textures: Textures | null = null;

function bake(renderer: Renderer, drawing: Graphics | Container, resolution = 2): Texture {
  const texture = renderer.generateTexture({ target: drawing, resolution, antialias: true });
  drawing.destroy({ children: true });
  return texture;
}

/** Shared textures, created on first use. */
export function actorTextures(renderer: Renderer): Textures {
  if (textures) return textures;
  const torso = new Graphics()
    .ellipse(0, 0, R * 0.78, R * 1.38)
    .fill(SKIN)
    .ellipse(R * 0.12, 0, R * 0.5, R * 1.05)
    .fill({ color: SKIN_SHADE, alpha: 0.55 });
  const under = new Graphics().ellipse(0, 0, R * 1.25, R * 1.75).fill({ color: 0x1356a8, alpha: 0.5 });
  // Arm drawn pointing to +x from the shoulder (the origin).
  const arm = new Graphics()
    .roundRect(0, -R * 0.24, R * 1.55, R * 0.48, R * 0.24)
    .fill(SKIN)
    .roundRect(R * 0.2, R * 0.02, R * 1.2, R * 0.2, R * 0.1)
    .fill({ color: SKIN_SHADE, alpha: 0.5 });
  const hand = new Graphics().circle(0, 0, R * 0.3).fill(SKIN).stroke({ color: SKIN_SHADE, width: 2 });

  const b = R * 0.62;
  const ball = new Graphics()
    .circle(0, 0, b)
    .fill(0xffd21f)
    .stroke({ color: 0x8a5a00, width: 2.5 })
    // Grip seams of a water polo ball.
    .moveTo(-b, 0)
    .bezierCurveTo(-b * 0.4, -b * 0.55, b * 0.4, -b * 0.55, b, 0)
    .moveTo(-b, 0)
    .bezierCurveTo(-b * 0.4, b * 0.55, b * 0.4, b * 0.55, b, 0)
    .moveTo(0, -b)
    .lineTo(0, b)
    .stroke({ color: 0x1b2a4a, width: 2.2, alpha: 0.8 })
    .ellipse(-b * 0.3, -b * 0.4, b * 0.3, b * 0.18)
    .fill({ color: 0xffffff, alpha: 0.6 });

  // Soft shadow: stacked translucent ellipses instead of a blur filter.
  const shadow = new Graphics();
  for (let i = 0; i < 5; i++) shadow.ellipse(0, 0, 28 - i * 4, 16 - i * 2.4).fill({ color: 0x021030, alpha: 0.13 });

  const dot = new Graphics().circle(0, 0, 6).fill(0xffffff);
  const aim = new Graphics()
    .circle(0, 0, 20)
    .stroke({ color: 0xffffff, width: 4 })
    .circle(0, 0, 5)
    .fill(0xffd23f)
    .moveTo(-30, 0)
    .lineTo(-12, 0)
    .moveTo(12, 0)
    .lineTo(30, 0)
    .moveTo(0, -30)
    .lineTo(0, -12)
    .moveTo(0, 12)
    .lineTo(0, 30)
    .stroke({ color: 0xffd23f, width: 4, cap: 'round' });

  textures = {
    torso: bake(renderer, torso),
    under: bake(renderer, under),
    arm: bake(renderer, arm),
    hand: bake(renderer, hand),
    ball: bake(renderer, ball),
    shadow: bake(renderer, shadow),
    dot: bake(renderer, dot, 1),
    aim: bake(renderer, aim),
  };
  return textures;
}

function sprite(texture: Texture, anchorX = 0.5, anchorY = 0.5): Sprite {
  const s = new Sprite(texture);
  s.anchor.set(anchorX, anchorY);
  return s;
}

export interface SwimmerPose {
  /** Screen position of the body at water level, and overall size. */
  x: number;
  y: number;
  scale: number;
  /** 0 = low in the water, 1 = risen out of it. */
  rise: number;
  /** Direction the chest points to, radians (0 = right). */
  facing: number;
  /** Shoulder turn on top of the facing, radians. */
  twist: number;
  /** Angle of each arm relative to the chest direction, radians, and how far it reaches (0–1). */
  rightArm: number;
  rightReach: number;
  leftArm: number;
  leftReach: number;
  /** Seconds, for the treading-water bob. */
  time: number;
  /**
   * Screen point one hand must reach (the ball it is holding). Overrides that arm's angle and
   * reach so the hand is exactly where the ball is drawn.
   */
  grip?: { hand: 'right' | 'left'; x: number; y: number };
}

/** A player in the water. The cap (and its number) always stays upright. */
export class SwimmerView {
  readonly view = new Container();
  private readonly under: Sprite;
  private readonly body = new Container();
  private readonly torso: Sprite;
  private readonly rightArm: Sprite;
  private readonly leftArm: Sprite;
  private readonly rightHand: Sprite;
  private readonly leftHand: Sprite;
  private readonly cap: Sprite;
  private key = '';

  constructor(private readonly renderer: Renderer) {
    const t = actorTextures(renderer);
    this.under = sprite(t.under);
    this.torso = sprite(t.torso);
    this.rightArm = sprite(t.arm, 0, 0.5);
    this.leftArm = sprite(t.arm, 0, 0.5);
    this.rightHand = sprite(t.hand);
    this.leftHand = sprite(t.hand);
    this.cap = new Sprite();
    this.cap.anchor.set(0.5);
    this.body.addChild(this.leftArm, this.rightArm, this.leftHand, this.rightHand, this.torso);
    this.view.addChild(this.under, this.body, this.cap);
  }

  setCap(color: CapColor, number: number): void {
    const key = `${color}-${number}`;
    if (key === this.key) return;
    this.key = key;
    this.cap.texture = capTexture(this.renderer, color, number);
  }

  pose(p: SwimmerPose): void {
    const bob = Math.sin(p.time * 2.6) * 0.02;
    const lift = p.rise * R * 0.42;
    this.view.position.set(p.x, p.y);
    this.view.scale.set(p.scale);

    this.under.rotation = p.facing;
    this.under.alpha = 1 - p.rise * 0.35;
    this.under.scale.set(1 + bob);

    // Rising out of the water: more torso shows, a little bigger and higher on screen.
    this.body.position.set(0, -lift);
    this.body.rotation = p.facing + p.twist;
    this.body.scale.set(0.82 + 0.3 * p.rise + bob);

    const shoulder = R * 1.02;
    const armLength = R * 1.55;
    let rightAngle = p.rightArm;
    let leftAngle = p.leftArm;
    let rightLength = 0.35 + 0.65 * p.rightReach;
    let leftLength = 0.35 + 0.65 * p.leftReach;
    if (p.grip) {
      // Screen point → the body's own rotated, scaled space, then aim the arm from its shoulder.
      const side = p.grip.hand === 'right' ? 1 : -1;
      const bodyScale = this.body.scale.x * p.scale;
      const dx = (p.grip.x - p.x) / bodyScale;
      const dy = (p.grip.y - p.y + lift * p.scale) / bodyScale;
      const cos = Math.cos(-this.body.rotation);
      const sin = Math.sin(-this.body.rotation);
      const localX = dx * cos - dy * sin;
      const localY = dx * sin + dy * cos - side * shoulder;
      const angle = Math.atan2(localY, localX);
      const length = Math.min(1.25, Math.max(0.3, Math.hypot(localX, localY) / armLength));
      if (side === 1) {
        rightAngle = angle;
        rightLength = length;
      } else {
        leftAngle = angle;
        leftLength = length;
      }
    }
    this.rightArm.position.set(0, shoulder);
    this.leftArm.position.set(0, -shoulder);
    this.rightArm.rotation = rightAngle;
    this.leftArm.rotation = leftAngle;
    this.rightArm.scale.set(rightLength, 1);
    this.leftArm.scale.set(leftLength, 1);
    this.rightHand.position.set(Math.cos(rightAngle) * armLength * rightLength, shoulder + Math.sin(rightAngle) * armLength * rightLength);
    this.leftHand.position.set(Math.cos(leftAngle) * armLength * leftLength, -shoulder + Math.sin(leftAngle) * armLength * leftLength);

    this.cap.position.set(0, -lift * 1.25);
    this.cap.scale.set(1 + 0.08 * p.rise);
  }
}

/** Ball with its shadow on the water and a short trail when it flies fast. */
export class BallView {
  readonly shadow: Sprite;
  readonly ball: Sprite;
  readonly trail: Sprite[] = [];
  private readonly history: { x: number; y: number }[] = [];

  constructor(renderer: Renderer, trailLength = 6) {
    const t = actorTextures(renderer);
    this.shadow = sprite(t.shadow);
    this.ball = sprite(t.ball);
    for (let i = 0; i < trailLength; i++) {
      const ghost = sprite(t.ball);
      ghost.visible = false;
      ghost.tint = 0xfff3b0;
      this.trail.push(ghost);
    }
  }

  /**
   * @param sx, sy   screen position of the ball
   * @param gx, gy   screen position of its shadow on the water
   * @param z        height in metres
   * @param speed    metres per second, to decide how much trail to show
   */
  place(sx: number, sy: number, gx: number, gy: number, z: number, scale: number, speed: number, spin: number): void {
    this.ball.position.set(sx, sy);
    this.ball.scale.set(scale * (1 + z * 0.14));
    this.ball.rotation = spin;
    // The higher the ball, the smaller and fainter its shadow.
    this.shadow.position.set(gx, gy);
    this.shadow.scale.set(scale * Math.max(0.45, 1 - z * 0.22));
    this.shadow.alpha = Math.max(0.25, 1 - z * 0.28);

    this.history.unshift({ x: sx, y: sy });
    if (this.history.length > this.trail.length * 2) this.history.pop();
    const show = speed > 14;
    for (let i = 0; i < this.trail.length; i++) {
      const ghost = this.trail[i] as Sprite;
      const past = this.history[(i + 1) * 2 - 1];
      ghost.visible = show && past !== undefined;
      if (!ghost.visible || !past) continue;
      ghost.position.set(past.x, past.y);
      ghost.scale.set(this.ball.scale.x * (1 - (i + 1) * 0.11));
      ghost.alpha = 0.34 * (1 - i / this.trail.length);
    }
  }

  clearTrail(): void {
    this.history.length = 0;
    for (const ghost of this.trail) ghost.visible = false;
  }
}

interface Particle {
  sprite: Sprite;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  age: number;
  size: number;
}

/** Water droplets: world-space particles with gravity, pooled. */
export class Splashes {
  readonly view = new Container();
  private readonly active: Particle[] = [];
  private readonly pool: Particle[] = [];
  private readonly texture: Texture;

  constructor(renderer: Renderer) {
    this.texture = actorTextures(renderer).dot;
  }

  burst(x: number, y: number, strength: number, amount: number, random: () => number): void {
    const count = Math.round((8 + strength * 26) * amount);
    for (let i = 0; i < count; i++) {
      let p = this.pool.pop();
      if (!p) {
        const s = sprite(this.texture);
        this.view.addChild(s);
        p = { sprite: s, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, age: 0, size: 1 };
      }
      const angle = random() * Math.PI * 2;
      const speed = (0.6 + random() * 2.4) * (0.5 + strength);
      p.x = x;
      p.y = y;
      p.z = 0.05;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.vz = (2 + random() * 3.5) * (0.5 + strength * 0.8);
      p.life = 0.45 + random() * 0.4;
      p.age = 0;
      p.size = 0.35 + random() * 0.6;
      p.sprite.visible = true;
      this.active.push(p);
    }
  }

  update(dt: number, project: (x: number, y: number, z: number, out: { x: number; y: number }) => void, scale: number): void {
    const out = { x: 0, y: 0 };
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i] as Particle;
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= 9.8 * dt;
      if (p.age >= p.life || p.z < 0) {
        p.sprite.visible = false;
        this.pool.push(p);
        this.active.splice(i, 1);
        continue;
      }
      project(p.x, p.y, p.z, out);
      p.sprite.position.set(out.x, out.y);
      p.sprite.scale.set(p.size * scale);
      p.sprite.alpha = 0.9 * (1 - p.age / p.life);
    }
  }
}
