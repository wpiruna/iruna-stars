/**
 * `npm run rivales -- --regenerar <id> [<id>…]` or `-- --todos`.
 * Saved rosters are frozen on purpose; this is the only way to redo them.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../datos/pipeline';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const all = args.includes('--todos');
const ids = args.filter((arg) => !arg.startsWith('--'));

if (!all && ids.length === 0) {
  console.log('Uso: npm run rivales -- --regenerar <id> [<id>…]   |   npm run rivales -- --todos');
  console.log('Sin argumentos no se regenera nada: las plantillas guardadas se mantienen.');
} else {
  const result = await runPipeline({ root, images: false, regenerate: all ? 'todos' : ids });
  console.log(result.report);
}
