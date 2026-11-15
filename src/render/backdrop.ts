/**
 * Title-screen scene and F0 performance probe: the water plus players treading water, each
 * leaving ripples. The debug layer can multiply the load to check that adaptive quality reacts.
 * From F1 the real pool replaces it during play.
 */
import { Container, Sprite, type Renderer } from 'pixi.js';
import { STEP_MS } from '../core/loop';
import { lerp } from '../core/math';
import { Rng } from '../core/rng';
import { CAP_RADIUS, capTexture, rippleTexture, type CapColor } from './caps';
import type { QualityProfile } from './quality';
import { Water } from './water';

export const PIXELS_PER_METRE = 55;
const BASE_SWIMMERS = 14;
const STEP_SECONDS = STEP_MS / 1000;

interface Swimmer {
  sprite: Sprite;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  phase: number;
  nextRipple: number;
}

interface Ripple {
  sprite: Sprite;
  age: number;
  life: number;
}

export class Backdrop {
  readonly view = new Container();
  private readonly water = new Water();
  private readonly rippleLayer = new Container();
  private readonly swimmerLayer = new Container();
  private readonly swimmers: Swimmer[] = [];
  private readonly ripples: Ripple[] = [];
  private readonly ripplePool: Sprite[] = [];
  private readonly rng = new Rng('backdrop');
  private width = 1280;
  private height = 720;
  private time = 0;
  private particleScale = 1;

  constructor(private readonly renderer: Renderer) {
    this.view.addChild(this.water.view, this.rippleLayer, this.swimmerLayer);
    this.setSwimmers(BASE_SWIMMERS);
  }

  get swimmerCount(): number {
    return this.swimmers.length;
  }

  /** Stress control for the debug layer: 1 = normal scene. */
  setLoad(multiplier: number): void {
    this.setSwimmers(Math.round(BASE_SWIMMERS * multiplier));
  }

  private setSwimmers(count: number): void {
    while (this.swimmers.length > count) this.swimmers.pop()?.sprite.destroy();
    while (this.swimmers.length < count) {
      const index = this.swimmers.length;
      const color: CapColor = index % 7 === 0 ? 'red' : index % 2 === 0 ? 'white' : 'blue';
      const sprite = new Sprite(capTexture(this.renderer, color, (index % 13) + 1));
      sprite.anchor.set(0.5);
      this.swimmerLayer.addChild(sprite);
      const x = this.rng.range(0, this.width);
      const y = this.rng.range(0, this.height);
      this.swimmers.push({
        sprite,
        x,
        y,
        prevX: x,
        prevY: y,
        vx: this.rng.range(-14, 14),
        vy: this.rng.range(-9, 9),
        phase: this.rng.range(0, Math.PI * 2),
        nextRipple: this.rng.range(0, 1.2),
      });
    }
  }

  layout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.water.resize(width, height);
  }

  /** One fixed simulation step (1/60 s). */
  step(): void {
    this.time += STEP_SECONDS;
    const margin = CAP_RADIUS * 2;
    for (const s of this.swimmers) {
      s.prevX = s.x;
      s.prevY = s.y;
      // Treading water: a slow drift with a gentle sway.
      s.x += (s.vx + Math.sin(this.time * 0.9 + s.phase) * 6) * STEP_SECONDS;
      s.y += (s.vy + Math.cos(this.time * 0.7 + s.phase) * 5) * STEP_SECONDS;
      if (s.x < -margin) s.x = s.prevX = this.width + margin;
      else if (s.x > this.width + margin) s.x = s.prevX = -margin;
      if (s.y < -margin) s.y = s.prevY = this.height + margin;
      else if (s.y > this.height + margin) s.y = s.prevY = -margin;

      s.nextRipple -= STEP_SECONDS;
      if (s.nextRipple <= 0) {
        s.nextRipple = this.rng.range(0.9, 1.5) / Math.max(0.25, this.particleScale);
        this.spawnRipple(s.x, s.y);
      }
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const ripple = this.ripples[i] as Ripple;
      ripple.age += STEP_SECONDS;
      if (ripple.age >= ripple.life) {
        ripple.sprite.visible = false;
        this.ripplePool.push(ripple.sprite);
        this.ripples.splice(i, 1);
      }
    }
  }

  private spawnRipple(x: number, y: number): void {
    let sprite = this.ripplePool.pop();
    if (!sprite) {
      sprite = new Sprite(rippleTexture(this.renderer));
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      this.rippleLayer.addChild(sprite);
    }
    sprite.visible = true;
    sprite.position.set(x, y);
    this.ripples.push({ sprite, age: 0, life: 1.6 });
  }

  /** Per-frame presentation: interpolates between the last two steps. */
  render(alpha: number, profile: QualityProfile): void {
    this.particleScale = profile.particles;
    this.water.update(this.time + alpha * STEP_SECONDS, profile.caustics, PIXELS_PER_METRE);
    const bobTime = this.time + alpha * STEP_SECONDS;
    for (const s of this.swimmers) {
      s.sprite.position.set(lerp(s.prevX, s.x, alpha), lerp(s.prevY, s.y, alpha));
      s.sprite.scale.set(1 + Math.sin(bobTime * 2.4 + s.phase) * 0.025);
    }
    for (const ripple of this.ripples) {
      const t = (ripple.age + alpha * STEP_SECONDS) / ripple.life;
      ripple.sprite.scale.set(0.45 + t * 1.25, (0.45 + t * 1.25) * 0.82);
      ripple.sprite.alpha = (1 - t) * 0.3;
    }
  }
}
