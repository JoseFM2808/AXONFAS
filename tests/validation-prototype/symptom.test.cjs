// Formulario de molestia del paciente y ajuste en caliente del motor (ADR-021). Solo datos sintéticos (ADR-010).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const Sym = require(path.join(SRC, 'symptom-form.js'));
const E = require(path.join(SRC, 'engine.js'));
const S = require(path.join(SRC, 'synthetic.js'));

test('el formulario ofrece las 5 opciones que la API conoce', () => {
  assert.deepEqual(Sym.OPTIONS.map((o) => o.id), ['pain_mild', 'fatigue', 'cramp', 'stiffness', 'red_flag']);
  assert.ok(Sym.OPTIONS.find((o) => o.id === 'red_flag').hint.includes('Detiene la sesión'));
  // En inglés, la alarma dice lo mismo y con la misma fuerza (ADR-030); los ids que viajan a la API no cambian.
  const I = require(path.join(SRC, 'i18n.js'));
  I.use('en');
  assert.equal(I.t('symptom.opt.red_flag'), 'Severe pain, dizziness or loss of strength');
  assert.equal(I.t('symptom.opt.red_flag.hint'), 'Stops the session');
  for (const o of Sym.OPTIONS) assert.ok(I.has(`symptom.opt.${o.id}`, 'en'), o.id);
  I.use('es');
  assert.ok(read('symptom-form.js').includes("{ id: 'red_flag', label: t('symptom.opt.red_flag'), hint: t('symptom.opt.red_flag.hint') }"));
});

test('las páginas del paciente cargan el formulario antes de su script', () => {
  for (const [page, script] of [['paciente.html', 'patient.js'], ['seguimiento.html', 'seguimiento.js'], ['index.html', 'patient-link.js']]) {
    const html = read(page);
    const form = html.indexOf('symptom-form.js');
    assert.ok(form > 0, `${page} no carga symptom-form.js`);
    assert.ok(form < html.indexOf(script), `${page}: el formulario va antes de ${script}`);
  }
});

test('el formulario es accesible: botón expandible, leyenda, límite de 200 y estado anunciado', () => {
  const js = read('symptom-form.js');
  assert.ok(js.includes('aria-expanded') && js.includes('aria-controls'));
  assert.ok(js.includes("'legend'"));
  assert.ok(js.includes('maxLength: 200'));
  assert.ok(js.includes("'role', 'status'"));
  assert.ok(js.includes('Escape'));
  assert.ok(!js.includes('innerHTML'), 'solo textContent');
});

test('las tres vías de sesión mandan las molestias unidas a la sesión', () => {
  assert.ok(read('patient.js').includes('symptom_report_ids'));
  assert.ok(read('seguimiento.js').includes('symptom_report_ids'));
  assert.ok(read('patient-link.js').includes('symptom_report_ids'));
});

test('una alarma detiene la sesión en las tres vías', () => {
  assert.match(read('patient.js'), /res\.stop[\s\S]{0,40}endGuided\('pain_stop'\)/);
  assert.match(read('seguimiento.js'), /res\.stop[\s\S]{0,40}finish\('pain_stop'\)/);
  assert.match(read('patient-link.js'), /res\.stop[\s\S]{0,60}AxonApp\.stop\(\)/);
  assert.ok(read('app.js').includes("endSession('pain_stop')"));
});

test('el seguimiento con cámara no emite alertas de compensación por una molestia (I-12)', () => {
  const js = read('seguimiento.js');
  assert.ok(!/trunk_flexion|knee_valgus/.test(js.split('function onSymptom')[1].split('async function bootPatient')[0]));
});

test('el motor acepta bajar el rango y las repeticiones a mitad de sesión', () => {
  const session = E.createSession();
  const frames = S.generateSession({ seed: 11 });
  let i = 0;
  for (; i < frames.length && session.reps.length < 4; i += 1) {
    session.update({ t: frames[i].t, world: frames[i].world, visibility: frames[i].image });
  }
  assert.ok(session.snapshot().thresholds, 'ya hay línea base');
  const before = Math.round(session.snapshot().thresholds.romTarget);
  session.setConfig({ romTargetDeg: before - 10, maxReps: session.reps.length + 2 });
  assert.equal(Math.round(session.snapshot().thresholds.romTarget), before - 10, 'el umbral nuevo rige de inmediato');
  const expected = session.reps.length + 2;
  for (; i < frames.length; i += 1) session.update({ t: frames[i].t, world: frames[i].world, visibility: frames[i].image });
  assert.equal(session.reps.length, expected, 'la sesión termina con las repeticiones que quedaron');
  assert.equal(session.snapshot().endReason, 'completed');
});
