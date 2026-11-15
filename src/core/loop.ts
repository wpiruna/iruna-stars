/**
 * Fixed-timestep loop (GDD §2): the simulation always advances in 1/60 s steps, whatever the
 * display rate, and the renderer interpolates with `alpha` between the last two states.
 */
export const STEP_HZ = 60;
export const STEP_MS = 1000 / STEP_HZ;
/** After a long stall (tab in background) we drop time instead of fast-forwarding. */
const MAX_STEPS_PER_FRAME = 5;

export class FixedLoop {
  private accumulator = 0;
  /** Total simulation steps run so far. */
  ticks = 0;

  constructor(private readonly step: (tick: number) => void) {}

  /** Feeds real elapsed time. Returns alpha in [0, 1): how far we are into the next step. */
  advance(elapsedMs: number): number {
    this.accumulator += Math.max(0, elapsedMs);
    let steps = 0;
    while (this.accumulator >= STEP_MS) {
      if (steps === MAX_STEPS_PER_FRAME) {
        this.accumulator %= STEP_MS;
        break;
      }
      this.step(this.ticks);
      this.ticks++;
      steps++;
      this.accumulator -= STEP_MS;
    }
    return this.accumulator / STEP_MS;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
