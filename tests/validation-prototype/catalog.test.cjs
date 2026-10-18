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

// ── Idioma (ADR-030): el catálogo en inglés sale de i18n/catalog.en.js y se aplica sobre copias al cargar catalog.js.
test('en inglés, los 24 ejercicios tienen todos sus textos traducidos y lo clínico no cambia; en español queda idéntico', () => {
  const I = require(path.join(SRC, 'i18n.js'));
  const file = require.resolve(path.join(SRC, 'catalog.js'));
  const reload = (lang) => { I.use(lang); delete require.cache[file]; return require(file); };
  const EN = require(path.join(SRC, 'i18n', 'catalog.en.js')).data.catalog.en;
  const snapshot = JSON.stringify(C);
  const ES = reload('es');
  assert.equal(JSON.stringify(ES), snapshot, 'en español, el catálogo recargado es el mismo');
  const NO_PAIN = ES.NO_PAIN;
  assert.ok(NO_PAIN.startsWith('Detente si sientes dolor'), 'NO_PAIN expuesto');

  const en = reload('en');
  try {
    // Heurística: ni acentos ni palabras sueltas del español en los textos en inglés.
    const spanish = /[áéíóúñ¿¡]|\b(de|del|la|las|el|los|con|sin|y|una?|para|por|que)\b/i;
    const isEn = (s, where) => { assert.ok(typeof s === 'string' && s.trim(), `${where}: vacío`); assert.ok(!spanish.test(s), `${where}: parece español: ${s}`); };
    assert.equal(en.EXERCISES.length, 24);
    assert.equal(ES.EXERCISES.length, 24);
    for (const th of ES.THEMES) {
      const t = en.THEMES.find((x) => x.id === th.id);
      assert.ok(t && EN.themes[th.id], `${th.id}: temática sin inglés`);
      isEn(t.name, `${th.id}.name`); isEn(t.blurb, `${th.id}.blurb`);
    }
    assert.equal(en.NO_PAIN, EN.noPain);
    assert.match(en.NO_PAIN, /^Stop if you feel pain and tell your physiotherapist: the exercise should not hurt\.$/, 'misma fuerza que el español');
    for (const es of ES.EXERCISES) {
      const e = en.get(es.id);
      const tr = EN.exercises[es.id];
      assert.ok(e && tr, `${es.id}: sin inglés`);
      assert.equal(en.byId[es.id], e, `${es.id}: byId y get() apuntan a la copia traducida`);
      // lo que no es texto queda igual
      for (const k of ['id', 'theme', 'monitoring', 'sourceName']) assert.equal(e[k], es[k], `${es.id}.${k}`);
      assert.deepEqual(e.muscles, es.muscles, `${es.id}.muscles`);
      for (const k of ['sets', 'reps', 'hold', 'perWeek']) assert.equal(e.dose[k], es.dose[k], `${es.id}.dose.${k}`);
      assert.equal(e.source.url, es.source.url, `${es.id}: misma URL`);
      assert.equal(e.source.org, es.source.org, `${es.id}: misma organización`);
      // título de la fuente: igual, salvo la glosa en español entre paréntesis de CDC
      assert.equal(e.source.title, es.source.title.replace(/ \([^)]*\)$/, ''), `${es.id}: título de la fuente`);
      isEn(e.source.title, `${es.id}.source.title`);
      // textos: todos desde catalog.en.js, en inglés
      for (const k of ['name', 'goal', 'position']) { assert.equal(e[k], tr[k], `${es.id}.${k}`); isEn(e[k], `${es.id}.${k}`); }
      assert.equal(e.dose.text, tr.doseText, `${es.id}.doseText`);
      isEn(e.dose.text, `${es.id}.doseText`);
      if (es.camera == null) assert.equal(e.camera, null, `${es.id}: sin cámara`);
      else { assert.equal(e.camera, tr.camera, `${es.id}.camera`); isEn(e.camera, `${es.id}.camera`); }
      for (const k of ['steps', 'bones', 'joints', 'precautions']) {
        assert.ok(Array.isArray(tr[k]), `${es.id}.${k}: falta en catalog.en.js`);
        assert.equal(tr[k].length, es[k].length, `${es.id}.${k}: largo distinto al español`);
        assert.deepEqual(e[k], tr[k], `${es.id}.${k}`);
        e[k].forEach((s, i) => isEn(s, `${es.id}.${k}[${i}]`));
      }
      // la precaución de dolor va traducida en su misma posición
      es.precautions.forEach((p, i) => {
        if (p === NO_PAIN) assert.equal(e.precautions[i], en.NO_PAIN, `${es.id}.precautions[${i}]: NO_PAIN en su lugar`);
        else assert.notEqual(e.precautions[i], en.NO_PAIN, `${es.id}.precautions[${i}]`);
      });
      // los mareos siguen deteniendo el ejercicio en inglés
      if (es.precautions.some((p) => /Detente si te mareas/.test(p))) assert.ok(e.precautions.some((p) => /Stop if you feel dizzy/.test(p)), `${es.id}: mareo`);
      // las cifras de la dosis no cambian al traducir
      const nums = (s) => (s.match(/\d+/g) || []).join(' ');
      assert.equal(nums(e.dose.text), nums(es.dose.text), `${es.id}: cifras de la dosis`);
    }
    assert.deepEqual(Object.keys(EN.exercises).sort(), ES.EXERCISES.map((x) => x.id).sort(), 'catalog.en.js no trae ejercicios de más');
  } finally {
    const back = reload('es');
    assert.equal(JSON.stringify(back), snapshot, 'al volver al español el catálogo es idéntico al original');
    assert.equal(JSON.stringify(C), snapshot, 'traducir no muta el catálogo original');
  }
});

test('el mapa muscular nombra músculos, vistas y huesos en el idioma de la página; los ids no cambian (ADR-030)', () => {
  const I = require(path.join(SRC, 'i18n.js'));
  const file = require.resolve(path.join(SRC, 'body-map.js'));
  I.use('en');
  delete require.cache[file];
  try {
    const BE = require(file);
    assert.deepEqual(Object.keys(BE.NAMES).sort(), Object.keys(B.NAMES).sort(), 'los mismos ids de músculo');
    for (const m of MUSCLES) assert.ok(BE.NAMES[m] && !/[áéíóúñ]/i.test(BE.NAMES[m]), `${m}: sin nombre en inglés`);
    assert.deepEqual(BE.BONES.map((b) => [b.a, b.b]), B.BONES.map((b) => [b.a, b.b]), 'los mismos segmentos');
    assert.ok(BE.BONES.some((b) => b.name === 'Humerus'));
    assert.deepEqual(BE.muscleNames(['left-soleus', 'right-soleus']), ['Soleus'], 'el sóleo de los dos lados es un solo nombre');
    assert.deepEqual(BE.estimateLoad(C.get('sit-to-stand'), { knee: 90, trunk: 30 }), B.estimateLoad(C.get('sit-to-stand'), { knee: 90, trunk: 30 }));
  } finally {
    I.use('es');
    delete require.cache[file];
  }
});
