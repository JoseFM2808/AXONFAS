// Tests del módulo compartido de cámara y MediaPipe (TD-50).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const PC = require(path.join(SRC, 'pose-camera.js'));

/** Un video, un modelo y un requestAnimationFrame de mentira: cada step() es un cuadro de pantalla. */
function rig() {
  const video = { readyState: 4, currentTime: 0, srcObject: 'stream' };
  const calls = [];
  let closed = 0;
  let stopped = 0;
  const landmarker = {
    detectForVideo(v, t) {
      calls.push(t);
      return { landmarks: [[{ x: 0.5 }]], worldLandmarks: [[{ x: 0 }]], close() { closed += 1; } };
    },
  };
  const stream = { getTracks: () => [{ stop() { stopped += 1; } }] };
  let pending = null;
  let clock = 0;
  const run = PC.createRun({
    landmarker, stream, video,
    raf: (fn) => { pending = fn; return 1; }, cancel: () => { pending = null; }, now: () => (clock += 33),
  });
  const step = () => { const fn = pending; pending = null; if (fn) fn(); };
  return { video, run, step, calls, counts: () => ({ closed, stopped }), pending: () => pending };
}

test('un resultado por cada frame nuevo del video, y se libera cada uno', () => {
  const r = rig();
  const seen = [];
  r.run.start((res) => seen.push(res));
  assert.equal(seen.length, 1, 'el primer frame se procesa al empezar');
  assert.ok(seen[0].image && seen[0].world && seen[0].t > 0);
  r.step();
  assert.equal(seen.length, 1, 'mismo frame del video: no se vuelve a detectar');
  r.video.currentTime = 0.033;
  r.step();
  assert.equal(seen.length, 2);
  r.video.readyState = 1;
  r.video.currentTime = 0.066;
  r.step();
  assert.equal(seen.length, 2, 'sin datos del video todavía: espera');
  assert.equal(r.counts().closed, 2);
});

test('stop corta el bucle y apaga la cámara', () => {
  const r = rig();
  r.run.start(() => {});
  assert.equal(r.run.running, true);
  r.run.stop();
  assert.equal(r.run.running, false);
  assert.equal(r.counts().stopped, 1);
  assert.equal(r.video.srcObject, null);
  assert.equal(r.pending(), null);
});

test('sin cámara en el navegador avisa con el texto de cada página', async () => {
  const said = [];
  const run = await PC.open({ video: {}, canvas: {}, viewport: {}, status: (t) => said.push(t), unsupported: 'Ábrelo desde localhost' });
  assert.equal(run, null);
  assert.deepEqual(said, ['Ábrelo desde localhost']);
  assert.equal(PC.cameraError({ name: 'NotAllowedError' }), PC.TEXT.denied);
  assert.equal(PC.cameraError({ name: 'NotFoundError' }), PC.TEXT.notFound);
  // Los avisos siguen el idioma (ADR-030) y siempre dicen que el video no sale del equipo.
  const I = require(path.join(SRC, 'i18n.js'));
  I.use('en');
  assert.equal(PC.cameraError({ name: 'NotFoundError' }), 'No camera was found.');
  assert.match(PC.TEXT.active, /Video never leaves this device/);
  I.use('es');
  assert.match(PC.TEXT.active, /El video no sale de este equipo/);
});

test('la carga de MediaPipe vive en un solo lugar', () => {
  for (const file of ['app.js', 'seguimiento.js']) {
    const src = fs.readFileSync(path.join(SRC, file), 'utf8');
    assert.ok(!src.includes('PoseLandmarker') && !src.includes('getUserMedia'), `${file} repite la carga de la cámara`);
    assert.ok(src.includes('AxonPoseCamera'), `${file} no usa pose-camera.js`);
  }
  for (const page of ['index.html', 'seguimiento.html']) {
    const html = fs.readFileSync(path.join(SRC, page), 'utf8');
    const at = (file) => html.indexOf(`<script src="${file}"></script>`);
    const user = page === 'index.html' ? 'app.js' : 'seguimiento.js';
    assert.ok(at('pose-camera.js') > 0 && at('pose-camera.js') < at(user), `${page} carga pose-camera.js antes de ${user}`);
  }
});
