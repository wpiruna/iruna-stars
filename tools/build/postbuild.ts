/**
 * Last build step: puts the single-file version next to the web version (dist/waterpolo.html)
 * and checks the size budget, so weight creep is caught at build time and not on a phone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(root, 'dist');
const single = path.join(root, 'dist-single', 'index.html');

const BUDGET = {
  /** Compressed JavaScript of the web version. */
  jsGzipKb: 350,
  /** The self-contained HTML, uncompressed. */
  singleHtmlMb: 4,
};

if (!fs.existsSync(single)) {
  console.error('Falta dist-single/index.html: ejecuta antes `npm run build:single`.');
  process.exit(1);
}
fs.copyFileSync(single, path.join(dist, 'waterpolo.html'));
// GitHub Pages must serve the files as they are (no Jekyll processing).
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

const assets = path.join(dist, 'assets');
let jsGzip = 0;
for (const file of fs.existsSync(assets) ? fs.readdirSync(assets) : []) {
  if (file.endsWith('.js')) jsGzip += zlib.gzipSync(fs.readFileSync(path.join(assets, file))).length;
}
const singleBytes = fs.statSync(single).size;
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

console.log(`Versión web: dist/index.html · JavaScript comprimido ${kb(jsGzip)} (límite ${BUDGET.jsGzipKb} KB)`);
console.log(`HTML único:  dist/waterpolo.html · ${mb(singleBytes)} (límite ${BUDGET.singleHtmlMb} MB)`);

const problems: string[] = [];
if (jsGzip / 1024 > BUDGET.jsGzipKb) problems.push(`el JavaScript pesa ${kb(jsGzip)} y el límite es ${BUDGET.jsGzipKb} KB`);
if (singleBytes / 1024 / 1024 > BUDGET.singleHtmlMb) {
  problems.push(`waterpolo.html pesa ${mb(singleBytes)} y el límite es ${BUDGET.singleHtmlMb} MB`);
}
if (problems.length > 0) {
  console.error(`Presupuesto de peso superado: ${problems.join('; ')}.`);
  process.exit(1);
}
