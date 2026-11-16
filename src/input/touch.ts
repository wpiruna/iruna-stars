/**
 * Touch controls (GDD §5.1): a floating pad on one half of the screen and two big buttons on
 * the other, plus a small pause button. Real multi-touch: each control owns the finger that
 * pressed it (pointer capture), so pad and buttons never interfere.
 */
import type { Settings } from '../persist/storage';
import type { SourceState, TouchLike } from './controller';

const DEAD_ZONE = 0.18;
/** Pad radius in rem at scale 1. */
const PAD_RADIUS_REM = 4.6;
/** The floating pad never appears closer than this to the screen edge (iOS back gesture). */
const EDGE_MARGIN_PX = 24;

function el(className: string, text = ''): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class TouchControls implements TouchLike {
  readonly state: SourceState = { x: 0, y: 0, shot: false, skill: false, pause: false, touching: false };
  lastUsed = 0;

  private readonly root = el('controls');
  private readonly zone = el('controls__zone');
  private readonly pad = el('pad');
  private readonly knob = el('pad__knob');
  private readonly skill = el('tbtn tbtn--skill', 'HABILIDAD');
  private readonly shot = el('tbtn tbtn--shot', 'TIRO');
  private readonly pause = el('tbtn tbtn--pause', 'II');

  private padPointer: number | null = null;
  private originX = 0;
  private originY = 0;
  private radius = 70;
  private fixed = false;
  private knobX = 0;
  private knobY = 0;
  private dirty = true;

  constructor(host: HTMLElement, onPause: () => void) {
    this.pad.appendChild(this.knob);
    this.root.append(this.zone, this.pad, this.skill, this.shot, this.pause);
    host.appendChild(this.root);

    this.zone.addEventListener('pointerdown', (event) => this.padDown(event));
    this.zone.addEventListener('pointermove', (event) => this.padMove(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.zone.addEventListener(type, (event) => this.padUp(event));
    }
    this.bindButton(this.shot, (down) => (this.state.shot = down));
    this.bindButton(this.skill, (down) => (this.state.skill = down));
    this.pause.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.lastUsed = performance.now();
      onPause();
    });
    // The browser must never treat touches on the controls as scroll, zoom or text selection.
    this.root.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('controls--on', visible);
    if (!visible) this.release();
  }

  apply(settings: Settings): void {
    this.fixed = settings.padMode === 'fijo';
    this.root.classList.toggle('controls--swap', settings.swapSides);
    this.root.classList.toggle('controls--fixed', this.fixed);
    this.root.style.setProperty('--control-scale', String(settings.controlScale));
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    this.radius = PAD_RADIUS_REM * rem * settings.controlScale;
    this.dirty = true;
  }

  /** Releases everything, e.g. when the game is paused with a finger still down. */
  release(): void {
    this.padPointer = null;
    this.state.touching = false;
    this.state.x = this.state.y = 0;
    this.state.shot = this.state.skill = false;
    this.knobX = this.knobY = 0;
    this.pad.classList.remove('pad--active');
    this.shot.classList.remove('tbtn--down');
    this.skill.classList.remove('tbtn--down');
    this.dirty = true;
  }

  /** Moves the pad graphics; call once per rendered frame. */
  frame(): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (!this.fixed) this.pad.style.transform = `translate(${this.originX}px, ${this.originY}px) translate(-50%, -50%)`;
    else this.pad.style.transform = '';
    this.knob.style.transform = `translate(${this.knobX * this.radius * 0.62}px, ${this.knobY * this.radius * 0.62}px)`;
  }

  private bindButton(button: HTMLElement, set: (down: boolean) => void): void {
    const down = (event: PointerEvent): void => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      button.classList.add('tbtn--down');
      this.lastUsed = performance.now();
      set(true);
    };
    const up = (): void => {
      button.classList.remove('tbtn--down');
      set(false);
    };
    button.addEventListener('pointerdown', down);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, up);
  }

  private padDown(event: PointerEvent): void {
    if (this.padPointer !== null) return;
    event.preventDefault();
    this.padPointer = event.pointerId;
    this.state.touching = true;
    this.zone.setPointerCapture(event.pointerId);
    this.lastUsed = performance.now();
    if (this.fixed) {
      const box = this.pad.getBoundingClientRect();
      this.originX = box.left + box.width / 2;
      this.originY = box.top + box.height / 2;
    } else {
      // Floating: the pad is born under the thumb, kept clear of the screen edges.
      const margin = EDGE_MARGIN_PX + this.radius * 0.5;
      this.originX = Math.min(Math.max(event.clientX, margin), window.innerWidth - margin);
      this.originY = Math.min(Math.max(event.clientY, margin), window.innerHeight - margin);
    }
    this.pad.classList.add('pad--active');
    this.track(event);
  }

  private padMove(event: PointerEvent): void {
    if (event.pointerId !== this.padPointer) return;
    event.preventDefault();
    this.track(event);
  }

  private padUp(event: PointerEvent): void {
    if (event.pointerId !== this.padPointer) return;
    this.padPointer = null;
    this.state.touching = false;
    this.state.x = this.state.y = 0;
    this.knobX = this.knobY = 0;
    this.pad.classList.remove('pad--active');
    this.dirty = true;
  }

  private track(event: PointerEvent): void {
    let dx = event.clientX - this.originX;
    let dy = event.clientY - this.originY;
    let distance = Math.hypot(dx, dy);
    if (!this.fixed && distance > this.radius) {
      // The thumb went past the rim: the pad follows it instead of losing the direction.
      const excess = distance - this.radius;
      this.originX += (dx / distance) * excess;
      this.originY += (dy / distance) * excess;
      dx = event.clientX - this.originX;
      dy = event.clientY - this.originY;
      distance = this.radius;
    }
    let x = dx / this.radius;
    let y = dy / this.radius;
    const magnitude = Math.min(1, distance / this.radius);
    if (distance > this.radius) {
      x = dx / distance;
      y = dy / distance;
    }
    this.knobX = x;
    this.knobY = y;
    if (magnitude < DEAD_ZONE) x = y = 0;
    this.state.x = x;
    this.state.y = y;
    this.lastUsed = performance.now();
    this.dirty = true;
  }
}
