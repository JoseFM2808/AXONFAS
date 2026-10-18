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

// ---------------------------------------------------------------- turno de texto con el agente clínico (ADR-033)
const I18N = require(path.join(SRC, 'i18n.js'));
const withLang = (lang, fn) => { I18N.use(lang); try { return fn(); } finally { I18N.use('es'); } };

test('aiLine dice el modelo y la latencia solo cuando la IA respondió (TD-34), en español', () => {
  I18N.use('es');
  const llm = Sym.aiLine({ decided_by: 'llm', llm_answered: true, provider: 'AMD Token Factory', model: 'Modelo-X', clinical_ms: 1240, phrased_by: 'rules' });
  const one = (1.2).toLocaleString(I18N.locale(), { minimumFractionDigits: 1 });      // es-PE usa punto decimal
  assert.ok(llm.includes('Modelo-X') && llm.includes('AMD Token Factory') && llm.includes(`${one} s`), llm);
  assert.ok(llm.includes('validaron las reglas de seguridad'));
  assert.ok(!llm.includes('Frase redactada'));
  assert.ok(Sym.aiLine({ decided_by: 'llm', llm_answered: true, provider: 'vLLM en AMD Instinct MI300X', model: 'M', clinical_ms: 900, phrased_by: 'llm' })
    .includes('vLLM en AMD Instinct MI300X'), 'el proveedor sale de los datos, no se escribe a mano');
  const refused = Sym.aiLine({ decided_by: 'rules', llm_answered: true, provider: 'AMD Token Factory', model: 'M', clinical_ms: 2500 });
  assert.ok(refused.includes(`${(2.5).toLocaleString(I18N.locale(), { minimumFractionDigits: 1 })} s`) && refused.includes('asistente de AMD (M)') && refused.includes('reglas de seguridad de AXONFAS'), refused);
  // Cuando deciden las reglas por tiempo, error, cupo o falta de IA, el paciente lee una sola frase neutra y verdadera.
  for (const ai of [{ skipped: 'no_provider' }, { error: 'timeout' }, { error: 'llm_error' }, { skipped: 'rate_limited' }, { skipped: 'busy' },
    { skipped: 'guided' }, { skipped: 'unavailable' }]) {
    const rules = Sym.aiLine({ decided_by: 'rules', llm_answered: false, provider: null, model: null, ...ai });
    assert.equal(rules, 'Te respondieron las reglas de seguridad de AXONFAS.');
    assert.ok(!/no respondi|sin IA|Token Factory|modelo/.test(rules), rules);
  }
  assert.equal(Sym.aiLine({ decided_by: 'rules', skipped: 'red_flag' }), 'La alarma siempre la deciden las reglas de seguridad de AXONFAS.');
  assert.equal(Sym.aiLine(null), '');
});

test('aiLine en inglés dice lo mismo, con punto decimal y sin atribuir nada a la IA si respondieron las reglas (I-22, TD-34)', () => {
  withLang('en', () => {
    const rules = Sym.aiLine({ decided_by: 'rules', skipped: 'no_provider' });
    assert.equal(rules, 'The AXONFAS safety rules answered you.');
    assert.ok(!/Token Factory|model|no answer/i.test(rules), rules);
    assert.equal(Sym.aiLine({ decided_by: 'rules', skipped: 'red_flag' }), 'Alarms are always decided by the AXONFAS safety rules.');
    const llm = Sym.aiLine({ decided_by: 'llm', llm_answered: true, provider: 'AMD Token Factory', model: 'Modelo-X', clinical_ms: 1240, phrased_by: 'llm' });
    assert.ok(llm.includes('1.2 s') && llm.includes('Modelo-X') && llm.includes('AMD Token Factory') && llm.includes('Sentence written by Modelo-X.'), llm);
    assert.ok(Sym.aiLine({ decided_by: 'rules', llm_answered: true, model: 'M', clinical_ms: 2500 }).includes('reduction from the AXONFAS safety rules'));
  });
});

test('el formulario usa el turno solo en sesión y con texto, con tiempo límite, y conserva el texto si falla', () => {
  const js = read('symptom-form.js');
  assert.match(js, /useTurn = Boolean\(opts\.turn && body\.in_session && body\.text && body\.exercise_id\)/);
  assert.match(js, /'\/api\/me\/turn', body, \{ timeoutMs: waitMs\(\) \}/);
  assert.match(js, /Number\(opts\.assistant\.wait_s\)\) \|\| DEFAULT_WAIT_S/, 'el navegador espera lo que dijo el servidor');
  assert.ok(js.includes("'/api/me/discomfort'"), 'sin sesión o sin texto sigue la vía de antes');
  const catchBlock = js.split('} catch (err) {')[1].split('} finally')[0];
  assert.ok(!catchBlock.includes('form.reset'), 'el texto se conserva para reenviar');
  assert.ok(catchBlock.includes("t('symptom.noReply')"));
  assert.equal(withLang('es', () => I18N.t('symptom.noReply')),
    'No llegó la respuesta. Si sientes dolor fuerte, mareo o pérdida de fuerza, toca «Dolor: detener».');
  assert.ok(withLang('en', () => I18N.t('symptom.noReply')).includes('tap «Pain: stop»'));
  assert.ok(read('api-client.js').includes('AbortController'));
  assert.match(read('api-client.js'), /err\.timeout = /);
  assert.match(read('api-client.js'), /t\('api\.timeout'\)/);
});

test('el turno es accesible: espera anunciada, aria-busy, alarma con role alert y el botón de dolor nunca se toca', () => {
  const js = read('symptom-form.js');
  assert.ok(js.includes("'role', 'status'") && js.includes("'role', 'alert'"));
  assert.ok(js.includes("setAttribute('aria-busy', 'true')") && js.includes("removeAttribute('aria-busy')"));
  assert.match(js, /aiNote\.setAttribute\('aria-live', 'polite'\)/, 'quién respondió también se anuncia');
  assert.match(js, /opts\.assistant && opts\.assistant\.available \? t\('symptom\.wait\.ai'\) : t\('symptom\.wait\.rules'\)/,
    'el asistente solo se nombra si está disponible');
  assert.equal(withLang('es', () => I18N.t('symptom.wait.rules')), 'Revisando lo que dijiste con las reglas de seguridad…');
  assert.ok(!/\b(IA|modelo|asistente|AI|model|assistant)\b/i.test(withLang('es', () => I18N.t('symptom.wait.rules')) + withLang('en', () => I18N.t('symptom.wait.rules'))),
    'sin IA disponible la espera no la nombra (TD-34)');
  assert.equal(withLang('es', () => I18N.t('symptom.wait.ai')), 'El asistente de AMD está revisando lo que dijiste…');
  assert.equal(withLang('en', () => I18N.t('symptom.wait.ai')), 'The AMD assistant is reviewing what you said…');
  assert.ok(!/btn-pain|g-pain|Dolor: detener'\)\.disabled/.test(js), 'el formulario no deshabilita «Dolor: detener»');
  assert.ok(js.includes('aria-describedby'));
  assert.ok(!js.includes('innerHTML'), 'solo textContent con lo que escribe el paciente o responde el LLM');
});

test('las tres vías de sesión unen los turnos por id y protegen una respuesta sin report o turn', () => {
  for (const [file, key] of [['patient.js', 'voice_turn_ids: g.turnIds'], ['seguimiento.js', 'voice_turn_ids: st.turnIds'],
    ['patient-link.js', 'voice_turn_ids: turnIds']]) {
    const js = read(file);
    assert.ok(js.includes(key), `${file} no manda ${key}`);
    assert.match(js, /if \(res\.report\) \w+(\.\w+)?\.push\(res\.report\.id\)/, `${file} protege res.report`);
    assert.match(js, /if \(res\.turn\) \w+(\.\w+)?\.push\(res\.turn\.id\)/, `${file} protege res.turn`);
    assert.ok(/turn: true/.test(js), `${file} activa el turno`);
  }
  assert.match(read('patient-link.js'), /turnIds = \[\];/, 'se reinicia al empezar cada sesión');
  assert.match(read('patient-link.js'), /recent: \(\) => \(window\.AxonApp \? AxonApp\.recent\(\) : \[\]\)/);
  assert.ok(read('app.js').includes('recent()'));
});

test('sin cámara también hay turno: el seguimiento lo deja activo en la práctica nocam (merge con TD-110)', () => {
  assert.match(read('seguimiento.js'), /st\.practice && st\.practice\.mode === 'nocam'\)\) && !st\.ended,\s*current: \(\) => null, turn: true/);
});

test('ningún texto del paciente atribuye algo a la IA fuera de aiLine y del aviso condicional (TD-34)', () => {
  for (const file of ['symptom-form.js', 'patient.js', 'seguimiento.js', 'app.js', 'api-client.js']) {
    assert.ok(!/Token Factory/.test(read(file)), `${file} nombra a Token Factory`);
  }
  assert.ok(!/Token Factory/.test(read('patient-link.js')), 'los textos del modo paciente salen del diccionario');
  for (const lang of ['es', 'en']) {
    withLang(lang, () => {
      for (const key of ['link.chip', 'link.lead', 'link.footer']) {
        const text = I18N.t(key);
        assert.ok(!/no usa servidor|sin conexi|not use a server|no connection/i.test(text), `${lang} ${key}`);
        if (/Token Factory/.test(text)) assert.match(text, /si está conectada|if it is connected/, `${lang} ${key}: solo condicional`);
      }
    });
  }
  assert.match(read('patient-link.js'), /chip\.textContent = t\('link\.chip'\)/);
  assert.match(read('patient-link.js'), /lead\.textContent = t\('link\.lead'\)/);
  assert.match(read('patient-link.js'), /foot\.textContent = t\('link\.footer'\)/);
});

test('el motor expone las últimas repeticiones sin calibración para el contexto del agente', () => {
  const app = read('app.js');
  const recent = app.split('recent() {')[1].split('adjust(adj)')[0];
  assert.ok(recent.includes('!r.calibration') && recent.includes('.slice(-5)') && recent.includes('kneeRom') && recent.includes('peakTrunk'));
});

// ---------------------------------------------------------------- privacidad antes de la IA (ADR-034) y tiempos (ADR-033)
test('el aviso bajo el campo dice quién lo revisa, sin nombrar a la IA si no está disponible', () => {
  withLang('es', () => {
    const on = Sym.noteText({ available: true, wait_s: 25 });
    assert.ok(on.includes('reglas de seguridad de AXONFAS') && on.includes('asistente de AMD') && on.includes('Se envía sin tu nombre'), on);
    assert.ok(on.includes('correos, teléfonos y documentos'));
    const off = Sym.noteText({ available: false });
    assert.equal(off, 'Lo revisan las reglas de seguridad de AXONFAS.');
    assert.equal(Sym.noteText(undefined), off);
  });
  withLang('en', () => {
    assert.ok(Sym.noteText({ available: true }).includes('It is sent without your name'));
    assert.equal(Sym.noteText({ available: false }), 'The AXONFAS safety rules review it.');
  });
  const js = read('symptom-form.js');
  assert.match(js, /text\.setAttribute\('aria-describedby', note\.id\)/);
  assert.match(js, /node\('p', 'muted', noteText\(opts\.assistant\)\)/);
  assert.ok(!js.includes('innerHTML'));
});

test('la línea de privacidad aparece solo si se ocultó algo, con plural en los dos idiomas', () => {
  withLang('es', () => {
    assert.equal(Sym.privacyLine({ redactions: 0 }), '');
    assert.equal(Sym.privacyLine(undefined), '');
    assert.equal(Sym.privacyLine({ redactions: 1 }), 'Ocultamos 1 dato personal antes de enviarlo.');
    assert.equal(Sym.privacyLine({ redactions: 2 }), 'Ocultamos 2 datos personales antes de enviarlo.');
  });
  withLang('en', () => {
    assert.equal(Sym.privacyLine({ redactions: 1 }), 'We hid 1 piece of personal data before sending it.');
    assert.equal(Sym.privacyLine({ redactions: 3 }), 'We hid 3 pieces of personal data before sending it.');
  });
  assert.match(read('symptom-form.js'), /\[aiLine\(res\.ai\), privacyLine\(res\.privacy\)\]/);
});

test('las tres vías le pasan al formulario lo que /api/me dijo del asistente', () => {
  assert.match(read('patient-link.js'), /assistant: me\.assistant/);
  assert.match(read('seguimiento.js'), /assistant: me\.assistant/);
  assert.match(read('patient.js'), /assistant: state\.me && state\.me\.assistant/);
});
