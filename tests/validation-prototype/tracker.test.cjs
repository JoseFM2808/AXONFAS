// Tests del seguimiento visual y conteo de la galería (ADR-014).
//   node --test "tests/validation-prototype/*.test.cjs"
// Las poses son una figura sintética de pie, de frente a la cámara, con ángulos conocidos (metros, y hacia abajo).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const T = require(path.join(SRC, 'tracker.js'));
const C = require(path.join(SRC, 'catalog.js'));

const FPS = 30;
const DT = 1000 / FPS;
const SEG = 0.42;   // muslo y pierna

/** Figura de pie. Opciones en grados: rodillas (squat = flexión simétrica, curlL/curlR = talón atrás), pie levantado
 *  (liftL, cm), inclinación de la cabeza (tilt), brazos levantados de lado (abdL/abdR) y visibilidad. */
function pose(o = {}) {
  const w = Array.from({ length: 33 }, () => ({ x: 0, y: -0.6, z: 0 }));
  const set = (i, x, y, z = 0) => { w[i] = { x, y, z }; };
  const rad = (d) => (d * Math.PI) / 180;
  const sq = rad((o.squat || 0) / 2);
  const drop = SEG - SEG * Math.cos(sq);                  // la cadera baja al flexionar las rodillas
  set(11, 0.18, -0.5 + drop); set(12, -0.18, -0.5 + drop);
  set(23, 0.1, drop); set(24, -0.1, drop);
  for (const [s, hip, kn, an, heel, toe, curl, lift] of [['L', 23, 25, 27, 29, 31, o.curlL, o.liftL], ['R', 24, 26, 28, 30, 32, o.curlR, 0]]) {
    const hx = w[hip].x;
    const up = (lift || 0) / 100;
    if (curl) {                                           // talón hacia el glúteo: rodilla quieta, tobillo atrás
      set(kn, hx, w[hip].y + SEG - up);
      set(an, hx, w[kn].y + SEG * Math.cos(rad(curl)), SEG * Math.sin(rad(curl)));
    } else {
      set(kn, hx, w[hip].y + SEG * Math.cos(sq) - up, -SEG * Math.sin(sq));
      set(an, hx, w[kn].y + SEG * Math.cos(sq), 0);
      w[an].y -= 0;                                       // tobillo en el suelo (o levantado con el pie)
    }
    set(heel, hx, w[an].y + 0.05, 0.05);
    set(toe, hx, w[an].y + 0.05, -0.12);
    void s;
  }
  // brazos colgando, o levantados de lado (abducción en el plano de la cámara)
  for (const [sh, el, wr, sign, abd] of [[11, 13, 15, 1, o.abdL || 0], [12, 14, 16, -1, o.abdR || 0]]) {
    const a = rad(abd);
    const ux = sign * Math.sin(a), uy = Math.cos(a);
    set(el, w[sh].x + ux * 0.28, w[sh].y + uy * 0.28);
    set(wr, w[sh].x + ux * 0.55, w[sh].y + uy * 0.55);
  }
  const t = rad(o.tilt || 0);                             // cabeza: orejas giradas en el plano frontal
  const head = { x: 0, y: w[11].y - 0.12 };
  set(0, head.x, head.y - 0.02, -0.08);
  set(7, head.x + 0.07 * Math.cos(t), head.y + 0.07 * Math.sin(t), 0.02);
  set(8, head.x - 0.07 * Math.cos(t), head.y - 0.07 * Math.sin(t), 0.02);
  const vis = o.vis == null ? 0.99 : o.vis;
  return { world: w, visibility: w.map(() => ({ visibility: vis })) };
}

/** Corre una lista de tramos [{ ms, pose: (k) => opciones }] y junta los eventos. k va de 0 a 1 dentro del tramo. */
function run(tracker, segments, t0 = 0) {
  let t = t0;
  const events = [];
  let last = null;
  for (const seg of segments) {
    const n = Math.max(1, Math.round(seg.ms / DT));
    for (let i = 0; i < n; i += 1) {
      const p = pose(seg.pose(i / (n - 1 || 1)));
      last = tracker.update({ t, world: p.world, visibility: p.visibility });
      events.push(...last.events);
      t += DT;
    }
  }
  return { events, last, t };
}

const still = (o = {}, ms = 1300) => ({ ms, pose: () => o });
const ramp = (key, from, to, ms) => ({ ms, pose: (k) => ({ [key]: from + (to - from) * k }) });
const types = (events) => events.map((e) => e.type);

test('cada ejercicio del catálogo tiene cómo seguirse con la cámara', () => {
  for (const e of C.EXERCISES) {
    const spec = T.SPECS[e.id];
    assert.ok(spec, `${e.id}: sin especificación de seguimiento`);
    assert.ok(T.METRICS[spec.metric], `${e.id}: medida desconocida ${spec.metric}`);
    assert.ok(['reps', 'hold', 'manual'].includes(spec.mode), `${e.id}: modo inválido`);
    if (spec.mode === 'reps') assert.ok(spec.delta > 0 && [-1, 0, 1].includes(spec.dir), `${e.id}: recorrido o sentido inválido`);
    if (spec.mode === 'hold') assert.ok(Number.isFinite(spec.threshold) && e.dose.hold > 0, `${e.id}: sostén sin umbral o sin tiempo`);
    if (spec.mode === 'manual') assert.ok(e.dose.hold > 0, `${e.id}: modo manual sin tiempo de sostén`);
    assert.ok(['good', 'limited'].includes(spec.quality), `${e.id}: calidad inválida`);
    if (spec.quality === 'limited') assert.ok(spec.note, `${e.id}: limitado sin explicar por qué`);
    assert.ok(spec.camera, `${e.id}: sin indicación de cámara`);
    if (T.METRICS[spec.metric].sided) assert.ok(['mean', 'active', 'both'].includes(spec.combine), `${e.id}: falta combinar lados`);
  }
  assert.equal(Object.keys(T.SPECS).length, C.EXERCISES.length, 'hay especificaciones de ejercicios que no existen');
});

test('las medidas leen bien una figura de pie y sus ángulos conocidos', () => {
  const m = (id, o) => { const p = pose(o); return T.measure(id, p.world, p.visibility); };
  assert.ok(Math.abs(m('kneeFlex').L.value) < 1);
  assert.ok(Math.abs(m('kneeFlex', { squat: 60 }).L.value - 60) < 1);
  assert.ok(Math.abs(m('kneeFlex', { curlR: 80 }).R.value - 80) < 1);
  assert.ok(Math.abs(m('trunkLean').value) < 1);
  assert.ok(m('thighSpread').value < 1);
  assert.ok(Math.abs(m('neckTilt').value) < 1);
  assert.ok(Math.abs(Math.abs(m('neckTilt', { tilt: 20 }).value) - 20) < 1);
  assert.ok(m('footLift').value < 0.5);
  assert.ok(Math.abs(m('footLift', { liftL: 8 }).value - 8) < 0.5);
  assert.ok(Math.abs(m('feetInLine').value - 100) < 1, 'pies al ancho de la cadera = 100 %');
  assert.equal(m('feetInLine', { liftL: 8 }).value, null, 'con un pie en el aire no es postura en tándem');
  assert.ok(Math.abs(m('shoulderElev', { abdL: 90 }).L.value - 90) < 15, 'brazo de lado ≈ 90°');
  assert.ok(Math.abs(m('crossArm').L.value - 90) < 5, 'brazo colgando ≈ 90°');
  assert.equal(m('kneeFlex', { vis: 0.2 }).L.conf, 0.2);
});

test('sentadilla parcial: referencia, sostén hasta 0 y fin', () => {
  const tr = T.createTracker(T.SPECS['half-squat'], { sets: 1, reps: 3, hold: 2 });
  const rep = (holdMs) => [ramp('squat', 0, 50, 700), still({ squat: 50 }, holdMs), ramp('squat', 50, 0, 700), still({}, 400)];
  const r = run(tr, [still(), ...rep(2300), ...rep(500), ...rep(2300), ...rep(2300)]);
  const ev = types(r.events);
  assert.equal(ev[0], 'ready', 'primero toma la referencia de pie');
  assert.equal(ev.filter((x) => x === 'rep').length, 3, 'la que sostuvo medio segundo no cuenta');
  assert.equal(ev.filter((x) => x === 'hold_done').length, 3, 'avisa al llegar a 0 en cada sostén completo');
  const short = r.events.find((e) => e.type === 'hold_short');
  assert.ok(short && short.needed === 2 && short.seconds < 1.5, 'avisa cuánto sostuvo y cuánto se pedía');
  assert.equal(ev[ev.length - 1], 'done');
  const reps = tr.reps;
  assert.ok(reps.every((x) => x.holdOk && x.holdSec >= 2), 'solo cuentan las que llegaron a 0');
  assert.ok(reps[0].peak > 45 && reps[0].peak < 55, `pico ${reps[0].peak}`);
  assert.equal(r.last.phase, 'done');
});

test('el sostén tolera cortes breves de la pose, pero bajar de verdad lo reinicia', () => {
  const up = ramp('squat', 0, 50, 600);
  const down = [ramp('squat', 50, 0, 600), still({}, 400)];
  // corte de 0,2 s a mitad del sostén: sigue contando y la repetición vale
  let tr = T.createTracker(T.SPECS['half-squat'], { sets: 1, reps: 5, hold: 2 });
  let r = run(tr, [still(), up, still({ squat: 50 }, 1100), still({ squat: 20 }, 200), still({ squat: 50 }, 1100), ...down]);
  assert.equal(r.last.count, 1);
  // bajar 0,8 s a la mitad del recorrido: la cuenta vuelve a empezar y no llega a 0
  tr = T.createTracker(T.SPECS['half-squat'], { sets: 1, reps: 5, hold: 2 });
  r = run(tr, [still(), up, still({ squat: 50 }, 1100), still({ squat: 20 }, 800), still({ squat: 50 }, 1100), ...down]);
  assert.equal(r.last.count, 0);
  assert.ok(types(r.events).includes('hold_short'));
});

test('un recorrido corto es una repetición incompleta y no cuenta', () => {
  const tr = T.createTracker(T.SPECS['half-squat'], { sets: 1, reps: 10, hold: 0 });
  const r = run(tr, [still(), ramp('squat', 0, 25, 600), ramp('squat', 25, 0, 600), still({}, 300)]);
  assert.deepEqual(types(r.events), ['ready', 'partial']);
  assert.equal(r.last.count, 0);
});

test('sin ver bien a la persona no se cuenta nada', () => {
  const tr = T.createTracker(T.SPECS['half-squat'], { sets: 1, reps: 10, hold: 0 });
  const blurry = (o) => ({ ms: 700, pose: () => ({ ...o, vis: 0.2 }) });
  const r = run(tr, [still(), blurry({ squat: 60 }), blurry({}), blurry({ squat: 60 }), blurry({})]);
  assert.equal(r.last.lowConfidence, true);
  assert.equal(r.last.count, 0);
});

test('flexión de rodilla de pie: cuenta la pierna que se mueve', () => {
  const tr = T.createTracker(T.SPECS['hamstring-curl'], { sets: 1, reps: 5, hold: 0 });
  const r = run(tr, [still(), ramp('curlR', 0, 80, 800), ramp('curlR', 80, 0, 800), still({}, 300)]);
  assert.equal(tr.reps.length, 1);
  assert.equal(tr.reps[0].side, 'R');
  assert.ok(r.events.some((e) => e.type === 'rep' && e.side === 'R'));
});

test('apoyo en un pie: cuenta el sostén completo y tolera cortes breves', () => {
  const tr = T.createTracker(T.SPECS['one-leg-stand'], { sets: 1, reps: 2, hold: 2 });
  const r = run(tr, [
    still({}, 300),
    still({ liftL: 10 }, 1000), still({}, 200), still({ liftL: 10 }, 1300),   // corte de 0,2 s: sigue el mismo sostén
    still({}, 800),
    still({ liftL: 10 }, 900), still({}, 800),                               // bajó antes de tiempo
  ]);
  const ev = types(r.events);
  assert.deepEqual(ev.filter((x) => x !== 'hold_start'), ['hold_done', 'rep', 'hold_short']);
  assert.equal(r.last.count, 1);
});

test('los ejercicios por lado cuentan los dos lados', () => {
  assert.deepEqual(T.targetFor(T.SPECS['neck-side-flexion'], { sets: 2, reps: 5, hold: 2 }),
    { sets: 2, perSet: 10, total: 20, hold: 2 });
  const tr = T.createTracker(T.SPECS['neck-side-flexion'], { sets: 1, reps: 1, hold: 0 });
  const r = run(tr, [still(), ramp('tilt', 0, 25, 500), ramp('tilt', 25, 0, 500), ramp('tilt', 0, -25, 500), ramp('tilt', -25, 0, 500), still({}, 200)]);
  const sides = r.events.filter((e) => e.type === 'rep').map((e) => e.side);
  assert.equal(sides.length, 2);
  assert.notEqual(sides[0], sides[1], 'un lado y el otro');
  assert.equal(r.last.phase, 'done');
});

test('modo manual: cuenta el sostén si la cámara sigue viendo a la persona', () => {
  const tr = T.createTracker(T.SPECS['abdominal-bracing'], { sets: 1, reps: 5, hold: 1 });
  let r = run(tr, [still({}, 300)]);
  assert.deepEqual(tr.startManualHold(r.t), [{ type: 'hold_start', seconds: 1 }]);
  r = run(tr, [still({}, 1200)], r.t);
  assert.deepEqual(types(r.events), ['hold_done', 'rep']);
  tr.startManualHold(r.t);
  r = run(tr, [{ ms: 2000, pose: () => ({ vis: 0.1 }) }], r.t);
  assert.deepEqual(types(r.events), ['hold_lost']);
  assert.equal(r.last.count, 1);
});

test('recalibrar vuelve a tomar la referencia', () => {
  const tr = T.createTracker(T.SPECS['half-squat'], { sets: 1, reps: 5, hold: 0 });
  let r = run(tr, [still()]);
  assert.equal(r.last.phase, 'active');
  tr.recalibrate();
  r = run(tr, [still({}, 200)], r.t);
  assert.equal(r.last.phase, 'setup');
  r = run(tr, [still({}, 1200)], r.t);
  assert.ok(types(r.events).includes('ready'));
});

test('sentarse y pararse en la galería: estirar una pierna no cuenta, pararse sí (TD-55)', () => {
  const tr = T.createTracker(T.SPECS['sit-to-stand'], { sets: 1, reps: 1, hold: 0 });
  const seated = { squat: 120 };
  const r = run(tr, [
    still(seated),
    still({ squat: 120, liftL: 40 }, 900), still(seated, 600),               // pierna izquierda arriba y abajo
    ramp('squat', 120, 0, 900), still({}, 500), ramp('squat', 0, 120, 900), still(seated, 400),
  ]);
  assert.equal(r.events.filter((e) => e.type === 'rep').length, 1, 'solo cuenta la vez que se paró');
  const m = T.measure('standHeight', pose({ squat: 120, liftL: 40 }).world, pose({}).visibility);
  assert.equal(m.value, null, 'con un pie en el aire la medida no vale');
});

test('sentadilla parcial: doblar una sola rodilla no cuenta', () => {
  const tr = T.createTracker(T.SPECS['half-squat'], { sets: 1, reps: 5, hold: 0 });
  const r = run(tr, [still(), ramp('curlR', 0, 80, 800), ramp('curlR', 80, 0, 800), still({}, 300)]);
  assert.equal(r.last.count, 0);
});

test('cada medida dice en qué plano se mueve y qué puntos hay que ver (ADR-015)', () => {
  for (const [id, m] of Object.entries(T.METRICS)) {
    assert.ok(['sagittal', 'frontal', 'transverse', 'vertical'].includes(m.plane), `${id}: plano`);
    assert.ok(Array.isArray(m.need) && m.need.length >= 2, `${id}: puntos`);
  }
});

test('la página de seguimiento sabe qué articulaciones resaltar en cada medida', () => {
  const src = require('node:fs').readFileSync(path.join(SRC, 'seguimiento.js'), 'utf8');
  for (const id of Object.keys(T.METRICS)) assert.ok(src.includes(`${id}: (`), `seguimiento.js no resalta '${id}'`);
});

// ------------------------------------------------------------------ meta de recorrido del plan (ADR-025, TD-99)
test('la meta del plan reemplaza el recorrido de la galería y el límite solo marca la repetición', () => {
  const base = T.SPECS['half-squat'];
  const spec = T.withGoal(base, { target: 20, limit: 40 });
  assert.equal(spec.delta, 20);
  assert.equal(spec.limit, 40);
  assert.equal(spec.galleryValue, base.delta);
  assert.equal(base.limit, undefined, 'no toca el spec de la galería');
  const tr = T.createTracker(spec, { sets: 1, reps: 2, hold: 0 });
  // 1.ª: 30° (llega a la meta de 20°, no al límite); 2.ª: 50° (pasa el límite de 40°).
  const rep = (deg) => [ramp('squat', 0, deg, 700), still({ squat: deg }, 200), ramp('squat', deg, 0, 700), still({}, 400)];
  const r = run(tr, [still(), ...rep(30), ...rep(50)]);
  assert.equal(types(r.events).filter((x) => x === 'rep').length, 2, 'con la meta del plan, 30° ya cuenta');
  const over = r.events.filter((e) => e.type === 'over_limit');
  assert.equal(over.length, 1, 'avisa una sola vez por repetición');
  assert.equal(over[0].limit, 40);
  assert.equal(tr.reps[0].overLimit, undefined);
  assert.equal(tr.reps[1].overLimit, true, 'cuenta igual y queda marcada');
  assert.equal(r.last.limit, 40);
  assert.equal(r.last.overLimitReps, 1);
  assert.ok(!types(r.events).some((x) => /alert|stop/.test(x)), 'pasar el límite no es una alerta (I-12)');
});

test('con la meta de la galería, 30° no llega y no hay límite', () => {
  const tr = T.createTracker(T.SPECS['half-squat'], { sets: 1, reps: 1, hold: 0 });
  const r = run(tr, [still(), ramp('squat', 0, 30, 700), still({ squat: 30 }, 200), ramp('squat', 30, 0, 700), still({}, 400)]);
  assert.equal(types(r.events).filter((x) => x === 'rep').length, 0);
  assert.equal(r.last.limit, null);
});

test('una meta inválida o de un ejercicio manual deja el spec de la galería', () => {
  const sq = T.SPECS['half-squat'];
  assert.equal(T.withGoal(sq, null), sq);
  assert.equal(T.withGoal(sq, { target: 40, limit: 30 }), sq, 'el límite tiene que ir más allá de la meta');
  assert.equal(T.withGoal(sq, { target: 'x', limit: 30 }), sq);
  assert.equal(T.withGoal(T.SPECS['abdominal-bracing'], { target: 5, limit: 10 }), T.SPECS['abdominal-bracing']);
  const tandem = T.SPECS['tandem-stance'];                 // sostén con dir -1: el límite va por debajo
  assert.equal(T.withGoal(tandem, { target: 40, limit: 50 }), tandem);
  assert.equal(T.withGoal(tandem, { target: 40, limit: 20 }).threshold, 40);
});

test('en un sostén, la meta del plan cambia el umbral y el límite se marca', () => {
  const spec = T.withGoal(T.SPECS['one-leg-stand'], { target: 3, limit: 6 });
  const tr = T.createTracker(spec, { sets: 1, reps: 2, hold: 1 });
  const r = run(tr, [still({}, 300), still({ liftL: 4 }, 1300), still({}, 600), still({ liftL: 9 }, 1300), still({}, 300)]);
  assert.equal(types(r.events).filter((x) => x === 'rep').length, 2, '4 cm ya sostiene con la meta de 3 cm');
  assert.equal(r.events.filter((e) => e.type === 'over_limit').length, 1);
  assert.deepEqual(tr.reps.map((x) => Boolean(x.overLimit)), [false, true]);
});
