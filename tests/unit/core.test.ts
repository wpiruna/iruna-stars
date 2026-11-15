import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/events';
import { FixedLoop, STEP_MS } from '../../src/core/loop';
import { barFactor } from '../../src/core/math';

describe('bucle de paso fijo', () => {
  it('avanza en pasos de 1/60 s sea cual sea el ritmo de pantalla', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++);
    // One second of real time fed at an uneven frame rate (144 Hz, then 30 Hz).
    let fed = 0;
    while (fed < 500) fed += (loop.advance(1000 / 144), 1000 / 144);
    while (fed < 1000) fed += (loop.advance(1000 / 30), 1000 / 30);
    expect(Math.abs(steps - Math.round(fed / STEP_MS))).toBeLessThanOrEqual(1);
    expect(loop.ticks).toBe(steps);
  });

  it('devuelve alpha entre 0 y 1 para interpolar el render', () => {
    const loop = new FixedLoop(() => {});
    const alpha = loop.advance(STEP_MS * 1.5);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  it('tras un parón largo no intenta recuperar todo el tiempo', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++);
    const alpha = loop.advance(10_000);
    expect(steps).toBe(5);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
  });
});

describe('bus de eventos y curvas', () => {
  it('entrega los eventos a quien se suscribe y permite darse de baja', () => {
    const bus = new EventBus<{ gol: { dorsal: number } }>();
    const seen: number[] = [];
    const off = bus.on('gol', (e) => seen.push(e.dorsal));
    bus.emit('gol', { dorsal: 7 });
    off();
    bus.emit('gol', { dorsal: 9 });
    expect(seen).toEqual([7]);
  });

  it('las barras 1-10 dan un factor suave y creciente entre 0 y 1', () => {
    expect(barFactor(1)).toBe(0);
    expect(barFactor(10)).toBe(1);
    for (let bar = 1; bar < 10; bar++) expect(barFactor(bar + 1)).toBeGreaterThan(barFactor(bar));
    expect(barFactor(9) - barFactor(5)).toBeGreaterThan(0.35);
  });
});
