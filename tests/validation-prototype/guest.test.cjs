// Invitado, muro de autenticación diferido y demo pública (TD-106, TD-107, TD-108, ADR-028). Solo datos sintéticos.
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const W = require(path.join(SRC, 'auth-wall.js'));
const D = require(path.join(SRC, 'demo-telemetry.js'));
const S = require(path.join(SRC, 'synthetic.js'));
const E = require(path.join(SRC, 'engine.js'));

test('el invitado no cuenta como cuenta: el muro mira solo cuentas de verdad', () => {
  assert.deepEqual(W.ACCOUNT_ROLES, ['therapist', 'patient', 'admin', 'org', 'user']);
  assert.ok(!W.ACCOUNT_ROLES.includes('guest'));
  assert.equal(W.bodyText('guardar tu progreso').includes('Para guardar tu progreso hace falta una cuenta'), true);
});

test('login ofrece entrar como invitado y el cliente conoce el rol', () => {
  assert.ok(read('login.html').includes('id="as-guest"'));
  assert.ok(read('login.js').includes("'/api/auth/guest'"));
  const api = read('api-client.js');
  assert.ok(api.includes("guest: 'axonfas.guest'") && api.includes("guest: 'galeria.html'"));
  assert.ok(api.includes("'axon:auth-required'"), 'un auth_required del servidor abre el muro');
  assert.ok(read('login.js').includes("A.save('guest', null)"), 'con una cuenta de verdad termina el modo invitado');
});

test('el muro y la barra de invitado están en las páginas que el invitado recorre', () => {
  for (const page of ['galeria.html', 'seguimiento.html', 'index.html', 'doctor.html', 'paciente.html']) {
    const html = read(page);
    assert.ok(html.indexOf('<script src="auth-wall.js">') > html.indexOf('<script src="api-client.js">'), page);
  }
  const js = read('auth-wall.js');
  assert.ok(js.includes("createElement('dialog')") && js.includes('aria-labelledby') && js.includes('showModal'));
  assert.ok(js.includes('Seguir explorando'), 'siempre se puede volver a mirar');
  assert.ok(!js.includes('innerHTML'));
});

test('el panel clínico de muestra es de solo lectura y la rutina libre es una vista previa', () => {
  assert.ok(read('doctor.js').includes("A.previewAs('therapist', 'guest')"));
  const seg = read('seguimiento.js');
  assert.ok(seg.includes('function previewEnds()') && seg.includes("W.require('hacer la rutina completa y guardar tu progreso')"));
});

test('la demo pública manda solo números, nunca puntos, video ni datos personales', () => {
  const session = E.createSession();
  const frames = S.generateSession({ seed: 11 });
  frames.forEach((f) => session.update({ t: f.t, world: f.world, visibility: f.image }));
  const detail = { source: 'demo', endReason: 'completed', endedAt: '2026-10-18T10:01:00Z', reps: session.reps, events: session.events };
  const out = D.summary(detail, '2026-10-18T10:00:00Z');
  assert.deepEqual(out, { source: 'demo', exercise_id: 'sit-to-stand', end_reason: 'completed', reps_done: 10, calibration_reps: 3,
    duration_s: 60, trunk_events: 1, valgus_events: 1, low_confidence_reps: 1 });
  assert.equal(D.summary({ source: 'video', endReason: 'x' }, null).source, 'demo');
  assert.equal(D.summary({ endReason: 'x' }, null).end_reason, 'user_quit');
  const js = read('demo-telemetry.js');
  assert.ok(js.includes("'/api/demo/runs'") && !js.includes('points') && !js.includes('image'));
  assert.ok(read('index.html').indexOf('demo-telemetry.js') > read('index.html').indexOf('app.js'));
  assert.ok(D.NOTE.includes('anónima') && D.NOTE.includes('Nunca el video'));
});

test('el Administrador ve la demo pública', () => {
  assert.ok(read('admin.html').includes('id="demo-runs"'));
  assert.ok(read('admin.js').includes("'/api/admin/demo-runs'"));
});
