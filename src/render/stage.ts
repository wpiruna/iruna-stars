/**
 * Owns the PixiJS application and the logical coordinate space.
 * Logical height is always 720; logical width follows the screen (1280 on 16:9, up to ~1680 on
 * tall phones) so nothing is letterboxed. Narrower screens keep 1280 wide and gain height.
 */
import { Application, Container } from 'pixi.js';
import type { QualityManager } from './quality';

export const LOGICAL_HEIGHT = 720;
export const MIN_LOGICAL_WIDTH = 1280;

export interface Viewport {
  /** Logical size available to the game. */
  width: number;
  height: number;
  /** CSS pixels per logical pixel. */
  scale: number;
  /** Backing-store pixels per CSS pixel actually in use. */
  density: number;
}

export function computeViewport(cssWidth: number, cssHeight: number, density: number): Viewport {
  const width = Math.max(1, cssWidth);
  const height = Math.max(1, cssHeight);
  let scale = height / LOGICAL_HEIGHT;
  if (width / scale < MIN_LOGICAL_WIDTH) scale = width / MIN_LOGICAL_WIDTH;
  return { width: width / scale, height: height / scale, scale, density };
}

export class Stage {
  readonly app = new Application();
  /** Everything drawn in logical coordinates goes in here. */
  readonly root = new Container();
  viewport: Viewport = computeViewport(MIN_LOGICAL_WIDTH, LOGICAL_HEIGHT, 1);
  private readonly resizeListeners = new Set<(viewport: Viewport) => void>();

  private constructor(
    private readonly host: HTMLElement,
    private readonly quality: QualityManager,
  ) {}

  static async create(host: HTMLElement, quality: QualityManager): Promise<Stage> {
    const stage = new Stage(host, quality);
    await stage.app.init({
      // WebGL only: it is what every target phone supports, and it keeps the build smaller.
      preference: 'webgl',
      antialias: true,
      autoDensity: true,
      autoStart: false,
      sharedTicker: false,
      backgroundColor: 0x061a3a,
      powerPreference: 'high-performance',
      resolution: stage.density(),
      width: host.clientWidth || window.innerWidth,
      height: host.clientHeight || window.innerHeight,
    });
    host.appendChild(stage.app.canvas);
    stage.app.stage.addChild(stage.root);
    stage.resize();
    window.addEventListener('resize', () => stage.resize());
    window.addEventListener('orientationchange', () => stage.resize());
    window.visualViewport?.addEventListener('resize', () => stage.resize());
    quality.onChange(() => stage.resize());
    return stage;
  }

  private density(): number {
    return Math.min(window.devicePixelRatio || 1, this.quality.profile.maxDensity);
  }

  resize(): void {
    const cssWidth = this.host.clientWidth || window.innerWidth;
    const cssHeight = this.host.clientHeight || window.innerHeight;
    const density = this.density();
    this.app.renderer.resize(cssWidth, cssHeight, density);
    this.viewport = computeViewport(cssWidth, cssHeight, density);
    this.root.scale.set(this.viewport.scale);
    for (const listener of this.resizeListeners) listener(this.viewport);
  }

  onResize(listener: (viewport: Viewport) => void): () => void {
    this.resizeListeners.add(listener);
    listener(this.viewport);
    return () => this.resizeListeners.delete(listener);
  }

  render(): void {
    this.app.renderer.render(this.app.stage);
  }
}
