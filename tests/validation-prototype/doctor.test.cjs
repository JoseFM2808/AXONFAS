// Lectura estática del panel del fisioterapeuta (ADR-012, ADR-021).
//   node --test "tests/validation-prototype/*.test.cjs"
// Los textos viven en el diccionario (i18n/clinic.js, ADR-030): estos tests revisan que doctor.js use la clave y que el
// texto diga lo que tiene que decir en español y, en lo de seguridad o legal, también en inglés.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const js = fs.readFileSync(path.join(SRC, 'doctor.js'), 'utf8');
const I = require(path.join(SRC, 'i18n.js'));
/** Texto de una clave en un idioma. */
const say = (key, lang = 'es') => { I.use(lang); const s = I.t(key); I.use('es'); assert.notEqual(s, key, `falta ${key} (${lang})`); return s; };
/** doctor.js usa la clave como literal. */
const uses = (key) => js.includes(`t('${key}'`) || js.includes(`tn('${key}'`);

test('el editor del plan tiene el rango de rodilla opcional del sobre (ADR-021)', () => {
  assert.ok(js.includes("'rom_min'") && js.includes("'rom_max'"));
  assert.ok(uses('doctor.plan.incompleteRange'));
  assert.ok(say('doctor.plan.incompleteRange').includes('deja los dos vacíos'));
  assert.ok(say('doctor.plan.incompleteRange', 'en').includes('leave both empty'));
});

const html = fs.readFileSync(path.join(SRC, 'doctor.html'), 'utf8');

test('la nota SOAP tiene su sección accesible y la tabla de sesiones 8 columnas (TD-09, ADR-025)', () => {
  assert.match(html, /<section[^>]*id="soap-card"[^>]*aria-labelledby="soap-title"/);
  assert.match(html, /id="soap-status"[^>]*role="status"|role="status"[^>]*id="soap-status"/);
  assert.match(html, /<button[^>]*id="soap-approve"[^>]*>\s*\S[^<]*<\/button>/);
  const sessions = html.match(/<thead><tr>((?:<th\b[^>]*>[^<]*<\/th>)+)<\/tr><\/thead>\s*<tbody id="p-sessions">/);
  assert.equal(sessions[1].match(/<th\b/g).length, 8);
  assert.ok(sessions[1].includes('Dolor (EVA)'), 'respaldo en español sin JS');
  assert.ok(sessions[1].includes('data-i18n="doctor.th.pain"'));
  assert.equal(say('doctor.th.pain'), 'Dolor (EVA)');
  assert.match(say('doctor.th.pain', 'en'), /VAS/);
  assert.ok(js.includes('td.colSpan = 8'), 'la fila vacía ocupa las 8 columnas');
});

test('la nota dice que es borrador y no menciona la IA si no la redactó el LLM (I-8, TD-34)', () => {
  assert.ok(uses('doctor.soap.unsigned') && say('doctor.soap.unsigned').includes('Borrador sin firmar'));
  assert.match(say('doctor.soap.unsigned', 'en'), /Unsigned draft/);
  assert.match(say('doctor.soap.notRecord'), /No es un registro clínico hasta que lo firmes/);
  assert.match(say('doctor.soap.notRecord', 'en'), /not a clinical record until you sign it/);
  assert.ok(uses('doctor.soap.byTemplate') && say('doctor.soap.byTemplate').includes('sin IA'));
  assert.ok(say('doctor.soap.byTemplate', 'en').includes('no AI'));
  assert.ok(js.includes('/report/approve'));
  // El aviso de la IA está en un solo lugar y en la misma condición que source === 'llm'.
  const lines = js.split('\n').filter((l) => l.includes("'doctor.soap.byAi'"));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("'llm'"), 'el texto de la IA debe ir en la misma condición que source === llm');
  assert.ok(say('doctor.soap.byAi').includes('propuso la IA') && /\bAI\b/.test(say('doctor.soap.byAi', 'en')));
  for (const k of I.keys('es').filter((x) => x.startsWith('doctor.soap.') && x !== 'doctor.soap.byAi')) {
    assert.ok(!/propuso la IA/.test(say(k)), `${k} no atribuye la nota a la IA`);
  }
});

test('el panel descarga la Observation FHIR con el token en la cabecera (TD-10)', () => {
  assert.ok(js.includes('/fhir'));
  assert.ok(js.includes('application/fhir+json'));
  for (const k of ['doctor.soap.preliminary', 'doctor.soap.obsPrelim', 'doctor.soap.docPrelim']) {
    assert.ok(uses(k), k);
    assert.ok(say(k).includes('preliminary') && say(k, 'en').includes('preliminary'), `${k}: el estado FHIR se nombra igual`);
  }
  assert.match(html, /id="soap-fhir"/);
});

test('la nota abierta se vacía al cambiar de paciente, al cerrar o si falla la carga (no se firma la nota equivocada)', () => {
  const body = (name) => {
    const i = js.indexOf(name);
    assert.ok(i >= 0, name);
    const end = js.slice(i).search(/\r?\n  \}/);           // cierre del bloque (sangría de 2 espacios)
    return js.slice(i, i + end);
  };
  assert.match(body('function resetSoap()'), /state\.soap = null/);
  assert.match(body('function resetSoap()'), /soap-body'\)\.replaceChildren\(\)/);
  assert.match(body('async function selectPatient('), /resetSoap\(\)/);
  assert.match(body('async function openReport('), /resetSoap\(\);\s*state\.soap = \{/);
  assert.match(body("$('soap-close')"), /resetSoap\(\)/);
});

test('un código nuevo vuelve a pedir el consentimiento y el panel lo dice (TD-85)', () => {
  assert.ok(uses('doctor.status.waiting') && uses('doctor.card.noConsent'));
  assert.ok(say('doctor.status.waiting').includes('el consentimiento se vuelve a pedir'));
  assert.ok(say('doctor.status.waiting', 'en').includes('consent is requested again'));
  assert.equal(say('doctor.card.noConsent'), 'Sin consentimiento');
  assert.equal(say('doctor.card.noConsent', 'en'), 'No consent');
});

test('el panel muestra y anuncia las molestias del paciente (ADR-021)', () => {
  assert.ok(html.includes('p-symptoms-title'));
  assert.match(html, /id="p-symptom-alert"[^>]*role="status"|role="status"[^>]*id="p-symptom-alert"/);
  assert.ok(js.includes('symptom_reported'));
  assert.ok(js.includes("kpi(t('doctor.kpi.discomfort')"));
  assert.equal(say('doctor.kpi.discomfort'), 'Molestias 30 días');
  assert.ok(js.includes("setAttribute('role', 'alert')"));
  assert.match(say('doctor.symptom.alarmIn', 'en'), /^Red flag in \{exercise\}\. The session was stopped\.$/);
});

test('el aviso de alarma no repite "señal de alarma" dos veces', () => {
  assert.ok(!js.includes('`Señal de alarma: ${what}'));
  assert.ok(!js.includes("t('doctor.symptom.alarmIn', { what"), 'la alarma nombra el ejercicio, no la categoría (que ya es "señal de alarma")');
  for (const l of ['es', 'en']) assert.equal((say('doctor.symptom.alarmIn', l).match(/alarma|red flag/gi) || []).length, 1, l);
});

test('el editor del plan tiene la meta de recorrido y su límite para la galería (ADR-025, TD-99)', () => {
  assert.ok(js.includes("'goal_target'") && js.includes("'goal_limit'"));
  assert.ok(js.includes('item.range_goal = { target: Number(goalTarget), limit: Number(goalLimit) }'));
  assert.ok(uses('doctor.plan.incompleteGoal') && say('doctor.plan.incompleteGoal').includes('o deja los dos vacíos'));
  assert.ok(js.includes("spec.mode !== 'manual'"), 'los ejercicios que la cámara no ve no llevan meta');
  for (const k of ['doctor.goal.hint', 'doctor.goal.hintLower']) {
    assert.ok(js.includes(`'${k}'`), k);
    assert.ok(say(k).includes('no es una alerta'), `${k}: el texto deja claro que el límite no es una alerta (I-12)`);
    assert.ok(say(k, 'en').includes('it is not an alert'), `${k} (en)`);
  }
});

test('el panel muestra el dolor al terminar y lo recibe en vivo (ADR-025, TD-100)', () => {
  assert.ok(js.includes("kpi(t('doctor.kpi.pain')"));
  assert.equal(say('doctor.kpi.pain'), 'Dolor al terminar (EVA)');
  assert.ok(js.includes("msg.kind === 'pain_scored'"));
  assert.ok(js.includes('s.pain_score'));
  assert.ok(uses('doctor.cam.over'));
  assert.ok(say('doctor.cam.over').includes('sobre el límite') && say('doctor.cam.over', 'en').includes('over the limit'));
});

test('el aviso de sesión sin cámara dice lo mismo que la nota SOAP (TD-111) y el panel sigue el idioma (ADR-030)', () => {
  const soap = js.match(/const NO_CAMERA_NOTE_SOAP = '([^']+)'/)[1];
  assert.equal(say('doctor.nocam'), soap, 'en español, el mismo texto que escribe agents/soap.py');
  assert.match(say('doctor.nocam', 'en'), /without a camera/);
  assert.ok(!/toLocale(?:Date|Time)?String\('es-PE'/.test(js), 'fechas con I18N.locale()');
  assert.ok(js.includes('I18N.locale()'));
});
