import { describe, expect, it } from 'vitest';
import { PadGestures, quantize8, type PadGesture } from '../../src/input/gestures';

const STEP = 1000 / 60;

/** Feeds a sequence of [x, y, steps] to a recogniser and collects what it reports. */
function play(gestures: PadGestures, sequence: [number, number, number][]): PadGesture[] {
  const out: PadGesture[] = [];
  for (const [x, y, steps] of sequence) for (let i = 0; i < steps; i++) gestures.update(x, y, STEP, out);
  return out;
}
const kinds = (events: PadGesture[]): string[] => events.filter((e) => e.type !== 'hold').map((e) => e.type);

describe('ocho direcciones', () => {
  it('reparte el círculo en ocho sectores, con arriba = −y de pantalla', () => {
    expect(quantize8(1, 0)).toBe(0);
    expect(quantize8(1, 1)).toBe(1);
    expect(quantize8(0, 1)).toBe(2);
    expect(quantize8(-1, 0)).toBe(4);
    expect(quantize8(0, -1)).toBe(6);
    expect(quantize8(1, -1)).toBe(7);
  });

  it('con histéresis no baila entre dos direcciones vecinas', () => {
    // 25° is just past the 22.5° border between "right" and "down-right".
    const x = Math.cos((25 * Math.PI) / 180);
    const y = Math.sin((25 * Math.PI) / 180);
    expect(quantize8(x, y)).toBe(1);
    expect(quantize8(x, y, 0)).toBe(0);
    expect(quantize8(Math.cos(0.7), Math.sin(0.7), 0)).toBe(1);
  });
});

describe('toque o mantener', () => {
  const make = (tapMs = 180): PadGestures => new PadGestures(tapMs, 0.18);

  it('una pulsación corta es un toque en esa dirección', () => {
    const events = play(make(), [[1, 0, 6], [0, 0, 1]]);
    expect(events).toEqual([{ type: 'tap', dir: 0, x: 1, y: 0 }]);
  });

  it('una pulsación larga es mantener: empieza, sigue cada paso y termina', () => {
    const events = play(make(), [[0, -1, 20], [0, 0, 1]]);
    expect(kinds(events)).toEqual(['holdStart', 'holdEnd']);
    expect(events.filter((e) => e.type === 'hold').length).toBeGreaterThan(5);
    expect(events[0]).toMatchObject({ type: 'holdStart', dir: 6 });
    // No tap is ever produced by a hold.
    expect(events.some((e) => e.type === 'tap')).toBe(false);
  });

  it('el umbral es configurable por dispositivo', () => {
    const tenSteps: [number, number, number][] = [[1, 0, 12], [0, 0, 1]];
    expect(kinds(play(make(180), tenSteps))).toEqual(['holdStart', 'holdEnd']);
    expect(kinds(play(make(220), tenSteps))).toEqual(['tap']);
  });

  it('por debajo de la zona muerta no pasa nada', () => {
    expect(play(make(), [[0.1, 0.1, 30], [0, 0, 2]])).toEqual([]);
  });

  it('en una pasada táctil cuenta el punto de máximo recorrido, no el de la suelta', () => {
    // The thumb shoots up-right, then curls back towards the centre before lifting.
    const events = play(make(220), [[0.5, -0.5, 2], [0.7, -0.7, 2], [0.3, -0.05, 2], [0, 0, 1]]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tap', dir: 7 });
  });

  it('dos teclas pulsadas casi a la vez son una diagonal', () => {
    // First step only "right", the next ones "right + down" (keyboard diagonal, same magnitude).
    const events = play(make(), [[1, 0, 2], [Math.SQRT1_2, Math.SQRT1_2, 4], [0, 0, 1]]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tap', dir: 1 });
  });

  it('cancelar descarta el gesto en curso sin emitir nada', () => {
    const gestures = make();
    const out = play(gestures, [[1, 0, 20]]);
    expect(gestures.isHolding).toBe(true);
    gestures.cancel();
    const after = play(gestures, [[0, 0, 2]]);
    expect(kinds(out)).toEqual(['holdStart']);
    expect(after).toEqual([]);
  });

  it('cada gesto es independiente del anterior', () => {
    const events = play(make(), [[1, 0, 4], [0, 0, 2], [0, 1, 4], [0, 0, 2]]);
    expect(events.map((e) => (e.type === 'tap' ? e.dir : -1))).toEqual([0, 2]);
  });
});
