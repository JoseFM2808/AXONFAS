// Tests de las sugerencias por rol (ADR-017).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const S = require(path.join(SRC, 'suggestions.js'));
const C = require(path.join(SRC, 'catalog.js'));

const plan = [
  { exercise_id: 'sit-to-stand', sets: 1, reps: 10, per_week: 3 },
  { exercise_id: 'hip-bridge', sets: 1, reps: 5, per_week: 7 },
  { exercise_id: 'one-leg-stand', sets: 1, reps: 3, per_week: 3 },
];

test('cada ejercicio del catálogo dice qué exige (postura, equilibrio, banda, zonas)', () => {
  for (const e of C.EXERCISES) assert.ok(S.NEEDS[e.id], `${e.id} sin entrada en NEEDS`);
  assert.equal(Object.keys(S.NEEDS).length, C.EXERCISES.length);
});

test('los ids del perfil son los mismos que valida la API', () => {
  const py = fs.readFileSync(path.join(SRC, '..', '..', 'backend', 'staging_api.py'), 'utf8');
  const limits = py.match(/PROFILE_LIMITS = \{([^}]*)\}/)[1].match(/"([a-z_]+)"/g).map((x) => x.slice(1, -1)).sort();
  const areas = py.match(/PAIN_AREAS = \{([^}]*)\}/)[1].match(/"([a-z_]+)"/g).map((x) => x.slice(1, -1)).sort();
  assert.deepEqual(S.LIMITS.map((x) => x.id).sort(), limits);
  assert.deepEqual(S.PAIN_AREAS.map((x) => x.id).sort(), areas);
});

test('el encaje con el perfil bloquea lo imposible y avisa lo que pide cuidado', () => {
  assert.deepEqual(S.fit('hip-bridge', { limitations: ['no_floor'] }).blocks, ['se hace en el suelo']);
  assert.ok(S.fit('bird-dog', { limitations: ['no_kneel'] }).blocks.includes('se apoya en las rodillas'));
  assert.equal(S.fit('one-leg-stand', { limitations: ['walking_aid'] }).ok, false, 'apoyo en un pie con andador: no');
  assert.equal(S.fit('tandem-stance', { limitations: ['balance'] }).ok, true, 'tándem con problemas de equilibrio: con precaución');
  assert.ok(S.fit('half-squat', { pain_areas: ['knee'] }).cautions.some((c) => c.includes('rodilla')));
  assert.equal(S.fit('leg-extension', null).ok, true, 'sin perfil, todo encaja');
  for (const id of S.alternatives('hip-bridge', { limitations: ['no_floor'] })) {
    assert.ok(S.fit(id, { limitations: ['no_floor'] }).ok, `${id} no debería sugerirse`);
  }
});

test('sugerencias para el fisioterapeuta: cambios por limitaciones, dolor y datos; nada se aplica solo', () => {
  const out = S.forTherapist({
    profile: { limitations: ['no_floor', 'balance'], pain_areas: ['knee'] }, plan,
    metrics: { sessions_total: 3, per_exercise: [{ exercise_id: 'one-leg-stand', done_7d: 0, per_week: 3, ratio: 0 }] },
    sessions: [{ exercise_id: 'sit-to-stand', end_reason: 'pain_stop' }], events: [{ type: 'knee_valgus' }, { type: 'knee_valgus' }],
  });
  const ids = out.map((s) => s.id);
  assert.ok(ids.includes('swap-hip-bridge'), 'el puente es en el suelo');
  assert.ok(ids.includes('swap-one-leg-stand'), 'apoyo en un pie con problemas de equilibrio');
  assert.ok(ids.includes('pain-sit-to-stand'));
  assert.ok(!ids.includes('caution-sit-to-stand'), 'una sola sugerencia de dosis por ejercicio');
  assert.ok(ids.includes('add-knee_valgus'));
  for (const s of out) {
    assert.ok(s.because && s.title, `${s.id}: toda sugerencia dice por qué`);
    if (s.action && s.action.type === 'swap') assert.ok(S.fit(s.action.to, { limitations: ['no_floor', 'balance'] }).ok);
    if (s.action && s.action.type === 'add') s.action.exercise_ids.forEach((id) => assert.ok(!plan.some((p) => p.exercise_id === id)));
  }
  assert.deepEqual(out.map((s) => s.priority), [...out.map((s) => s.priority)].sort((a, b) => a - b), 'primero lo urgente');
  const old = new Date(Date.now() - 10 * 864e5).toISOString();
  const adh = (since) => S.forTherapist({ profile: null, plan: [{ exercise_id: 'calf-raises', sets: 2, reps: 10, per_week: 6, since }],
    metrics: { sessions_total: 2, per_exercise: [{ exercise_id: 'calf-raises', done_7d: 1, per_week: 6, ratio: 0.17 }] }, sessions: [], events: [] });
  assert.ok(adh(old).some((s) => s.id === 'adherence-calf-raises' && s.action.value === 3));
  assert.ok(!adh(new Date().toISOString()).some((s) => s.id.startsWith('adherence')), 'un ejercicio recién indicado no se juzga');
  const empty = S.forTherapist({ profile: null, plan: [], metrics: {}, sessions: [], events: [] });
  assert.deepEqual(empty.map((s) => s.id), ['profile-missing']);
});

test('consejos para el usuario: de uso, sin cambios de dosis y respetando su perfil', () => {
  const tips = S.forUser({ page: 'patient', profile: { limitations: ['no_floor', 'low_vision'] }, plan: plan.map((p) => ({ ...p, done_7d: 0 })) });
  assert.ok(tips.every((t) => !t.action), 'el usuario nunca recibe una acción sobre su plan');
  assert.ok(tips.some((t) => t.id === 'talk-hip-bridge' && t.text.includes('fisioterapeuta')), 'lo que no puede hacer, a su fisioterapeuta');
  assert.ok(!tips.some((t) => t.id === 'next' && t.text.includes('Puente')), 'no le propone hacer lo que no puede');
  assert.ok(tips.some((t) => t.id === 'voice'));
  const session = S.forUser({ page: 'session', session: { count: 3, total: 10, partials: 3, shortHolds: 1, lowConfidenceRatio: 0.4, view: 'side', recommended: 'front' } });
  assert.deepEqual(session.map((t) => t.id), ['partials', 'holds', 'light', 'view']);
  assert.ok(S.forUser({ page: 'gallery' }).some((t) => t.id === 'hover'));
});

test('las páginas cargan el módulo y marcan regiones, saltos y estados para lectores de pantalla', () => {
  const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const page of ['galeria.html', 'paciente.html', 'doctor.html', 'seguimiento.html']) {
    const html = read(page);
    assert.ok(html.includes('<script src="suggestions.js"></script>'), `${page} sin suggestions.js`);
  }
  for (const page of ['index.html', 'galeria.html', 'paciente.html', 'doctor.html', 'seguimiento.html']) {
    const html = read(page);
    assert.ok(html.includes('class="skip-link"'), `${page}: falta "Saltar al contenido"`);
    assert.equal((html.match(/<main\b/g) || []).length, 1, `${page}: una sola región principal`);
    assert.ok(!/<div class="table-wrap">/.test(html), `${page}: toda tabla con scroll debe poder enfocarse (tabindex y nombre)`);
    assert.ok(html.includes('lang="es"'));
  }
  const css = read('hud.css');
  assert.ok(css.includes(':focus-visible') && css.includes('prefers-reduced-motion') && css.includes('forced-colors'));
  const tokens = fs.readFileSync(path.join(SRC, '..', '..', '..', 'docs', 'design-system', 'tokens.css'), 'utf8');
  assert.ok(tokens.includes('--alert-ink') && tokens.includes('--alert-strong'));
});

test('una molestia reciente propone revisar la dosis, sin aplicarla (ADR-018, I-13)', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const day = 864e5;
  const calf = [{ exercise_id: 'calf-raises', sets: 2, reps: 10, per_week: 6 }];
  const rep = (over) => ({ exercise_id: 'calf-raises', kind: 'discomfort', category: 'fatigue', action: 'paused',
    reported_at: new Date(now - day).toISOString(), ...over });
  const find = (symptoms, plan = calf) => S.forTherapist({ profile: null, plan, metrics: {}, sessions: [], events: [], symptoms, now })
    .find((s) => s.id === 'discomfort-calf-raises');
  const one = find([rep()]);
  assert.equal(one.priority, 2);
  assert.equal(one.action.value, 7);
  assert.equal(one.action.field, 'reps');
  assert.equal(find([rep(), rep()]).priority, 1);
  assert.equal(find([rep({ kind: 'red_flag', category: 'red_flag', action: 'session_stopped' })]).priority, 1);
  assert.equal(find([rep({ reported_at: new Date(now - 15 * day).toISOString() })]), undefined);
  assert.equal(find([rep()], []).action, undefined, 'fuera del plan no hay acción');
  const single = find([rep()], [{ exercise_id: 'calf-raises', sets: 2, reps: 1, per_week: 6 }]);
  assert.equal(single.action, undefined, 'con 1 repetición no se propone "1 en vez de 1"');
  assert.ok(!single.detail.includes('en vez de'));
  const before = JSON.stringify(calf);
  find([rep()]);
  assert.equal(JSON.stringify(calf), before);
  const general = S.forTherapist({ profile: null, plan: [], metrics: {}, sessions: [], events: [], now,
    symptoms: [rep({ exercise_id: null })] }).find((s) => s.id === 'discomfort-general');
  assert.equal(general.priority, 2);
  assert.equal(general.action, undefined);
});
