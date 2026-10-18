// Lectura estática del panel del fisioterapeuta (ADR-012, ADR-021).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const js = fs.readFileSync(path.join(SRC, 'doctor.js'), 'utf8');

test('el editor del plan tiene el rango de rodilla opcional del sobre (ADR-021)', () => {
  assert.ok(js.includes("'rom_min'") && js.includes("'rom_max'"));
  assert.ok(js.includes('deja los dos vacíos'));
});

const html = fs.readFileSync(path.join(SRC, 'doctor.html'), 'utf8');

test('la nota SOAP tiene su sección accesible y la tabla de sesiones 7 columnas (TD-09)', () => {
  assert.match(html, /<section[^>]*id="soap-card"[^>]*aria-labelledby="soap-title"/);
  assert.match(html, /id="soap-status"[^>]*role="status"|role="status"[^>]*id="soap-status"/);
  assert.match(html, /<button[^>]*id="soap-approve"[^>]*>\s*\S[^<]*<\/button>/);
  const sessions = html.match(/<thead><tr>((?:<th>[^<]*<\/th>)+)<\/tr><\/thead>\s*<tbody id="p-sessions">/);
  assert.equal(sessions[1].match(/<th>/g).length, 7);
});

test('la nota dice que es borrador y no menciona la IA si no la redactó el LLM (I-8, TD-34)', () => {
  assert.ok(js.includes('Borrador sin firmar'));
  assert.ok(js.includes('sin IA'));
  assert.ok(js.includes('/report/approve'));
  const line = js.split('\n').find((l) => l.includes('propuso la IA'));
  assert.ok(line && line.includes("'llm'"), 'el texto de la IA debe ir en la misma condición que source === llm');
  assert.equal(js.split('\n').filter((l) => l.includes('propuso la IA')).length, 1);
});

test('el panel descarga la Observation FHIR con el token en la cabecera (TD-10)', () => {
  assert.ok(js.includes('/fhir'));
  assert.ok(js.includes('application/fhir+json'));
  assert.ok(js.includes('preliminary'));
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
  assert.ok(js.includes('el consentimiento se vuelve a pedir'));
  assert.ok(js.includes('Sin consentimiento'));
});

test('el panel muestra y anuncia las molestias del paciente (ADR-021)', () => {
  assert.ok(html.includes('p-symptoms-title'));
  assert.match(html, /id="p-symptom-alert"[^>]*role="status"|role="status"[^>]*id="p-symptom-alert"/);
  assert.ok(js.includes('symptom_reported'));
  assert.ok(js.includes('Molestias 30 días'));
  assert.ok(js.includes("setAttribute('role', 'alert')"));
});

test('el aviso de alarma no repite "señal de alarma" dos veces', () => {
  assert.ok(!js.includes('`Señal de alarma: ${what}'));
});

// ---------------------------------------------------------------- decisiones del agente (ADR-025)
test('el panel tiene la sección «Decisiones del agente» con nombre accesible y recibe el turno en vivo', () => {
  assert.match(html, /<section[^>]*aria-labelledby="p-decisions-title"[^>]*>\s*<h2 id="p-decisions-title">Decisiones del agente<\/h2>/);
  assert.match(html, /id="p-decisions"/);
  assert.match(js, /msg\.kind === 'agent_turn'/);
  assert.ok(js.includes('renderDecisions(d)'));
});

test('el modelo solo se nombra cuando propuso el agente clínico; si decidieron las reglas se dice así (TD-34)', () => {
  const withModel = js.split('\n').filter((l) => l.includes('ai_model'));
  assert.ok(withModel.length > 0 && withModel.every((l) => l.includes("d.agent === 'clinical'")), 'ai_model solo en la rama del agente clínico');
  assert.ok(js.includes('Propuso el motor de reglas'));
  assert.ok(js.includes('sin cambio de dosis; respondieron las reglas'));
  const live = js.split('\n').filter((l) => l.includes('msg.model'));
  assert.ok(live.length > 0 && live.every((l) => l.includes("msg.decided_by === 'llm'")), 'el modelo del aviso en vivo solo si lo decidió la IA');
  assert.ok(js.includes('d.ai_provider') && !/Token Factory/.test(js), 'el proveedor sale de los datos, no se escribe a mano');
});

test('el resultado de la decisión se dice con texto y no solo con color, y lo escrito por el paciente va como texto', () => {
  assert.ok(js.includes("'Aplicado'") && js.includes("'Escalado'") && js.includes("'Rechazado'"));
  const render = js.split('function renderDecisions')[1].split('/** Aviso en vivo')[0];
  assert.ok(!render.includes('innerHTML'));
});

test('el panel ya no atribuye la IA a la GPU (TD-34)', () => {
  assert.ok(!/GPU AMD esté conectada|modelo en la GPU|IA en la GPU AMD/.test(js + html));
  assert.ok(js.includes('Pidiendo el resumen al modelo de ${state.aiProvider'));
});
