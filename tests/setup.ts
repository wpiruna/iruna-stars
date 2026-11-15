/**
 * The game imports the JSON files that `npm run datos` generates (they are not in git).
 * On a fresh clone the tests create them once, without touching images.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runPipeline } from '../tools/datos/pipeline';

export default async function setup(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  if (!fs.existsSync(path.join(root, 'data', 'equipo.json'))) {
    await runPipeline({ root, images: false });
  }
}
