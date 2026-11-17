/**
 * Players as seen from above: cap with a big number, shoulders under the water (GDD §16).
 * Everything is drawn with code once and baked into a texture, so a match renders as plain
 * batched sprites instead of re-tessellating vectors every frame.
 */
import { Container, Graphics, Text, type Renderer, type Texture } from 'pixi.js';

export type CapColor = 'white' | 'blue' | 'red';

/** Visual radius of the cap in logical pixels. Drawn larger than the collision body on purpose. */
export const CAP_RADIUS = 30;
export const NUMBER_FONT = 'Anton';

const PALETTE: Record<CapColor, { cap: number; rim: number; digits: number }> = {
  white: { cap: 0xf4f7ff, rim: 0xb9c6e2, digits: 0x12357a },
  blue: { cap: 0x1746b8, rim: 0x0b2a78, digits: 0xffffff },
  red: { cap: 0xd8343a, rim: 0x8f1a22, digits: 0xffffff },
};

const cache = new Map<string, Texture>();

function drawCap(color: CapColor, number: number): Container {
  const palette = PALETTE[color];
  const r = CAP_RADIUS;
  const root = new Container();

  // Shoulders and arms under the surface: darker, bluish, slightly see-through.
  const body = new Graphics()
    .ellipse(0, r * 0.25, r * 1.5, r * 0.92)
    .fill({ color: 0x1b5fae, alpha: 0.55 })
    .ellipse(0, r * 0.2, r * 1.2, r * 0.7)
    .fill({ color: 0xc98f6b, alpha: 0.5 });
  root.addChild(body);

  const head = new Graphics()
    // Ear guards.
    .circle(-r * 0.95, 0, r * 0.3)
    .circle(r * 0.95, 0, r * 0.3)
    .fill({ color: palette.rim })
    .circle(0, 0, r)
    .fill({ color: palette.cap })
    .stroke({ color: palette.rim, width: 3 })
    // Light from above gives the cap some volume without touching the number.
    .ellipse(0, -r * 0.68, r * 0.5, r * 0.16)
    .fill({ color: 0xffffff, alpha: color === 'white' ? 0.9 : 0.25 });
  root.addChild(head);

  const label = new Text({
    text: String(number),
    style: {
      fontFamily: NUMBER_FONT,
      // Solid digits with no outline: maximum contrast against the cap (GDD §16 [FIJO]).
      fontSize: number > 9 ? r * 1.15 : r * 1.32,
      fill: palette.digits,
      align: 'center',
    },
  });
  label.anchor.set(0.5, 0.52);
  root.addChild(label);
  return root;
}

/** Baked texture of a cap. Cached per colour and number. */
export function capTexture(renderer: Renderer, color: CapColor, number: number): Texture {
  const key = `${color}-${number}`;
  let texture = cache.get(key);
  if (!texture) {
    const drawing = drawCap(color, number);
    texture = renderer.generateTexture({ target: drawing, resolution: 2, antialias: true });
    drawing.destroy({ children: true });
    cache.set(key, texture);
  }
  return texture;
}

let ring: Texture | undefined;
/** Baked ripple ring, shared by every ripple sprite. */
let glow: Texture | null = null;

/** A soft round glow, white (tinted where it is used), baked once: the aura of the player you control. */
export function glowTexture(renderer: Renderer): Texture {
  if (!glow) {
    const drawing = new Graphics();
    // Concentric discs, fainter outwards: a cheap radial gradient without filters.
    for (let i = 14; i >= 1; i--) {
      const k = i / 14;
      drawing.circle(0, 0, 64 * k).fill({ color: 0xffffff, alpha: 0.2 * (1.1 - k) });
    }
    glow = renderer.generateTexture({ target: drawing, resolution: 1, antialias: true });
    drawing.destroy();
  }
  return glow;
}

let thickRing: Texture | null = null;

/** A bold ring (tinted where it is used): the edge of the aura. */
export function auraRingTexture(renderer: Renderer): Texture {
  if (!thickRing) {
    const drawing = new Graphics().circle(0, 0, 60).stroke({ color: 0xffffff, width: 11, alpha: 1 });
    thickRing = renderer.generateTexture({ target: drawing, resolution: 1, antialias: true });
    drawing.destroy();
  }
  return thickRing;
}

export function rippleTexture(renderer: Renderer): Texture {
  if (!ring) {
    const drawing = new Graphics().circle(0, 0, 60).stroke({ color: 0xffffff, width: 5, alpha: 0.9 });
    ring = renderer.generateTexture({ target: drawing, resolution: 1, antialias: true });
    drawing.destroy();
  }
  return ring;
}
