// Nivel 1: descargo médico y triaje de banderas rojas (ADR-023, TD-95). Solo datos sintéticos (ADR-010).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const T = require(path.join(SRC, 'triage.js'));
const I = require(path.join(SRC, 'i18n.js'));
const inLang = (l, key, vars) => { I.use(l); const s = I.t(key, vars); I.use('es'); return s; };

const allNo = () => Object.fromEntries(T.RED_FLAGS.map((f) => [f.id, 'no']));
const HOUR = 3600 * 1000;

test('las seis banderas rojas del estudio están, más fiebre y déficit neurológico', () => {
  const ids = T.RED_FLAGS.map((f) => f.id);
  for (const id of ['sphincter', 'saddle', 'cancer', 'weight_loss', 'trauma', 'night_pain']) {
    assert.equal(T.RED_FLAGS.find((f) => f.id === id).source, 'study', id);
  }
  assert.deepEqual(ids.filter((id) => T.RED_FLAGS.find((f) => f.id === id).source === 'guideline'), ['fever', 'neuro']);
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
  T.RED_FLAGS.concat(T.YELLOW_FLAGS).forEach((f) => assert.ok(f.text.startsWith('¿') && f.text.endsWith('?'), f.id));
});

test('sin banderas: pasa, con tono estándar', () => {
  const r = T.evaluate(allNo());
  assert.equal(r.status, 'clear');
  assert.deepEqual(r.red, []);
  assert.equal(r.tone, 'standard');
});

test('cualquier bandera roja bloquea, sola o con otras sin responder', () => {
  for (const f of T.RED_FLAGS) {
    assert.equal(T.evaluate({ ...allNo(), [f.id]: 'yes' }).status, 'blocked', f.id);
    assert.equal(T.evaluate({ [f.id]: 'yes' }).status, 'blocked', `${f.id} con el resto vacío`);
  }
  assert.deepEqual(T.evaluate({ ...allNo(), cancer: 'yes', trauma: 'yes' }).red, ['cancer', 'trauma']);
});

test('las rojas son obligatorias: sin responder todas no hay acceso', () => {
  const a = allNo();
  delete a.night_pain;
  const r = T.evaluate(a);
  assert.equal(r.status, 'incomplete');
  assert.deepEqual(r.missing, ['night_pain']);
  assert.equal(T.record(r), null, 'un triaje incompleto no se guarda');
  assert.equal(T.evaluate({ ...allNo(), sphincter: 'tal vez' }).status, 'incomplete', 'solo sí o no');
});

test('las amarillas nunca bloquean: solo hacen cuidadoso el tono', () => {
  const r = T.evaluate({ ...allNo(), fear: 'yes', avoidance: 'yes' });
  assert.equal(r.status, 'clear');
  assert.deepEqual(r.yellow, ['fear', 'avoidance']);
  assert.equal(r.tone, 'gentle');
  assert.equal(T.evaluate({ ...allNo() }).status, 'clear', 'las amarillas son opcionales');
});

test('se guarda solo el resultado, el vencimiento y el tono, nunca las respuestas', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const rec = T.record(T.evaluate({ ...allNo(), cancer: 'yes', fear: 'yes' }), now);
  assert.deepEqual(Object.keys(rec).sort(), ['status', 'tone', 'until', 'v']);
  assert.ok(!JSON.stringify(rec).includes('cancer') && !JSON.stringify(rec).includes('fear'));
});

test('vigencias: sin banderas 7 días; un bloqueo dura 24 h y después se vuelve a preguntar', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const clear = T.record(T.evaluate(allNo()), now);
  assert.equal(T.gateState(clear, now + 6 * 24 * HOUR), 'clear');
  assert.equal(T.gateState(clear, now + 7 * 24 * HOUR), 'needed');
  const blocked = T.record(T.evaluate({ ...allNo(), saddle: 'yes' }), now);
  assert.equal(T.gateState(blocked, now + 23 * HOUR), 'blocked');
  assert.equal(T.gateState(blocked, now + 24 * HOUR), 'needed');
});

test('un registro viejo, alterado o de otra versión pide el triaje de nuevo', () => {
  const now = Date.now();
  assert.equal(T.gateState(null, now), 'needed');
  assert.equal(T.gateState({ v: T.VERSION - 1, status: 'clear', until: new Date(now + HOUR).toISOString() }, now), 'needed');
  assert.equal(T.gateState({ v: T.VERSION, status: 'ok', until: new Date(now + HOUR).toISOString() }, now), 'needed');
  assert.equal(T.gateState({ v: T.VERSION, status: 'clear', until: 'mañana' }, now), 'needed');
});

test('exentos: el modo paciente con su plan y las cuentas de fisioterapeuta o Administrador', () => {
  const has = (...roles) => (role) => roles.includes(role);
  assert.equal(T.exempt({ search: '?plan=sit_to_stand', hasAccount: has('patient') }), true);
  assert.equal(T.exempt({ search: '?plan=1', hasAccount: has('patient') }), true);
  assert.equal(T.exempt({ search: '', hasAccount: has('patient') }), false, 'paciente fuera de su plan = autogestión');
  assert.equal(T.exempt({ search: '?plan=1', hasAccount: has() }), false, 'sin cuenta, ?plan= no exime');
  assert.equal(T.exempt({ search: '', hasAccount: has('therapist') }), true);
  assert.equal(T.exempt({ search: '', hasAccount: has('admin') }), true);
});

test('el triaje va donde se hace ejercicio: el seguimiento entero y la cámara del Prototipo (ADR-028)', () => {
  assert.ok(read('seguimiento.html').includes('<script src="triage.js" data-gate="self-care"></script>'));
  assert.ok(read('index.html').includes('<script src="triage.js"></script>'), 'el Prototipo carga el triaje sin puerta');
  assert.ok(read('app.js').includes('await AxonTriage.ensure()'), 'y lo pide al encender la cámara');
  assert.ok(!read('galeria.html').includes('triage.js'), 'la galería se explora sin triaje');
  assert.ok(read('triage.js').includes('function ensure('));
  for (const page of ['doctor.html', 'paciente.html', 'login.html', 'admin.html']) {
    assert.ok(!read(page).includes('data-gate'), `${page} no lleva la puerta`);
  }
});

test('el triaje es de reglas fijas: ni IA ni red, y el bloqueo recomienda urgencias', () => {
  const js = read('triage.js');
  assert.ok(!/fetch\(|XMLHttpRequest|AxonApi\.call|sendBeacon/.test(js), 'las respuestas no salen del navegador');
  assert.ok(!js.includes('innerHTML'), 'solo textContent');
  assert.ok(T.MESSAGES.blocked.includes('emergencias') && T.MESSAGES.blocked.includes('106'));
  assert.equal(T.DISCLAIMER.length, 5);
  assert.ok(T.DISCLAIMER.some((t) => t.includes('no es un dispositivo médico')));
});

test('accesible: leyendas, foco al título, estado y alerta anunciados, confirmar antes de bloquear', () => {
  const js = read('triage.js');
  assert.ok(js.includes("'fieldset'") && js.includes("'legend'"));
  assert.ok(js.includes('h.focus()'));
  assert.ok(js.includes("'role', 'status'") && js.includes("'role', 'alert'"));
  assert.ok(js.includes('aria-labelledby'));
  assert.ok(js.includes("t('triage.confirm.fix')"));
  assert.equal(inLang('es', 'triage.confirm.fix'), 'Corregir mis respuestas');
  assert.equal(inLang('en', 'triage.confirm.fix'), 'Correct my answers');
  assert.ok(read('hud.css').includes('.triage-yn .check { min-height: 40px;'), 'objetivos táctiles de 40 px');
});

// ------------------------------------------------------------------ idioma de la interfaz (ADR-030)
test('banderas rojas, descargo y urgencias existen en los dos idiomas y dicen lo mismo', () => {
  const pack = require(path.join(SRC, 'i18n', 'routine.js'));
  // Cada bandera (roja o amarilla) tiene su pregunta en español y en inglés, con los mismos ids.
  for (const f of T.RED_FLAGS.concat(T.YELLOW_FLAGS)) {
    const kind = T.RED_FLAGS.includes(f) ? 'red' : 'yellow';
    const key = `triage.${kind}.${f.id}`;
    assert.equal(pack.es[key], f.text, `${key}: el español es el que muestra el triaje`);
    assert.ok(pack.en[key] && pack.en[key].endsWith('?') && !pack.en[key].startsWith('¿'), `${key}: pregunta en inglés`);
  }
  // Mismo número de frases en el descargo; las dos versiones dicen que no es un dispositivo médico.
  for (let i = 1; i <= T.DISCLAIMER.length; i += 1) assert.ok(pack.es[`triage.disclaimer.${i}`] && pack.en[`triage.disclaimer.${i}`], `descargo ${i}`);
  assert.ok(!pack.es[`triage.disclaimer.${T.DISCLAIMER.length + 1}`]);
  assert.ok(pack.es['triage.disclaimer.1'].includes('no es un dispositivo médico'));
  assert.ok(pack.en['triage.disclaimer.1'].includes('not a medical device'));
  // El síntoma agudo nombra los mismos tres signos y la misma acción.
  assert.match(pack.es['triage.disclaimer.3'], /dolor fuerte, mareo o pérdida de fuerza\), detente/);
  assert.match(pack.en['triage.disclaimer.3'], /severe pain, dizziness or loss of strength\), stop/);
  // Urgencias: SAMU (106) y el número de emergencias del país, en los dos idiomas.
  const es = pack.es['triage.msg.blocked'];
  const en = pack.en['triage.msg.blocked'];
  assert.ok(es.includes('106') && es.includes('SAMU') && es.includes('número de emergencias de tu país') && es.includes('emergencias'));
  assert.ok(en.includes('106') && en.includes('SAMU') && en.includes("your country's emergency number") && en.includes('emergency room'));
  assert.ok(es.includes('médico o un fisioterapeuta') && en.includes('doctor or a physiotherapist'), 'si no es urgente, una consulta');
  // Lo que la pantalla usa es lo del diccionario, y en inglés se ve el inglés.
  assert.equal(T.MESSAGES.blocked, es);
  assert.equal(inLang('en', 'triage.msg.blocked'), en);
  assert.equal(inLang('en', 'triage.q.missing.other', { n: 3 }), '3 warning-sign questions still need an answer.');
});

test('el triaje toma sus textos del diccionario y la fecha de bloqueo sigue el idioma', () => {
  const js = read('triage.js');
  assert.ok(js.includes("t('triage.msg.blocked')") && js.includes("t('triage.red.neuro')"));
  assert.ok(js.includes('toLocaleString(I18N.locale()'), 'fecha con el formato del idioma');
  assert.ok(!/'¿[^']+\?'/.test(js), 'ninguna pregunta escrita a mano en el código');
});
