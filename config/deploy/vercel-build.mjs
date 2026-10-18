// AXONFAS · arma la web estática para Vercel (ADR-020). Lo corre Vercel con `node config/deploy/vercel-build.mjs`
// (buildCommand de vercel.json) y también se puede probar en local. Sin dependencias.
//
//  - Copia src/frontend/validation-prototype (sin el servidor Python, scripts locales ni la copia vieja preview.html)
//    y docs/design-system a .vercel-out/, con la misma estructura de rutas que usa serve.py.
//  - Reescribe config.js con la dirección pública de la API (AXONFAS_API_BASE, la del droplet de AMD con HTTPS).
//    Si no está definida, la web queda en modo "misma dirección" y sin servidor solo funcionan las páginas sin cuenta.
import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(process.argv[2] || join(ROOT, '.vercel-out'));
const WEB = join(ROOT, 'src', 'frontend', 'validation-prototype');
const SKIP = new Set(['serve.py', 'lanzar-prototipo.cmd', 'preview.html', '__pycache__', 'README.md']);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let files = 0;
for (const name of readdirSync(WEB)) {
  if (SKIP.has(name) || name.endsWith('.py')) continue;
  const from = join(WEB, name);
  cpSync(from, join(OUT, name), { recursive: true });
  files += statSync(from).isDirectory() ? 0 : 1;
}
// index.html enlaza ../../../docs/design-system/tokens.css: desde la raíz del sitio eso es /docs/design-system/.
cpSync(join(ROOT, 'docs', 'design-system'), join(OUT, 'docs', 'design-system'), { recursive: true });

const apiBase = (process.env.AXONFAS_API_BASE || '').trim().replace(/\/$/, '');
if (apiBase && !/^https:\/\//.test(apiBase)) {
  console.error(`AXONFAS_API_BASE debe empezar con https:// (recibido: ${apiBase})`);
  process.exit(1);
}
writeFileSync(join(OUT, 'config.js'),
  '/* Generado por config/deploy/vercel-build.mjs (ADR-020): sin secretos, lo lee cualquiera. */\n'
  + `window.AXONFAS_CONFIG = ${JSON.stringify({ apiBase })};\n`);
console.log(`AXONFAS · web lista en ${OUT}: ${files} archivos · API: ${apiBase || 'misma dirección'}`);
