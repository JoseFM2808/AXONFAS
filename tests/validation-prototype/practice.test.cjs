// Tutorial (shadowing) y rutina sin cámara del seguimiento (TD-109, TD-110, TD-111). Solo datos sintéticos (ADR-010).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'frontend', 'validation-prototype');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const P = require(path.join(SRC, 'practice.js'));

test('conteo manual: series, total y aviso de serie lista', () => {
  const c = P.createCounter({ sets: 2, reps: 3 });
  assert.deepEqual(c.state(), { done: 0, total: 6, sets: 2, perSet: 3, set: 1, inSet: 0, finished: false });
  assert.deepEqual(c.add(), { setDone: false, finished: false });
  c.add();
  assert.deepEqual(c.add(), { setDone: true, finished: false }, 'cierra la serie 1');
  assert.equal(c.state().set, 2);
  assert.equal(c.state().inSet, 0);
  c.add(); c.add();
  assert.deepEqual(c.add(), { setDone: false, finished: true }, 'la última no anuncia descanso');
  assert.deepEqual(c.add(), { setDone: false, finished: true }, 'no pasa del total');
  assert.equal(c.state().done, 6);
  assert.equal(c.state().inSet, 3);
});

test('por lado cuenta el doble y deshacer nunca baja de cero', () => {
  const c = P.createCounter({ sets: 1, reps: 5, perSide: true });
  assert.equal(c.state().total, 10);
  c.undo();
  assert.equal(c.state().done, 0);
  c.add();
  assert.equal(c.undo().done, 0);
});

test('motivo de la sesión sin cámara según lo que pasó con la cámara', () => {
  assert.equal(P.reasonFor('declined'), 'declined');
  assert.equal(P.reasonFor('denied'), 'denied');
  for (const k of ['notFound', 'unsupported', 'model', 'failed', 'otra']) assert.equal(P.reasonFor(k), 'unavailable', k);
  for (const r of ['declined', 'denied', 'unavailable']) assert.ok(P.REASON_TEXT[r], r);
  const api = fs.readFileSync(path.join(ROOT, 'src', 'backend', 'staging_api.py'), 'utf8');
  assert.ok(api.includes(`NO_CAMERA_REASONS = {"declined", "denied", "unavailable", "guided_view"}`), 'los motivos que acepta la API');
});

test('el tutorial se recuerda por ejercicio y sin almacenamiento se vuelve a mostrar', () => {
  const mem = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  assert.equal(P.seen('half-squat', mem), false);
  P.markSeen('half-squat', mem);
  assert.equal(P.seen('half-squat', mem), true);
  assert.equal(P.seen('bridge', mem), false);
  const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.equal(P.seen('half-squat', broken), false);
  assert.doesNotThrow(() => P.markSeen('half-squat', broken));
});

test('el seguimiento ofrece tutorial y rutina sin cámara, y no se bloquea si la cámara falla', () => {
  const html = read('seguimiento.html');
  for (const id of ['practice', 'practice-guide', 'practice-title', 'practice-count', 'btn-tutorial', 'btn-nocam']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(html.indexOf('<script src="practice.js">') < html.indexOf('<script src="seguimiento.js">'));
  const js = read('seguimiento.js');
  assert.ok(js.includes('onFail: (kind) => offerNoCamera(kind)'), 'un permiso negado ofrece seguir sin cámara');
  assert.ok(js.includes("mode: 'guided', source: 'guided', no_camera_reason"), 'se guarda como sesión sin cámara');
  assert.ok(js.includes('!P.seen(st.ex.id)') && js.includes('showTutorial()'), 'el tutorial va antes de la primera captura');
  assert.ok(/onFail\(kind\)|fail\('denied'\)/.test(read('pose-camera.js')), 'pose-camera avisa por qué falló');
  assert.ok(read('hud.css').includes('.practice-actions .practice-done { min-height: 64px;'), 'botón grande para marcar');
});

test('el panel y la nota SOAP dicen lo mismo de una sesión sin cámara', () => {
  const text = 'Sesión completada sin cámara. No se registraron métricas cinemáticas ni detección de fallos posturales.';
  assert.ok(read('doctor.js').includes(`'${text}'`), 'panel del fisioterapeuta');
  assert.ok(fs.readFileSync(path.join(ROOT, 'src', 'agents', 'soap.py'), 'utf8').includes(`"${text}"`), 'nota SOAP');
  assert.ok(read('doctor.html').includes('id="soap-nocam" role="note"'));
  assert.ok(read('doctor.html').includes('id="soap-fhir-doc"'), 'descarga del documento FHIR (TD-103)');
});

test('los textos sin cámara salen del diccionario, en los dos idiomas (ADR-030)', () => {
  const I = require(path.join(SRC, 'i18n.js'));
  for (const r of ['declined', 'denied', 'unavailable']) {
    assert.equal(P.REASON_TEXT[r], I.t(`practice.reason.${r}`), r);
    assert.ok(I.has(`practice.reason.${r}`, 'en'), `${r} en inglés`);
  }
  assert.equal(P.NO_CAMERA_NOTE, I.t('practice.noCameraNote'));
  I.use('en');
  assert.match(I.t('practice.noCameraNote'), /angles are not measured and posture faults are not detected/,
    'el inglés dice lo mismo: sin cámara no hay medición');
  I.use('es');
  const js = read('seguimiento.js');
  assert.ok(js.includes("t('tracking.tutorial.title')") && I.t('tracking.tutorial.title') === 'Mira y sigue');
  I.use('en');
  assert.equal(I.t('tracking.tutorial.title'), 'Watch and follow');
  I.use('es');
});

test('la voz del seguimiento habla en el idioma de la interfaz', () => {
  const js = read('seguimiento.js');
  assert.ok(js.includes('u.lang = I18N.speechLang()') && js.includes('I18N.voiceFor(window.speechSynthesis.getVoices())'));
  assert.ok(!js.includes("'es-PE'") && !/startsWith\('es'\)/.test(js), 'sin voz en español fija');
});
