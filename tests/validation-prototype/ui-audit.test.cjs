// Auditoría UI/UX (ADR-033): cabecera estable, tarjetas que caben en celular, cámara sin deformar y aviso de entorno.
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const ENV = require(path.join(SRC, 'env-banner.js'));
const PC = require(path.join(SRC, 'pose-camera.js'));
const CS = require(path.join(SRC, 'camera-setup.js'));
const I18N = require(path.join(SRC, 'i18n.js'));

test('entorno: Demo pública sin cuenta o como invitado; Plataforma clínica con la cuenta de esa página', () => {
  const e = (page, accounts = [], search = '') => ENV.envFor({ page, accounts, search });
  assert.deepEqual(e('/galeria.html'), { env: 'demo', role: null });
  assert.deepEqual(e('/index.html', ['guest']), { env: 'demo', role: null });
  assert.deepEqual(e('/doctor.html', ['guest']), { env: 'demo', role: null }, 'el invitado ve la muestra: sigue siendo demo');
  assert.deepEqual(e('/doctor.html', ['therapist']), { env: 'clinical', role: 'therapist' });
  assert.deepEqual(e('/paciente.html', ['patient']), { env: 'clinical', role: 'patient' });
  assert.deepEqual(e('/admin.html', ['admin']), { env: 'clinical', role: 'admin' });
  assert.deepEqual(e('/empresa.html', ['org']), { env: 'clinical', role: 'org' });
  assert.deepEqual(e('/seguimiento.html', ['patient'], '?ex=half-squat&plan=1'), { env: 'clinical', role: 'patient' });
  assert.deepEqual(e('/seguimiento.html', [], '?plan=1'), { env: 'demo', role: null }, 'sin cuenta, ?plan= no la vuelve clínica');
  assert.deepEqual(e('/doctor.html', ['patient']), { env: 'demo', role: null }, 'otra cuenta en la página del fisioterapeuta');
  assert.deepEqual(e('/login.html', ['therapist']), { env: null, role: null }, 'el login queda neutro');
});

test('el aviso de entorno está en las páginas, después de i18n, en los dos idiomas y sin red', () => {
  for (const page of ['index.html', 'galeria.html', 'seguimiento.html', 'doctor.html', 'paciente.html', 'admin.html', 'empresa.html']) {
    const html = read(page);
    const i = html.indexOf('<script src="i18n.js"></script>');
    const j = html.indexOf('<script src="env-banner.js"></script>');
    assert.ok(i > 0 && j > i, page);
  }
  assert.ok(!read('login.html').includes('env-banner.js'));
  const js = read('env-banner.js');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(js) && !js.includes('innerHTML'));
  for (const lang of ['es', 'en']) {
    I18N.use(lang);
    for (const k of ['env.demo.label', 'env.demo.text', 'env.demo.cta', 'env.clinical.label', 'env.clinical.text',
      'env.role.therapist', 'env.role.patient', 'env.role.admin', 'env.role.org', 'env.role.user']) {
      assert.notEqual(I18N.t(k), k, `${lang}: ${k}`);
    }
  }
  I18N.use('es');
  assert.ok(I18N.t('env.clinical.text', { role: I18N.t('env.role.therapist') }).includes('fisioterapeuta'));
});

test('cabecera estable: grilla marca | menú | idioma, sin saltos por la barra de scroll ni por el estado de los enlaces', () => {
  const css = read('hud.css');
  assert.ok(css.includes('html { scrollbar-gutter: stable; }'));
  assert.ok(css.includes('header.top-header { display: grid; grid-template-columns: minmax(0, 1fr) auto auto;'));
  assert.ok(css.includes('.top-nav { flex-wrap: nowrap; }'));
  assert.ok(css.includes('header.top-header { border-bottom-width: 2px; }'), 'mismo alto con y sin color de entorno');
  // El hover y la página actual no cambian el tamaño: borde siempre presente, sin transform ni cambio de peso.
  const nav = css.slice(css.indexOf('.top-nav a {'), css.indexOf('a:focus-visible'));
  assert.ok(nav.includes('border: 1px solid transparent') && !/transform|font-weight|padding/.test(nav.split('.top-nav a:hover')[1] || ''));
});

test('tarjetas en celular: figura y mapa lado a lado, sin subgrid en una columna', () => {
  const g = read('gallery.js');
  assert.ok(g.includes("guide.className = 'ex-fig'") && g.includes("map.className = 'ex-map'"));
  const css = read('hud.css');
  assert.ok(css.includes('.ex-card > .ex-fig { grid-column: 1;') && css.includes('.ex-card > .ex-map { grid-column: 2;'));
  assert.ok(css.includes('.card-grid > .ex-card, .card-grid > .ex-card:not(.patient-card) { grid-row: auto; grid-template-rows: none; }'));
});

test('cámara: el canvas mide lo mismo que el video y el cuadro toma su forma', async () => {
  const set = {};
  const viewport = { style: { setProperty: (k, v) => { set[k] = v; } } };
  const canvas = { width: 1280, height: 720 };
  assert.deepEqual(PC.sizeTo({ videoWidth: 480, videoHeight: 640 }, canvas, viewport), { w: 480, h: 640 });
  assert.deepEqual([canvas.width, canvas.height, set['--src-ratio']], [480, 640, '480 / 640']);
  const video = { videoWidth: 0, videoHeight: 0 };
  setTimeout(() => { video.videoWidth = 640; video.videoHeight = 480; }, 60);
  await PC.whenSized(video);
  assert.equal(video.videoWidth, 640, 'espera a que el video informe su tamaño');
  const p = read('pose-camera.js');
  assert.ok(p.includes('await whenSized(video)') && p.includes('video.onresize = fit'));
  assert.ok(read('hud.css').includes('.viewport.mirror { aspect-ratio: var(--src-ratio, 16 / 9); max-height: 75svh; margin-inline: auto; }'));
});

test('preparar la cámara sin nadie a la vista no falla (antes `t` tapaba la traducción)', () => {
  const check = CS.createCheck({ measures: CS.ENGINE.measures, need: CS.ENGINE.need, chosen: 'front' });
  let r;
  assert.doesNotThrow(() => { r = check.update(null, 1000, 16 / 9); });
  assert.equal(r.frame.ok, false);
  assert.equal(r.ready, false);
  assert.ok(r.frame.missing.length === 1 && r.frame.missing[0] !== 'camera.part.all', 'la parte faltante sale traducida');
});
