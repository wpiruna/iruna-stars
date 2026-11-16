/**
 * The pool around the water: deck, lane ropes with their colour zones, distance lines and the
 * two goals with their nets (GDD §16). Drawn once in world metres inside containers that follow
 * the camera; only a net that is being hit gets redrawn.
 */
import { Container, Graphics } from 'pixi.js';
import type { Field, Goal } from '../sim/field';
import { HEIGHT_LIFT, PERSPECTIVE, TILT, type Camera } from './camera';

/** Water between each goal line and the wall behind it, and between the ropes and the side walls. */
export const BEHIND_GOAL = 2.2;
const SIDE_MARGIN = 0.7;
const NET_DEPTH = 0.85;

const COLORS = {
  deck: 0xd9d2c0,
  deckLine: 0xbfb6a0,
  coping: 0xf3efe4,
  wall: 0x0a4f9c,
  white: 0xffffff,
  red: 0xe23b46,
  yellow: 0xffd23f,
  green: 0x3fbf6a,
  net: 0xffffff,
  frame: 0xffffff,
  frameShade: 0xb8c4d6,
};

export class PoolView {
  /** Below the players: deck, ropes, lines, nets. */
  readonly floor = new Container();
  /** Above the players: goal frames (posts and bar are higher than a head). */
  readonly front = new Container();
  private readonly nets = new Map<Goal, { graphics: Graphics; u: number; v: number; amount: number }>();

  constructor(private readonly field: Field) {
    this.floor.addChild(this.drawStatic());
    for (const goal of [field.goalLeft, field.goalRight]) {
      const graphics = new Graphics();
      this.nets.set(goal, { graphics, u: 0, v: 0, amount: 0 });
      this.floor.addChild(graphics);
      this.drawNet(goal);
      this.front.addChild(this.drawFrame(goal));
    }
  }

  /** World point with height → the flat coordinates used inside the camera-following containers. */
  private flat(x: number, y: number, z: number): [number, number] {
    return [x + (x - this.field.length / 2) * PERSPECTIVE * z, y - (z * HEIGHT_LIFT) / TILT];
  }

  private drawStatic(): Graphics {
    const { length, width, twoMetres, fiveMetres, sixMetres } = this.field;
    const g = new Graphics();
    const x0 = -BEHIND_GOAL;
    const x1 = length + BEHIND_GOAL;
    const y0 = -SIDE_MARGIN;
    const y1 = width + SIDE_MARGIN;
    const far = 40;

    // Deck around the pool, with a pale coping stone on the edge.
    g.rect(x0 - far, y0 - far, x1 - x0 + far * 2, far).fill(COLORS.deck);
    g.rect(x0 - far, y1, x1 - x0 + far * 2, far).fill(COLORS.deck);
    g.rect(x0 - far, y0, far, y1 - y0).fill(COLORS.deck);
    g.rect(x1, y0, far, y1 - y0).fill(COLORS.deck);
    for (let i = 1; i <= 8; i++) {
      g.rect(x0 - i * 1.2, y0 - far, 0.04, y1 - y0 + far * 2).fill({ color: COLORS.deckLine, alpha: 0.6 });
      g.rect(x1 + i * 1.2, y0 - far, 0.04, y1 - y0 + far * 2).fill({ color: COLORS.deckLine, alpha: 0.6 });
    }
    g.rect(x0 - 0.35, y0 - 0.35, x1 - x0 + 0.7, 0.35).fill(COLORS.coping);
    g.rect(x0 - 0.35, y1, x1 - x0 + 0.7, 0.35).fill(COLORS.coping);
    g.rect(x0 - 0.35, y0, 0.35, y1 - y0).fill(COLORS.coping);
    g.rect(x1, y0, 0.35, y1 - y0).fill(COLORS.coping);
    // Shade of the wall under the water line.
    g.rect(x0, y0, x1 - x0, 0.22).fill({ color: COLORS.wall, alpha: 0.5 });
    g.rect(x0, y0, 0.22, y1 - y0).fill({ color: COLORS.wall, alpha: 0.5 });

    // Distance lines across the water: faint, they must never fight with the players.
    const line = (x: number, color: number, alpha: number, thickness = 0.07): void => {
      g.rect(x - thickness / 2, 0, thickness, width).fill({ color, alpha });
    };
    line(length / 2, COLORS.white, 0.3);
    for (const goalX of [0, length]) {
      const dir = goalX === 0 ? 1 : -1;
      line(goalX, COLORS.white, 0.45);
      line(goalX + dir * twoMetres, COLORS.red, 0.4);
      line(goalX + dir * sixMetres, COLORS.yellow, 0.4);
      // Penalty mark on the 5 m line.
      g.circle(goalX + dir * fiveMetres, width / 2, 0.14).fill({ color: COLORS.red, alpha: 0.55 });
    }

    // Lane ropes along both sides, coloured by zone like in a real pool.
    const zoneColor = (x: number): number => {
      const fromGoal = Math.min(x, length - x);
      if (fromGoal < 0.3 || Math.abs(x - length / 2) < 0.3) return COLORS.white;
      if (fromGoal < twoMetres) return COLORS.red;
      if (fromGoal < sixMetres) return COLORS.yellow;
      return COLORS.green;
    };
    for (const y of [0, width]) {
      g.rect(0, y - 0.03, length, 0.06).fill({ color: 0x0b2a5c, alpha: 0.5 });
      for (let x = 0.125; x < length; x += 0.5) {
        g.roundRect(x - 0.19, y - 0.13, 0.38, 0.26, 0.1).fill(zoneColor(x));
        g.roundRect(x - 0.19, y - 0.13, 0.38, 0.09, 0.05).fill({ color: 0xffffff, alpha: 0.35 });
      }
    }
    return g;
  }

  /** Posts and crossbar. Static: the frame never moves. */
  private drawFrame(goal: Goal): Graphics {
    const g = new Graphics();
    const { x, y, halfWidth, height } = goal;
    const post = (side: 1 | -1): void => {
      const [bx, by] = this.flat(x, y + side * halfWidth, 0);
      const [tx, ty] = this.flat(x, y + side * halfWidth, height);
      g.moveTo(bx, by).lineTo(tx, ty).stroke({ color: COLORS.frameShade, width: 0.2, cap: 'round' });
      g.moveTo(bx, by).lineTo(tx, ty).stroke({ color: COLORS.frame, width: 0.13, cap: 'round' });
    };
    post(-1);
    post(1);
    const [ax, ay] = this.flat(x, y - halfWidth, height);
    const [bx, by] = this.flat(x, y + halfWidth, height);
    g.moveTo(ax, ay).lineTo(bx, by).stroke({ color: COLORS.frameShade, width: 0.2, cap: 'round' });
    g.moveTo(ax, ay).lineTo(bx, by).stroke({ color: COLORS.frame, width: 0.13, cap: 'round' });
    return g;
  }

  /** Net as a mesh of lines over the top, the back and the sides; bulges where the ball hits. */
  private drawNet(goal: Goal): void {
    const net = this.nets.get(goal);
    if (!net) return;
    const g = net.graphics;
    g.clear();
    const { x, y, halfWidth, height } = goal;
    const back = goal.facing; // the net hangs behind the line, away from the field
    const backX = x + back * NET_DEPTH;
    const backTop = height * 0.6;

    const point = (px: number, py: number, pz: number): [number, number] => {
      // The ball pushes the netting out around the point of impact.
      const du = py - (y + net.u);
      const dv = pz - net.v;
      const push = net.amount * Math.exp(-(du * du + dv * dv) / 0.5) * Math.min(1, Math.abs(px - x) / NET_DEPTH);
      return this.flat(px + back * push, py, pz);
    };
    type P3 = [number, number, number];
    const panel = (a: P3, b: P3, c: P3, d: P3, nu: number, nv: number): void => {
      const at = (s: number, t: number): [number, number] => {
        const mix = (i: 0 | 1 | 2): number => (a[i] * (1 - s) + b[i] * s) * (1 - t) + (d[i] * (1 - s) + c[i] * s) * t;
        return point(mix(0), mix(1), mix(2));
      };
      for (let i = 0; i <= nu; i++) {
        for (let j = 0; j <= nv; j++) {
          const [px, py] = at(i / nu, j / nv);
          if (j === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
      }
      for (let j = 0; j <= nv; j++) {
        for (let i = 0; i <= nu; i++) {
          const [px, py] = at(i / nu, j / nv);
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
      }
    };
    const y0 = y - halfWidth;
    const y1 = y + halfWidth;
    // Shadow of the goal on the water.
    g.rect(Math.min(x, backX), y0, NET_DEPTH, halfWidth * 2).fill({ color: 0x04112a, alpha: 0.22 });
    panel([x, y0, 0], [x, y0, height], [backX, y0, backTop], [backX, y0, 0], 3, 3);
    panel([x, y1, 0], [x, y1, height], [backX, y1, backTop], [backX, y1, 0], 3, 3);
    panel([backX, y0, 0], [backX, y1, 0], [backX, y1, backTop], [backX, y0, backTop], 10, 3);
    panel([x, y0, height], [x, y1, height], [backX, y1, backTop], [backX, y0, backTop], 10, 3);
    g.stroke({ color: COLORS.net, width: 0.025, alpha: 0.6 });
  }

  /** The ball hits the net of this goal at goal-plane coordinates (u, v). */
  hitNet(goal: Goal, u: number, v: number, strength: number): void {
    const net = this.nets.get(goal);
    if (!net) return;
    net.u = u;
    net.v = v;
    net.amount = Math.min(0.7, 0.25 + strength * 0.5);
    this.drawNet(goal);
  }

  update(dt: number): void {
    for (const [goal, net] of this.nets) {
      if (net.amount <= 0) continue;
      net.amount = net.amount < 0.01 ? 0 : net.amount * Math.exp(-dt * 5);
      this.drawNet(goal);
    }
  }

  /** Follows the camera. */
  sync(camera: Camera): void {
    for (const layer of [this.floor, this.front]) {
      layer.position.set(camera.offsetX, camera.offsetY);
      layer.scale.set(camera.scale, camera.scale * TILT);
    }
  }
}
