// Tests del catálogo de ejercicios (ADR-011) y del mapa corporal (ADR-013).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const C = require(path.join(SRC, 'catalog.js'));
const B = require(path.join(SRC, 'body-map.js'));
const DATA = require(path.join(SRC, 'body-map-data.js'));

const MUSCLES = new Set([...Object.keys(DATA.anterior), ...Object.keys(DATA.posterior)]);
const THEMES = new Set(C.THEMES.map((t) => t.id));

test('cada ejercicio está completo y cita una fuente pública', () => {
  const ids = new Set();
  for (const e of C.EXERCISES) {
    assert.ok(!ids.has(e.id), `id repetido: ${e.id}`);
    ids.add(e.id);
    assert.ok(THEMES.has(e.theme), `${e.id}: temática desconocida`);
    assert.ok(e.name && e.goal && e.position, `${e.id}: falta nombre, objetivo o posición`);
    assert.ok(e.steps.length >= 2, `${e.id}: al menos 2 pasos`);
    assert.match(e.source.url, /^https:\/\//, `${e.id}: la fuente debe ser https`);
    assert.ok(e.source.org && e.source.title, `${e.id}: fuente sin organización o título`);
    assert.ok(e.dose.text && e.dose.sets >= 1 && e.dose.reps >= 1 && e.dose.perWeek >= 1, `${e.id}: dosis incompleta`);
    assert.ok(e.muscles.length >= 1, `${e.id}: sin músculos`);
    for (const m of e.muscles) assert.ok(MUSCLES.has(m), `${e.id}: el músculo '${m}' no existe en el mapa`);
    assert.ok(e.bones.length >= 1 && e.joints.length >= 1, `${e.id}: faltan huesos o articulaciones`);
    assert.ok(e.precautions.length >= 1, `${e.id}: sin precauciones`);
  }
});

test('las cuatro temáticas pedidas tienen ejercicios y solo sentarse-pararse se monitorea (ADR-009)', () => {
  for (const t of THEMES) assert.ok(C.EXERCISES.some((e) => e.theme === t), `sin ejercicios en ${t}`);
  assert.deepEqual(C.EXERCISES.filter((e) => e.monitoring === 'auto').map((e) => e.id), ['sit-to-stand']);
  assert.ok(C.EXERCISES.every((e) => ['auto', 'guided'].includes(e.monitoring)));
});

test('la carga estimada sube con la flexión de rodilla y marca los abductores ante valgo', () => {
  const ex = C.get('sit-to-stand');
  const seated = B.estimateLoad(ex, { knee: 90, trunk: 30, valgusL: 0, valgusR: 0 });
  const standing = B.estimateLoad(ex, { knee: 5, trunk: 3, valgusL: 0, valgusR: 0 });
  assert.ok(seated.quadriceps > standing.quadriceps);
  assert.ok(seated['lower-back'] > standing['lower-back']);
  const valgus = B.estimateLoad(ex, { knee: 60, trunk: 20, valgusL: 15, valgusR: 0 });
  assert.ok(valgus.abductors > seated.abductors);
  for (const v of Object.values(seated)) assert.ok(v >= 0 && v <= 1);
  assert.deepEqual(B.alertMuscles('knee_valgus'), ['abductors', 'gluteal']);
});

test('los ejercicios guiados usan la carga fija del catálogo', () => {
  const ex = C.get('calf-raises');
  assert.deepEqual(Object.keys(B.estimateLoad(ex, { knee: 90 })).sort(), [...ex.muscles].sort());
});

test('con seguimiento, los músculos del catálogo se encienden con el avance del movimiento (ADR-014)', () => {
  const ex = C.get('standing-row');
  const rest = B.estimateLoad(ex, null, 0);
  const top = B.estimateLoad(ex, null, 1);
  assert.deepEqual(Object.keys(top).sort(), [...ex.muscles].sort());
  for (const m of ex.muscles) assert.ok(top[m] > rest[m] && top[m] <= 1 && rest[m] > 0);
  assert.ok(B.BONES.some((b) => b.name === 'Húmero'), 'el esqueleto en vivo incluye los brazos');
});
