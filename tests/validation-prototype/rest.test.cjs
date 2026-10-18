// Descanso recomendado entre series (ADR-022). Solo datos sintéticos (ADR-010).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const R = require(path.join(SRC, 'rest-timer.js'));
const C = require(path.join(SRC, 'catalog.js'));

test('la cuenta regresiva baja, se puede alargar y saltar', () => {
  const r = R.createRest({ seconds: 60, now: 0 });
  assert.equal(r.tick(30000).left, 30);
  assert.equal(r.tick(30000).done, false);
  assert.equal(r.tick(60000).done, true);
  const longer = R.createRest({ seconds: 60, now: 0 });
  longer.extend(30);
  assert.equal(longer.tick(50000).left, 40);
  const skipped = R.createRest({ seconds: 60, now: 0 });
  skipped.skip();
  assert.equal(skipped.tick(1000).done, true);
  assert.equal(skipped.state, 'skipped');
});

test('el texto distingue el valor de partida, un valor y un rango', () => {
  const def = R.text({ min: 60, max: 60, default: true });
  assert.ok(def.includes('60 s') && def.includes('valor de partida') && def.includes('no clínico'));
  assert.equal(R.text({ min: 45, max: 45, default: false }), 'Descanso recomendado por tu fisioterapeuta: 45 s');
  assert.equal(R.text({ min: 45, max: 90, default: false }), 'Descanso recomendado: 45–90 s');
});

test('el valor por defecto es el mismo en el catálogo, el temporizador y la API', () => {
  assert.equal(C.REST_DEFAULT_SECONDS, 60);
  assert.equal(R.DEFAULT_SECONDS, C.REST_DEFAULT_SECONDS);
});

test('las páginas cargan el temporizador y lo usan sin bloquear (ADR-022)', () => {
  assert.ok(read('paciente.html').includes('rest-timer.js'));
  assert.ok(read('seguimiento.html').includes('rest-timer.js'));
  assert.ok(read('rest-timer.js').includes('Saltar descanso'));
  assert.ok(read('rest-timer.js').includes("aria-hidden', 'true'"));
  assert.match(read('seguimiento.js'), /case 'set_done':[^\n]*startRest\(\)/);
  assert.match(read('patient.js'), /stopRest\(\);[^\n]*\n\s*g\.setsDone \+= 1/);
});

test('el panel pide el descanso como recomendación, no como límite', () => {
  const js = read('doctor.js');
  assert.ok(js.includes('rest_min_seconds') && js.includes('rest_max_seconds'));
  assert.ok(js.includes('no un límite'));
  assert.ok(!/safety_envelope[^;]*rest_/.test(js), 'el descanso no va en el sobre');
});

test('los botones del descanso son accesibles y el foco no se pierde al terminar (WCAG 2.2: 2.5.3 y 2.4.3)', () => {
  const js = read('rest-timer.js');
  // El nombre accesible de "+30 s" empieza con el texto visible.
  assert.match(js, /setAttribute\('aria-label', `\+\$\{EXTEND_SECONDS\} s/);
  // Al quitar los botones, si tenían el foco, pasa al aviso de estado.
  assert.match(js, /hadFocus\) \{ status\.tabIndex = -1; status\.focus\(\); \}/);
});
