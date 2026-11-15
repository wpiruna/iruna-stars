/**
 * Image catalog. Optimized images live in data/generado/img (built by `npm run datos`) and are
 * addressed by key ("jugador-07-a", "escudo-sestao"). When a key is missing, a placeholder is
 * drawn with code in the game's style: the game never shows a broken image (GDD §18.2).
 */
import { hashString } from '../core/rng';

const modules = import.meta.glob<string>('../../data/generado/img/*.webp', { eager: true, query: '?url', import: 'default' });

const catalog = new Map<string, string>();
for (const [file, url] of Object.entries(modules)) {
  const key = file.slice(file.lastIndexOf('/') + 1).replace(/\.webp$/, '');
  catalog.set(key, url);
}

/** URL of a catalog image, or undefined when the user has not provided it. */
export function imageUrl(key: string | undefined): string | undefined {
  return key === undefined ? undefined : catalog.get(key);
}

function svgUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

/** Two matching colours derived from an ID, so every provisional team has its own look. */
export function colorsOf(id: string): { main: string; dark: string; accent: string } {
  const hash = hashString(id);
  const hue = hash % 360;
  const accentHue = (hue + 150 + ((hash >>> 9) % 60)) % 360;
  return {
    main: `hsl(${hue} 68% 46%)`,
    dark: `hsl(${hue} 72% 24%)`,
    accent: `hsl(${accentHue} 85% 62%)`,
  };
}

/** An SVG used as an image cannot see the page's web fonts: only heavy system fonts here. */
const SVG_FONT = "Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif";

const SILHOUETTE = `
  <ellipse cx="150" cy="430" rx="150" ry="150" />
  <circle cx="150" cy="170" r="78" />
  <rect x="118" y="230" width="64" height="70" rx="20" />`;

/** Player sticker placeholder: swimmer silhouette in a cap, with the dorsal. 3:4. */
export function playerPlaceholder(number: number, keeper: boolean): string {
  const cap = keeper ? '#d8343a' : '#f2f6ff';
  const digits = keeper ? '#ffffff' : '#12357a';
  return svgUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2f86d8"/><stop offset="1" stop-color="#0a2f73"/>
        </linearGradient>
        <pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="2" fill="#ffffff" opacity="0.10"/>
        </pattern>
      </defs>
      <rect width="300" height="400" fill="url(#bg)"/>
      <rect width="300" height="400" fill="url(#dots)"/>
      <g fill="#061a3a" opacity="0.78">${SILHOUETTE}</g>
      <path d="M72 170 a78 78 0 0 1 156 0 q-78 -34 -156 0 Z" fill="${cap}"/>
      <text x="150" y="152" text-anchor="middle" font-family="${SVG_FONT}" font-weight="900" font-size="60" fill="${digits}">${number}</text>
      <path d="M0 330 Q38 312 75 330 T150 330 T225 330 T300 330 V400 H0 Z" fill="#7fd3ff" opacity="0.55"/>
    </svg>`);
}

/** Person placeholder (referee, president): plain silhouette. 3:4. */
export function personPlaceholder(kind: 'referee' | 'president'): string {
  const tint = kind === 'referee' ? '#3a3f4b' : '#5a3a1e';
  const detail =
    kind === 'referee'
      ? '<rect x="60" y="330" width="180" height="70" fill="#f4f4f4" opacity="0.9"/><circle cx="190" cy="318" r="12" fill="#f4c21b"/>'
      : '<path d="M125 300 L150 400 L175 300 Z" fill="#c2182b"/>';
  return svgUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8a97ad"/><stop offset="1" stop-color="#3b465c"/>
        </linearGradient>
      </defs>
      <rect width="300" height="400" fill="url(#bg)"/>
      <g fill="${tint}">${SILHOUETTE}</g>
      ${detail}
    </svg>`);
}

/** Shield placeholder with the team's 3 letters and colours derived from its ID. 1:1. */
export function shieldPlaceholder(id: string, code: string): string {
  const { main, dark, accent } = colorsOf(id);
  return svgUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <path d="M128 12 L232 44 V132 C232 192 186 232 128 248 C70 232 24 192 24 132 V44 Z" fill="${dark}"/>
      <path d="M128 28 L216 55 V132 C216 182 178 216 128 231 C78 216 40 182 40 132 V55 Z" fill="${main}"/>
      <path d="M40 150 Q84 126 128 150 T216 150 V132 C216 182 178 216 128 231 C78 216 40 182 40 150 Z" fill="${dark}" opacity="0.55"/>
      <path d="M52 96 H204" stroke="${accent}" stroke-width="10" stroke-linecap="round"/>
      <text x="128" y="176" text-anchor="middle" font-family="${SVG_FONT}" font-weight="900" font-size="78" textLength="150" lengthAdjust="spacingAndGlyphs" fill="#ffffff" stroke="${dark}" stroke-width="6" paint-order="stroke">${escapeXml(code.slice(0, 3).toUpperCase())}</text>
    </svg>`);
}
