/** Finds the user's images in assets/ by convention, never trusting file names typed in the sheet. */
import fs from 'node:fs';
import path from 'node:path';
import { compareNames, slugify } from '../datos/texto';

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;
export type ImageFolder = 'jugadores' | 'escudos' | 'arbitros' | 'emilio' | 'logo';

function isImage(name: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(path.extname(name).toLowerCase());
}

function baseName(name: string): string {
  return path.basename(name, path.extname(name));
}

/** Dorsal a player photo belongs to: the leading number of its name ("01-Larry", "7 gol"). */
export function dorsalOfFile(name: string): number | null {
  const match = /^0*(\d{1,2})(?!\d)/.exec(baseName(name));
  if (!match || match[1] === undefined) return null;
  const dorsal = Number(match[1]);
  return dorsal >= 1 && dorsal <= 99 ? dorsal : null;
}

export class ImageIndex {
  private readonly folders = new Map<ImageFolder, string[]>();

  constructor(private readonly assetsDir: string) {
    for (const folder of ['jugadores', 'escudos', 'arbitros', 'emilio', 'logo'] as const) {
      const dir = path.join(assetsDir, folder);
      const files = fs.existsSync(dir)
        ? fs
            .readdirSync(dir)
            .filter((name) => isImage(name) && fs.statSync(path.join(dir, name)).isFile())
            .sort((a, b) => compareNames(baseName(a), baseName(b)) || compareNames(a, b))
        : [];
      this.folders.set(folder, files);
    }
  }

  /** File names (not paths) in a folder, sorted by name without extension. */
  list(folder: ImageFolder): string[] {
    return this.folders.get(folder) ?? [];
  }

  pathOf(folder: ImageFolder, name: string): string {
    return path.join(this.assetsDir, folder, name);
  }

  /** Photos of each dorsal, main one first. */
  playerPhotos(): Map<number, string[]> {
    const out = new Map<number, string[]>();
    for (const name of this.list('jugadores')) {
      const dorsal = dorsalOfFile(name);
      if (dorsal === null) continue;
      const list = out.get(dorsal) ?? [];
      list.push(name);
      out.set(dorsal, list);
    }
    return out;
  }

  /** Image whose name (without extension, slugified) equals the given ID or file name. */
  find(folder: ImageFolder, idOrFile: string): string | null {
    const wanted = slugify(baseName(idOrFile));
    if (wanted === '') return null;
    return this.list(folder).find((name) => slugify(baseName(name)) === wanted) ?? null;
  }
}
