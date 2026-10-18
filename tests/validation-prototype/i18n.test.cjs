// Idioma de la interfaz según la región del navegador (ADR-030, TD-115): diccionarios, detección, elección manual y
// cobertura de las páginas y los scripts. Sin red ni DOM.
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'frontend', 'validation-prototype');
const DIR = path.join(SRC, 'i18n');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const I = require(path.join(SRC, 'i18n.js'));

const PACKS = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();
const PAGES = ['index.html', 'galeria.html', 'seguimiento.html', 'doctor.html', 'paciente.html', 'login.html', 'admin.html', 'empresa.html'];
const SCRIPTS = fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'i18n.js');
const LANGS = Object.keys(I.LANGS);

test('español e inglés activos, con su voz y su formato de fechas', () => {
  assert.deepEqual(LANGS, ['es', 'en']);
  assert.equal(I.BASE, 'es');
  assert.equal(I.STORE_KEY, 'axonfas.lang');
  assert.equal(I.LANGS.es.speech, 'es-PE');
  assert.equal(I.LANGS.en.speech, 'en-US');
  for (const l of LANGS) assert.ok(I.LANGS[l].name && I.LANGS[l].short && I.LANGS[l].locale, l);
});

test('cada paquete tiene exactamente las mismas claves en español y en inglés', () => {
  for (const f of PACKS) {
    const pack = require(path.join(DIR, f));
    for (const l of LANGS) {
      if (!pack[l] && pack.data) continue;   // paquete de datos (catálogo): lo revisa catalog.test.cjs
      assert.ok(pack[l], `${f}: falta el bloque ${l}`);
    }
    if (!pack.es) continue;
    const es = Object.keys(pack.es).sort(), en = Object.keys(pack.en).sort();
    assert.deepEqual(es.filter((k) => !(k in pack.en)), [], `${f}: claves sin inglés`);
    assert.deepEqual(en.filter((k) => !(k in pack.es)), [], `${f}: claves sin español`);
    for (const k of es) {
      assert.equal(typeof pack.es[k], 'string', `${f} ${k}`);
      assert.ok(pack.en[k].trim(), `${f} ${k}: inglés vacío`);
      // las mismas {variables} en los dos idiomas
      const vars = (s) => (s.match(/\{\w+\}/g) || []).sort();
      assert.deepEqual(vars(pack.en[k]), vars(pack.es[k]), `${f} ${k}: variables distintas`);
    }
  }
  assert.ok(I.keys('es').length > 300, 'la interfaz entera está en los diccionarios');
  assert.deepEqual(I.keys('es').sort(), I.keys('en').sort(), 'los dos diccionarios completos tienen las mismas claves');
});

test('ninguna clave se repite entre paquetes', () => {
  const seen = new Map();
  for (const f of PACKS) {
    const pack = require(path.join(DIR, f));
    for (const k of Object.keys(pack.es || {})) {
      assert.ok(!seen.has(k), `${k} está en ${seen.get(k)} y en ${f}`);
      seen.set(k, f);
    }
  }
});

test('cada página carga todos los diccionarios y i18n.js antes que sus scripts', () => {
  for (const page of PAGES) {
    const html = read(page);
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    const want = PACKS.map((f) => `i18n/${f}`);
    assert.deepEqual(srcs.slice(0, want.length + 1).sort(), [...want, 'i18n.js'].sort(), `${page}: diccionarios primero`);
    assert.equal(srcs[want.length], 'i18n.js', `${page}: i18n.js después de los diccionarios`);
    assert.ok(srcs.length > want.length + 1, page);
    assert.match(html, /<html lang="es"/, `${page}: el respaldo sin JS es español`);
  }
});

test('cada data-i18n de cada página existe en los dos idiomas', () => {
  let total = 0;
  for (const page of PAGES) {
    const html = read(page);
    const keys = [...html.matchAll(/\sdata-i18n(?:-[a-z-]+)?="([^"]+)"/g)].filter((m) => !m[0].includes('data-i18n-slot')).map((m) => m[1]);
    assert.ok(keys.length > 10, `${page}: casi sin marcar`);
    for (const k of keys) for (const l of LANGS) assert.ok(I.has(k, l), `${page}: falta "${k}" en ${l}`);
    // un {slot} del diccionario tiene su hijo data-i18n-slot en el HTML
    I.use('es');
    for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) {
      const vars = I.has(m[1]) ? I.t(m[1]).match(/\{\w+\}/g) || [] : [];
      for (const v of vars) assert.ok(html.includes(`data-i18n-slot="${v.slice(1, -1)}"`), `${page}: ${m[1]} sin el hijo ${v}`);
    }
    total += keys.length;
  }
  assert.ok(total > 300, `solo ${total} textos marcados en las páginas`);
});

test('cada t(), tn() y fill() literal de los scripts existe en los dos idiomas', () => {
  const missing = [];
  let total = 0;
  for (const f of SCRIPTS) {
    const js = read(f);
    for (const m of js.matchAll(/\b(?:t|tn|I18N\.t|I18N\.tn|AxonI18n\.t)\(\s*'([a-z][\w-]*\.[\w.-]+)'/g)) {
      total += 1;
      for (const l of LANGS) {
        const ok = I.has(m[1], l) || I.has(`${m[1]}.other`, l);
        if (!ok) missing.push(`${f}: ${m[1]} (${l})`);
      }
    }
    for (const m of js.matchAll(/\bfill\([^,()]+,\s*'([a-z][\w-]*\.[\w.-]+)'/g)) {
      total += 1;
      for (const l of LANGS) if (!I.has(m[1], l)) missing.push(`${f}: ${m[1]} (${l})`);
    }
    // claves armadas con una variable: el prefijo literal tiene que existir
    for (const m of js.matchAll(/\b(?:t|tn)\(\s*`([a-z][\w-]*\.[\w.-]*)\$\{/g)) {
      if (!I.keys('es').some((k) => k.startsWith(m[1]))) missing.push(`${f}: prefijo ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(total > 300, `solo ${total} textos de scripts pasan por t()`);
});

test('detección: es-* → español, otro idioma → inglés, la zona horaria solo desempata', () => {
  const d = (languages, timeZone) => I.detect({ languages, timeZone });
  assert.equal(d(['es-PE', 'es']), 'es');
  assert.equal(d(['es-419']), 'es');
  assert.equal(d(['es']), 'es');
  assert.equal(d(['ES-mx']), 'es', 'sin importar mayúsculas');
  assert.equal(d(['en-US', 'es-PE']), 'en', 'manda el primero del navegador');
  assert.equal(d(['en-GB']), 'en');
  assert.equal(d(['pt-BR']), 'en', 'un idioma que aún no tenemos ve inglés');
  assert.equal(d(['fr-FR', 'de']), 'en');
  assert.equal(d(['fr-FR', 'es-ES']), 'es', 'el primero que tengamos');
  assert.equal(d(['en-US'], 'America/Lima'), 'en', 'el idioma del navegador gana a la zona horaria');
  assert.equal(d([], 'America/Lima'), 'es', 'sin idiomas, la zona horaria');
  assert.equal(d([], 'America/Argentina/Buenos_Aires'), 'es');
  assert.equal(d([], 'Europe/Madrid'), 'es');
  assert.equal(d([], 'Europe/Berlin'), 'en');
  assert.equal(d([], 'America/New_York'), 'en');
  assert.equal(d(undefined, undefined), 'es', 'sin ninguna señal, el idioma base');
  assert.equal(d('es-CO'), 'es', 'navigator.language suelto');
});

test('la elección manual gana a la región y se recuerda en axonfas.lang', () => {
  assert.equal(I.detect({ stored: 'en', languages: ['es-PE'], timeZone: 'America/Lima' }), 'en');
  assert.equal(I.detect({ stored: 'es', languages: ['en-US'], timeZone: 'America/New_York' }), 'es');
  assert.equal(I.detect({ stored: 'xx', languages: ['es-PE'] }), 'es', 'un valor guardado que no existe no cuenta');
  const mem = {};
  const store = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  assert.equal(I.choose('en', { store, reload: false }), true);
  assert.equal(mem['axonfas.lang'], 'en');
  assert.equal(I.lang, 'en');
  assert.equal(I.detect({ stored: store.getItem('axonfas.lang'), languages: ['es-PE'] }), 'en');
  assert.equal(I.choose('klingon', { store, reload: false }), false);
  assert.equal(mem['axonfas.lang'], 'en');
  const broken = { setItem: () => { throw new Error('bloqueado'); } };
  assert.equal(I.choose('es', { store: broken, reload: false }), true, 'sin almacenamiento vale para esta vez');
  assert.equal(I.lang, 'es');
});

test('t(): variables, respaldo en español y plurales', () => {
  I.add({ es: { 'test.hi': 'Hola, {name}', 'test.only': 'solo español', 'test.rep.one': '{n} repetición', 'test.rep.other': '{n} repeticiones' },
    en: { 'test.hi': 'Hi, {name}', 'test.rep.one': '{n} rep', 'test.rep.other': '{n} reps' } });
  I.use('en');
  assert.equal(I.t('test.hi', { name: 'Ana' }), 'Hi, Ana');
  assert.equal(I.t('test.only'), 'solo español', 'lo que falta en inglés cae al español');
  assert.equal(I.t('test.nope'), 'test.nope');
  assert.equal(I.tn('test.rep', 1), '1 rep');
  assert.equal(I.tn('test.rep', 3), '3 reps');
  assert.equal(I.locale(), 'en-US');
  assert.equal(I.speechLang(), 'en-US');
  assert.equal(I.voiceFor([{ lang: 'es-PE' }, { lang: 'en-GB' }]).lang, 'en-GB');
  I.use('es');
  assert.equal(I.tn('test.rep', 1), '1 repetición');
  assert.equal(I.tn('test.rep', 0), '0 repeticiones');
  assert.equal(I.voiceFor([{ lang: 'en-US' }]), null);
});

test('selector accesible en la cabecera: botones con nombre, estado y foco visible', () => {
  const js = read('i18n.js');
  assert.ok(js.includes("setAttribute('role', 'group')") && js.includes("t('i18n.switch')"), 'grupo con nombre');
  assert.ok(js.includes("'aria-pressed'") && js.includes("b.lang = code"), 'estado y lang de cada opción');
  assert.ok(!js.includes('.innerHTML'), 'sin innerHTML');
  assert.ok(I.t('i18n.switch').includes('Idioma') && (I.use('en'), I.t('i18n.switch')).includes('Language'));
  I.use('es');
  const css = read('hud.css');
  assert.match(css, /\.lang-btn \{[^}]*min-height: 32px/, 'objetivo táctil ≥ 24 px (WCAG 2.5.8)');
  assert.match(css, /:where\(a, button[^)]*\):focus-visible/, 'foco visible global');
});

test('la voz, las fechas y los textos traducidos siguen el idioma (sin es-PE fijo ni innerHTML con texto)', () => {
  for (const f of SCRIPTS) {
    const js = read(f);
    assert.ok(!/\.lang = 'es-/.test(js), `${f}: voz con español fijo`);   // `lang = 'es'` solo marca texto del servidor
    assert.ok(!/toLocale(?:Date|Time)?String\('es-PE'/.test(js), `${f}: fecha con es-PE fijo`);
    for (const line of js.split('\n')) {
      if (/innerHTML\s*[+]?=/.test(line)) assert.ok(!/\bt\(|\btn\(/.test(line), `${f}: innerHTML con texto traducido: ${line.trim()}`);
    }
  }
});

test('textos de seguridad: urgencias con SAMU 106 y el número del país en los dos idiomas', () => {
  for (const l of LANGS) {
    const urgent = I.keys(l).filter((k) => /106/.test(((I.use(l), I.t(k)))));
    assert.ok(urgent.length > 0, `${l}: ningún texto cita el 106`);
    for (const k of urgent) {
      I.use(l);
      const s = I.t(k);
      assert.ok(l === 'es' ? /emergencias de tu país/.test(s) : /your country's emergency number/.test(s), `${l} ${k}: ${s}`);
    }
  }
  I.use('es');
});
