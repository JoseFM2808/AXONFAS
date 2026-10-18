// Tests del paso "preparar la cámara" (ADR-015).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const CS = require(path.join(SRC, 'camera-setup.js'));
const T = require(path.join(SRC, 'tracker.js'));
const C = require(path.join(SRC, 'catalog.js'));
const I = require(path.join(SRC, 'i18n.js'));

/** Puntos 2D normalizados de una persona de pie vista con un ángulo `yaw` (0 = de frente, 90 = de lado). */
function image(yaw, { scale = 0.8 / 1.75, aspect = 16 / 9, vis = 0.95, feetVis = 0.95 } = {}) {
  const c = Math.cos((yaw * Math.PI) / 180);
  const pts = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const put = (i, X, H, v = vis) => { pts[i] = { x: 0.5 + (X * c * scale) / aspect, y: 0.92 - H * scale, visibility: v }; };
  put(0, 0, 1.62); put(7, 0.07, 1.6); put(8, -0.07, 1.6);
  put(11, 0.19, 1.42); put(12, -0.19, 1.42); put(13, 0.22, 1.15); put(14, -0.22, 1.15); put(15, 0.23, 0.9); put(16, -0.23, 0.9);
  put(23, 0.1, 0.92); put(24, -0.1, 0.92); put(25, 0.1, 0.48); put(26, -0.1, 0.48);
  put(27, 0.1, 0.08, feetVis); put(28, -0.1, 0.08, feetVis);
  [29, 30, 31, 32].forEach((i, k) => put(i, k % 2 ? -0.1 : 0.1, 0.03, feetVis));
  return pts;
}

test('recomienda la posición que mejor ve cada ejercicio', () => {
  assert.equal(CS.recommend(CS.ENGINE.measures), 'diagonal', 'sentarse y pararse con alertas: rodilla, tronco y valgo');
  const rec = (id) => CS.recommend(CS.measuresFor(id, 'track', T).measures);
  assert.equal(rec('hip-abduction'), 'front', 'abducción: movimiento hacia el costado');
  assert.equal(rec('straight-leg-raise'), 'side', 'elevación de pierna: hacia adelante');
  assert.equal(rec('neck-side-flexion'), 'front');
  for (const e of C.EXERCISES) assert.ok(CS.VIEWS[rec(e.id)], `${e.id}: sin recomendación`);
});

test('desde una vista, lo poco confiable no se evalúa', () => {
  assert.deepEqual(CS.disabledFor('side'), { valgus: true }, 'de lado no se ve el valgo');
  assert.deepEqual(CS.disabledFor('front'), {}, 'de frente, flexión y tronco quedan regulares: siguen alertando');
  assert.deepEqual(CS.qualityOf(CS.ENGINE.measures, 'front').map((x) => x.level), ['fair', 'fair', 'good', 'fair']);
  assert.deepEqual(CS.disabledFor('diagonal'), {});
  const q = CS.qualityOf(CS.ENGINE.measures, 'diagonal');
  assert.deepEqual(q.map((x) => x.level), ['good', 'good', 'fair', 'good']);
});

test('detecta el ángulo real de la cámara', () => {
  assert.equal(CS.detectView(image(0)).view, 'front');
  assert.equal(CS.detectView(image(45)).view, 'diagonal');
  assert.equal(CS.detectView(image(85)).view, 'side');
  assert.equal(CS.detectView(null), null);
});

test('revisa el encuadre: todo a la vista y a buena distancia', () => {
  const need = CS.ENGINE.need;
  assert.equal(CS.checkFrame(image(45), need).ok, true);
  I.use('es');
  const noFeet = CS.checkFrame(image(45, { feetVis: 0.2 }), need);
  assert.equal(noFeet.ok, false);
  assert.equal(I.t('camera.part.feet'), 'los pies');
  assert.ok(noFeet.missing.includes(I.t('camera.part.feet')));
  const far = CS.checkFrame(image(45, { scale: 0.25 / 1.75 }), need);
  assert.equal(far.distance, 'far');
  const cut = image(45);
  cut[27] = { ...cut[27], y: 0.995 };                     // un pie fuera de la imagen
  assert.ok(CS.checkFrame(cut, need).missing.includes(I.t('camera.part.feet')));
  // En inglés dice lo mismo, con los textos del diccionario (ADR-030).
  I.use('en');
  assert.deepEqual(CS.checkFrame(image(45, { feetVis: 0.2 }), need).missing, ['your feet']);
  I.use('es');
});

test('los textos de la cámara salen del diccionario en los dos idiomas (ADR-030)', () => {
  for (const l of ['es', 'en']) {
    I.use(l);
    for (const v of CS.ORDER) for (const f of ['label', 'short', 'how']) {
      assert.equal(CS.VIEWS[v][f], I.t(`camera.view.${v}.${f}`), `${l} ${v}.${f}`);
    }
    for (const p of CS.PARTS) assert.ok(I.has(`camera.part.${p.key}`, l), `${l}: falta la parte ${p.key}`);
    for (const m of CS.ENGINE.measures) assert.equal(m.label, I.t(`camera.measure.${m.key}`), `${l} ${m.key}`);
    for (const q of CS.qualityOf(CS.ENGINE.measures, 'side')) assert.equal(q.text, I.t(`camera.level.${q.level}`));
  }
  I.use('en');
  assert.equal(CS.summary('side', CS.ENGINE.measures), 'camera from the side (valgus unreliable)');
  I.use('es');
  const js = require('node:fs').readFileSync(path.join(SRC, 'camera-setup.js'), 'utf8');
  assert.ok(!/\.innerHTML\s*\+?=|insertAdjacentHTML/.test(js),'tarjetas y chequeo con DOM, sin innerHTML');
  // METRICS de cada medida conservan su plano y lo que necesitan ver (ADR-015): measuresFor no cambia de forma.
  const m = CS.measuresFor('hip-abduction', 'track', T).measures[0];
  assert.ok(m.key && m.plane && typeof m.label === 'string' && m.label.length > 0);
});

test('el chequeo en vivo queda listo solo si se mantiene bien un momento', () => {
  const chk = CS.createCheck({ measures: CS.ENGINE.measures, need: CS.ENGINE.need, chosen: 'diagonal', stableMs: 1000 });
  let r = chk.update(image(45), 0, 16 / 9);
  assert.equal(r.ready, false);
  assert.equal(r.matches, true);
  r = chk.update(image(45, { feetVis: 0.1 }), 600, 16 / 9);       // se cortan los pies: vuelve a empezar
  assert.equal(r.progress, 0);
  chk.update(image(45), 700, 16 / 9);
  r = chk.update(image(45), 1750, 16 / 9);
  assert.equal(r.ready, true);
  assert.deepEqual(r.quality.map((q) => q.level), ['good', 'good', 'fair', 'good']);
  const side = chk.update(image(85), 1800, 16 / 9);
  assert.equal(side.matches, false, 'avisa si la cámara no está donde se eligió');
  assert.equal(CS.summary('side', CS.ENGINE.measures), 'cámara de lado (valgo poco confiable)');
});
