/**
 * The virtual controller (GDD §5.1): one pad and two buttons, whatever the hardware. Keyboard,
 * gamepad and touch each fill in a source; the game reads the merged state once per step.
 */
import type { InputDevice } from '../app/platform';

export interface SourceState {
  x: number;
  y: number;
  shot: boolean;
  skill: boolean;
  pause: boolean;
  /** A finger is on the touch pad, even if it rests in the centre (only touch sets it). */
  touching: boolean;
}

export interface ControllerState extends SourceState {
  device: InputDevice;
}

const emptyState = (): SourceState => ({ x: 0, y: 0, shot: false, skill: false, pause: false, touching: false });

// --- Keyboard ------------------------------------------------------------------------------------
const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  skill: ['KeyJ', 'KeyZ'],
  shot: ['KeyK', 'KeyX'],
  pause: ['Escape', 'KeyP'],
} as const;
const GAME_KEYS = new Set<string>(Object.values(KEYS).flat());

export class KeyboardSource {
  readonly state = emptyState();
  private readonly down = new Set<string>();
  /** Milliseconds timestamp of the last key event; used to pick the active device. */
  lastUsed = 0;

  attach(target: Window): void {
    target.addEventListener('keydown', (event) => {
      if (!GAME_KEYS.has(event.code) || event.metaKey || event.ctrlKey || event.altKey) return;
      // Arrow keys must not scroll or move focus while playing.
      if (event.code.startsWith('Arrow')) event.preventDefault();
      this.down.add(event.code);
      this.lastUsed = performance.now();
      this.refresh();
    });
    target.addEventListener('keyup', (event) => {
      this.down.delete(event.code);
      this.refresh();
    });
    // Keys released while the window is not focused never send keyup.
    target.addEventListener('blur', () => {
      this.down.clear();
      this.refresh();
    });
  }

  private pressed(keys: readonly string[]): boolean {
    return keys.some((key) => this.down.has(key));
  }

  private refresh(): void {
    let x = (this.pressed(KEYS.right) ? 1 : 0) - (this.pressed(KEYS.left) ? 1 : 0);
    let y = (this.pressed(KEYS.down) ? 1 : 0) - (this.pressed(KEYS.up) ? 1 : 0);
    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    this.state.x = x;
    this.state.y = y;
    this.state.shot = this.pressed(KEYS.shot);
    this.state.skill = this.pressed(KEYS.skill);
    this.state.pause = this.pressed(KEYS.pause);
  }
}

// --- Gamepad -------------------------------------------------------------------------------------
/** Standard mapping (Xbox / PlayStation): 0 = A/✕, 2 = X/□, 9 = Start, 12–15 = d-pad. */
const PAD = { shot: 0, skill: 2, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;
const STICK_DEAD_ZONE = 0.22;

export class GamepadSource {
  readonly state = emptyState();
  lastUsed = 0;
  connected = false;

  /** Gamepads have no events for buttons: they are polled once per frame. */
  poll(): void {
    const s = this.state;
    s.x = s.y = 0;
    s.shot = s.skill = s.pause = false;
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    this.connected = false;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      this.connected = true;
      const button = (index: number): boolean => pad.buttons[index]?.pressed === true;
      let x = pad.axes[0] ?? 0;
      let y = pad.axes[1] ?? 0;
      const magnitude = Math.hypot(x, y);
      if (magnitude < STICK_DEAD_ZONE) x = y = 0;
      else if (magnitude > 1) {
        x /= magnitude;
        y /= magnitude;
      }
      const dx = (button(PAD.right) ? 1 : 0) - (button(PAD.left) ? 1 : 0);
      const dy = (button(PAD.down) ? 1 : 0) - (button(PAD.up) ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        const norm = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
        x = dx * norm;
        y = dy * norm;
      }
      if (Math.hypot(x, y) > Math.hypot(s.x, s.y)) {
        s.x = x;
        s.y = y;
      }
      s.shot ||= button(PAD.shot);
      s.skill ||= button(PAD.skill);
      s.pause ||= button(PAD.start);
    }
    if (s.x !== 0 || s.y !== 0 || s.shot || s.skill || s.pause) this.lastUsed = performance.now();
  }
}

// --- Merge ---------------------------------------------------------------------------------------
export interface TouchLike {
  readonly state: SourceState;
  lastUsed: number;
}

export class Controller {
  readonly keyboard = new KeyboardSource();
  readonly gamepad = new GamepadSource();
  touch: TouchLike | null = null;
  private readonly merged: ControllerState = { ...emptyState(), device: 'keyboard' };

  attach(target: Window): void {
    this.keyboard.attach(target);
  }

  /** Merged state: the furthest pad wins and buttons add up, so devices can be mixed freely. */
  read(): ControllerState {
    this.gamepad.poll();
    const out = this.merged;
    out.x = out.y = 0;
    out.shot = out.skill = out.pause = false;
    out.touching = this.touch?.state.touching ?? false;
    let newest = -1;
    const sources: [SourceState, number, InputDevice][] = [
      [this.keyboard.state, this.keyboard.lastUsed, 'keyboard'],
      [this.gamepad.state, this.gamepad.lastUsed, 'gamepad'],
    ];
    if (this.touch) sources.push([this.touch.state, this.touch.lastUsed, 'touch']);
    for (const [state, lastUsed, device] of sources) {
      if (Math.hypot(state.x, state.y) > Math.hypot(out.x, out.y)) {
        out.x = state.x;
        out.y = state.y;
      }
      out.shot ||= state.shot;
      out.skill ||= state.skill;
      out.pause ||= state.pause;
      if (lastUsed > newest) {
        newest = lastUsed;
        out.device = device;
      }
    }
    return out;
  }
}
