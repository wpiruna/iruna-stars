/**
 * The water: one full-screen quad with one fragment shader (pool floor, lane lines seen
 * through moving water, and caustics). No filters over containers: on a mid-range phone a
 * single cheap shader is what keeps 60 fps. The shader code is original.
 */
import { Geometry, Mesh, Shader } from 'pixi.js';

const VERTEX = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform float uTime;
uniform vec2 uSize;      // logical pixels covered by the quad
uniform float uCaustics; // 0 = off, 0.5 = simple, 1 = full
uniform float uMetre;    // logical pixels per metre

// Bright, thin, wandering lines: the zero crossings of a few warped sine layers.
float caustics(vec2 p, float t, float detail) {
  float v = 0.0;
  vec2 q = p;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    if (fi > detail) break;
    q += vec2(
      sin(q.y * 1.7 + t * (0.70 + fi * 0.21) + fi * 1.3),
      cos(q.x * 1.5 - t * (0.60 + fi * 0.17) + fi * 2.1)
    ) * 0.55;
    v += sin(q.x * 2.1 + t * 0.5) * cos(q.y * 2.3 - t * 0.4);
  }
  v = abs(v) / (detail + 1.0);
  return pow(1.0 - clamp(v, 0.0, 1.0), 6.0);
}

// Anti-aliased line centred on 0 for a repeating coordinate.
float gridLine(float coord, float width) {
  float d = abs(fract(coord - 0.5) - 0.5);
  return 1.0 - smoothstep(width, width * 2.2, d);
}

void main() {
  vec2 px = vUV * uSize;
  vec2 m = px / uMetre; // metres
  float t = uTime;

  // Refraction: what lies on the floor is seen displaced by the moving surface.
  vec2 wobble = vec2(
    sin(m.y * 1.9 + t * 1.3) + sin(m.x * 0.8 - t * 0.9),
    cos(m.x * 1.7 - t * 1.1) + cos(m.y * 0.9 + t * 0.7)
  ) * 0.035 * (0.4 + uCaustics);
  vec2 f = m + wobble;

  // Floor: deeper blue towards the edges of the screen, 1 m tiles.
  float depth = smoothstep(0.0, 1.0, vUV.y);
  vec3 floorTop = vec3(0.07, 0.52, 0.86);
  vec3 floorBottom = vec3(0.03, 0.36, 0.74);
  vec3 color = mix(floorTop, floorBottom, depth);
  float tiles = max(gridLine(f.x, 0.012), gridLine(f.y, 0.012));
  color = mix(color, color * 0.86, tiles * 0.55);

  // Swimming-lane marks on the floor, every 2.5 m across the pool.
  float lane = gridLine(f.y / 2.5, 0.022);
  color = mix(color, vec3(0.02, 0.16, 0.42), lane * 0.55);

  if (uCaustics > 0.0) {
    float detail = uCaustics >= 1.0 ? 2.0 : 1.0;
    float c = caustics(f * 0.9, t * 0.9, detail);
    color += vec3(0.55, 0.85, 1.0) * c * 0.34;
  }

  // Soft surface sheen moving slowly, so the water never looks frozen even on low quality.
  float sheen = sin(m.x * 0.6 + t * 0.35) * sin(m.y * 0.5 - t * 0.28);
  color += vec3(0.10, 0.16, 0.20) * sheen * 0.22;

  // Vignette to seat the HUD.
  vec2 centred = vUV - 0.5;
  color *= 1.0 - dot(centred, centred) * 0.55;

  finalColor = vec4(color, 1.0);
}
`;

export class Water {
  readonly view: Mesh<Geometry, Shader>;
  private readonly uniforms: { uTime: number; uSize: Float32Array; uCaustics: number; uMetre: number };
  private readonly positions: Float32Array;

  constructor() {
    this.positions = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const geometry = new Geometry({
      attributes: { aPosition: this.positions, aUV: [0, 0, 1, 0, 1, 1, 0, 1] },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    const shader = Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT, name: 'wis-water' },
      resources: {
        water: {
          uTime: { value: 0, type: 'f32' },
          uSize: { value: new Float32Array([1280, 720]), type: 'vec2<f32>' },
          uCaustics: { value: 1, type: 'f32' },
          uMetre: { value: 55, type: 'f32' },
        },
      },
    });
    this.uniforms = shader.resources.water.uniforms;
    this.view = new Mesh({ geometry, shader });
  }

  resize(width: number, height: number): void {
    const p = this.positions;
    p[2] = width;
    p[4] = width;
    p[5] = height;
    p[7] = height;
    this.view.geometry.getBuffer('aPosition').update();
    this.uniforms.uSize[0] = width;
    this.uniforms.uSize[1] = height;
  }

  /** `seconds` is wrapped so the trigonometry keeps its precision in long sessions. */
  update(seconds: number, caustics: number, pixelsPerMetre: number): void {
    this.uniforms.uTime = seconds % 3600;
    this.uniforms.uCaustics = caustics;
    this.uniforms.uMetre = pixelsPerMetre;
  }
}
