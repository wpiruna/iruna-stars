/**
 * Image pipeline (build time). Portraits get the "arcade" treatment so photos of very different
 * sizes and lighting read as one sticker collection; shields are only fitted and optimized.
 * The format is detected from the file contents, never from the extension.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ImageJob } from '../datos/fusionar';

export const PORTRAIT_RATIO = 3 / 4;
const PORTRAIT_MAX_WIDTH = 384;
const PORTRAIT_MIN_WIDTH = 192;
const SMALL_PORTRAIT_WIDTH = 120;
const SHIELD_SIZE = 256;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

export interface ImageResult {
  written: string[];
  failed: { key: string; source: string; error: string }[];
  notes: { source: string; note: string }[];
}

async function portrait(source: string): Promise<{ data: Buffer; note?: string }> {
  const meta = await sharp(source).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  // Width of the 3:4 crop taken from the source, before any scaling.
  const cropWidth = Math.min(width, Math.round(height * PORTRAIT_RATIO));
  const outWidth = Math.max(PORTRAIT_MIN_WIDTH, Math.min(PORTRAIT_MAX_WIDTH, cropWidth * 2));
  const outHeight = Math.round(outWidth / PORTRAIT_RATIO);

  const prepared = await sharp(source)
    .rotate()
    .resize(outWidth, outHeight, { fit: 'cover', position: 'north', kernel: 'lanczos3' })
    .flatten({ background: '#1b2a4a' })
    .normalise()
    .modulate({ saturation: 1.25 })
    .sharpen({ sigma: 0.8 })
    // A reduced, dithered palette gives the 90s arcade-portrait look and hides low resolution.
    .png({ palette: true, colours: 40, dither: 0.7 })
    .toBuffer();
  const data = await sharp(prepared).webp({ quality: 88 }).toBuffer();
  const note =
    cropWidth < SMALL_PORTRAIT_WIDTH
      ? `foto muy pequeña (${width}×${height} px); se verá poco nítida. Mejor de 300 px de ancho o más`
      : undefined;
  return note ? { data, note } : { data };
}

async function shield(source: string): Promise<{ data: Buffer; note?: string }> {
  const meta = await sharp(source).metadata();
  const data = await sharp(source)
    .rotate()
    .resize(SHIELD_SIZE, SHIELD_SIZE, { fit: 'contain', background: TRANSPARENT })
    .webp({ quality: 92, alphaQuality: 100 })
    .toBuffer();
  return meta.hasAlpha ? { data } : { data, note: 'no tiene fondo transparente; en el juego saldrá sobre un círculo blanco' };
}

async function logo(source: string): Promise<{ data: Buffer }> {
  const data = await sharp(source)
    .rotate()
    .resize(1024, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 92, alphaQuality: 100 })
    .toBuffer();
  return { data };
}

/** Processes every job into outDir/<key>.webp. A broken image is reported, never fatal. */
export async function processImages(jobs: ImageJob[], outDir: string, root: string): Promise<ImageResult> {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const result: ImageResult = { written: [], failed: [], notes: [] };

  for (const job of jobs) {
    const relative = path.relative(root, job.source);
    try {
      const output: { data: Buffer; note?: string } =
        job.kind === 'retrato'
          ? await portrait(job.source)
          : job.kind === 'escudo'
            ? await shield(job.source)
            : await logo(job.source);
      fs.writeFileSync(path.join(outDir, `${job.key}.webp`), output.data);
      result.written.push(job.key);
      if (output.note) result.notes.push({ source: relative, note: output.note });
    } catch (error) {
      result.failed.push({ key: job.key, source: relative, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** App icons for the installable web version, built from the club shield when there is one. */
export async function generateIcons(shieldSource: string | null, outDir: string): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  const background = (size: number): Buffer =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#1668c9"/><stop offset="1" stop-color="#062a66"/>
          </linearGradient>
        </defs>
        <rect width="512" height="512" fill="url(#g)"/>
        <path d="M0 380 Q64 350 128 380 T256 380 T384 380 T512 380 V512 H0 Z" fill="#0b3f93" opacity="0.7"/>
        ${shieldSource ? '' : '<text x="256" y="310" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-style="italic" font-size="220" fill="#ffffff">IS</text>'}
      </svg>`,
    );

  const make = async (file: string, size: number, shieldScale: number): Promise<void> => {
    let image = sharp(background(size)).resize(size, size);
    if (shieldSource) {
      const inner = Math.round(size * shieldScale);
      const badge = Math.round(inner * 1.12);
      const disc = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${badge}" height="${badge}"><circle cx="${badge / 2}" cy="${badge / 2}" r="${badge / 2}" fill="#ffffff"/></svg>`,
      );
      const emblem = await sharp(shieldSource)
        .rotate()
        .resize(Math.round(inner * 0.86), Math.round(inner * 0.86), { fit: 'contain', background: TRANSPARENT })
        .png()
        .toBuffer();
      image = sharp(await image.png().toBuffer()).composite([
        { input: disc, gravity: 'centre' },
        { input: emblem, gravity: 'centre' },
      ]);
    }
    await image.png().toFile(path.join(outDir, file));
  };

  await make('icon-192.png', 192, 0.74);
  await make('icon-512.png', 512, 0.74);
  await make('maskable-512.png', 512, 0.56);
  await make('apple-touch-icon.png', 180, 0.74);
}
