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
