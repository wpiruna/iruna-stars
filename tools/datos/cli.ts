/** Entry point of `npm run datos`. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from './pipeline';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);

const result = await runPipeline({ root, images: !args.includes('--sin-imagenes') });
console.log(result.report);
console.log('Datos generados en data/. Informe: data/INFORME_DATOS.md');
