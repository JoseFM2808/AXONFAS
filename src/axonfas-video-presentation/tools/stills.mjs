// AXONFAS · exporta varios fotogramas a PNG con un solo bundle (revisión visual rápida).
// Uso (desde el workdir): node tools/stills.mjs 120 600 1350
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const frames = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (!frames.length) {
  console.error('Uso: node tools/stills.mjs <fotograma> [<fotograma> …]');
  process.exit(1);
}
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const composition = await selectComposition({ serveUrl, id: 'AXONFAS' });
console.log(`AXONFAS · ${composition.durationInFrames} fotogramas (${(composition.durationInFrames / composition.fps).toFixed(1)} s)`);
for (const frame of frames) {
  const output = path.resolve('out', `frame-${frame}.png`);
  await renderStill({ composition, serveUrl, frame, output });
  console.log(`  ${output}`);
}
