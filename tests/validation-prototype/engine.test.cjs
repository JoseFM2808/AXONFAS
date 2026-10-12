// Tests del motor del prototipo de validación (TD-28). Solo datos sintéticos (ADR-010).
//   node --test tests/validation-prototype/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const E = require(path.join(SRC, 'engine.js'));
const S = require(path.join(SRC, 'synthetic.js'));

/** Pose de un frame armada a mano (coordenadas MediaPipe: y hacia abajo). */
function pose({ kneeFlex = 0, trunk = 0, shiftL = 0, shiftR = 0, vis = 0.95 } = {}) {
  const pts = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const k = (kneeFlex * Math.PI) / 180;
  const f = (trunk * Math.PI) / 180;
  const leg = (side, shift) => {
    const x = 0.1 * side;
    return {
      ankle: { x, y: 0.88, z: 0 },
      knee: { x: x - side * shift, y: 0.45, z: 0 },
      hip: { x, y: 0.45 - 0.45 * Math.cos(k), z: 0.45 * Math.sin(k) },   // el muslo rota hacia atrás
    };
  };
  const L = leg(1, shiftL), R = leg(-1, shiftR);
  const hipY = (L.hip.y + R.hip.y) / 2, hipZ = (L.hip.z + R.hip.z) / 2;
  const sh = { y: hipY - 0.5 * Math.cos(f), z: hipZ - 0.5 * Math.sin(f) };
  const put = (i, p) => { pts[i] = { x: p.x, y: p.y, z: p.z, visibility: vis }; };
  put(11, { x: 0.18, ...sh }); put(12, { x: -0.18, ...sh });
  put(23, L.hip); put(24, R.hip); put(25, L.knee); put(26, R.knee); put(27, L.ankle); put(28, R.ankle);
  return pts;
}

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual.toFixed(2)} vs ${expected} ±${tol}`);

test('ángulos de una persona de pie y erguida', () => {
  const a = E.computeAngles(pose());
  near(a.knee, 0, 0.5, 'rodilla');
  near(a.trunk, 0, 0.5, 'tronco');
  near(a.valgusL, 0, 0.5, 'valgo izq');
  near(a.valgusR, 0, 0.5, 'valgo der');
  near(a.confidence, 0.95, 1e-9, 'confianza');
});

test('flexión de rodilla y de tronco conocidas', () => {
  near(E.computeAngles(pose({ kneeFlex: 90 })).knee, 90, 0.5, 'rodilla a 90°');
  near(E.computeAngles(pose({ kneeFlex: 45 })).knee, 45, 0.5, 'rodilla a 45°');
  near(E.computeAngles(pose({ trunk: 30 })).trunk, 30, 0.5, 'tronco a 30°');
});

test('el valgo es positivo hacia la línea media y negativo hacia afuera, en ambos lados', () => {
  const inL = E.computeAngles(pose({ shiftL: 0.08 }));
  const inR = E.computeAngles(pose({ shiftR: 0.08 }));
  const outL = E.computeAngles(pose({ shiftL: -0.08 }));
  assert.ok(inL.valgusL > 5 && Math.abs(inL.valgusR) < 0.5, 'rodilla izquierda hacia adentro');
  assert.ok(inR.valgusR > 5 && Math.abs(inR.valgusL) < 0.5, 'rodilla derecha hacia adentro');
  assert.ok(outL.valgusL < -5, 'rodilla izquierda hacia afuera = varo');
});

test('la confianza es la menor visibilidad de los puntos clave', () => {
  const pts = pose();
  pts[26] = { ...pts[26], visibility: 0.3 };
  near(E.computeAngles(pts).confidence, 0.3, 1e-9, 'confianza');
});

function run(script, config) {
  const session = E.createSession(config);
  const outs = S.generateSession({ script, seed: 11 }).map((f) => session.update({ t: f.t, world: f.world, visibility: f.image }));
  return { session, outs };
}

test('sesión demo completa: calibra, detecta cada compensación una vez y no da falsas alarmas', () => {
  const { session } = run(S.DEFAULT_SCRIPT);
  const snap = session.snapshot();
  assert.equal(snap.phase, 'ended');
  assert.equal(snap.endReason, 'completed');
  assert.equal(session.reps.length, 10);
  assert.ok(snap.baseline, 'línea base calculada');
  near(snap.baseline.knee, 92, 2, 'línea base de rodilla');
  near(snap.baseline.trunk, 30.6, 2, 'línea base de tronco');

  const events = session.events.map((e) => `${e.rep}:${e.type}${e.side ? ':' + e.side : ''}`);
  assert.deepEqual(events, ['5:trunk_flexion', '7:knee_valgus:left']);
  for (const e of session.events) assert.ok(e.severity >= 1 && e.severity <= 3);

  const reps = session.reps;
  assert.ok(reps.slice(0, 3).every((r) => r.calibration), 'las 3 primeras son de calibración');
  assert.ok(reps.slice(3).every((r) => r.romReached === true), 'el rango pedido se alcanza en el ejercicio');
  assert.ok(reps[7].lowConfidenceRatio > 0.2, 'la repetición 8 queda marcada con baja confianza');
});

test('sin el rango pedido no hay alerta, aunque el tronco compense', () => {
  const script = [{}, {}, {}, { kneeSeatedDeg: 75, trunkExtraDeg: 22 }, {}];
  const { session } = run(script, { maxReps: 5 });
  const rep4 = session.reps[3];
  assert.equal(rep4.romReached, false);
  assert.equal(session.events.length, 0);
});

test('los márgenes del terapeuta mueven el umbral', () => {
  const { session } = run(S.DEFAULT_SCRIPT, { trunkMarginDeg: 30, valgusMarginDeg: 25 });
  assert.equal(session.events.length, 0, 'con márgenes amplios no se alerta');
});

test('una repetición de calibración con mala visibilidad no cuenta y se repite', () => {
  const script = [{}, { lowConfidence: true }, {}, {}, {}];
  const { session, outs } = run(script, { maxReps: 4 });
  assert.ok(outs.some((o) => o.completed && o.completed.discarded), 'se descartó una');
  assert.ok(session.reps.slice(0, 3).every((r) => r.validForCalibration));
  assert.equal(session.reps.length, 4);
});

test('el botón de dolor termina la sesión y deja de evaluar', () => {
  const session = E.createSession();
  const frames = S.generateSession({ seed: 3 });
  frames.slice(0, 200).forEach((f) => session.update({ t: f.t, world: f.world, visibility: f.image }));
  session.end('pain_stop');
  const after = session.update({ t: 99999, world: frames[300].world, visibility: frames[300].image });
  assert.equal(after.phase, 'ended');
  assert.equal(after.endReason, 'pain_stop');
  assert.equal(after.angles, null);
});

/** Sentado (rodillas a 90°) con la pierna izquierda estirada hacia adelante en una fracción `e` (0 = apoyada). */
function seatedOneLeg(e) {
  const pts = pose({ kneeFlex: 90 });
  const s = Math.min(1, Math.max(0, e));
  // la tibia izquierda gira desde vertical (tobillo en el suelo) hasta quedar en línea con el muslo (hacia la cámara)
  const a = (s * Math.PI) / 2;
  pts[27] = { x: 0.1, y: 0.45 + 0.43 * Math.cos(a), z: -0.43 * Math.sin(a), visibility: 0.95 };
  return pts;
}

/** Sesión a mano: lista de [ms, pose] a 30 fps. */
function runPoses(segments, config) {
  const session = E.createSession(config);
  const outs = [];
  let t = 0;
  segments.forEach(([ms, make]) => {
    const n = Math.round(ms / 33);
    for (let i = 0; i < n; i += 1) {
      const pts = make(n > 1 ? i / (n - 1) : 1);
      outs.push(session.update({ t, world: pts, visibility: pts }));
      t += 33;
    }
  });
  return { session, outs };
}

test('levantar una pierna sentado no cuenta como pararse (TD-55)', () => {
  const a = E.computeAngles(seatedOneLeg(1));
  assert.ok(a.knee < 65, 'el promedio de rodillas sí baja: por eso antes contaba');
  assert.ok(a.hipHeight < 0.6 && a.feetLevel > 0.4, 'la cadera no sube y un tobillo queda en el aire');
  const cycle = [[600, () => seatedOneLeg(0)], [600, (k) => seatedOneLeg(k)], [500, () => seatedOneLeg(1)], [600, (k) => seatedOneLeg(1 - k)]];
  const { session, outs } = runPoses([...cycle, ...cycle, ...cycle]);
  assert.equal(session.reps.length, 0, 'ninguna repetición');
  const aborted = outs.filter((o) => o.aborted).map((o) => o.aborted.reason);
  assert.deepEqual(aborted, ['one_leg', 'one_leg', 'one_leg'], 'avisa que fue con una pierna');
});

test('pararse a medias no cuenta y avisa que no llegó arriba', () => {
  const half = (k) => pose({ kneeFlex: 90 - 45 * k });                   // sube solo hasta 45° de rodilla
  const back = (k) => pose({ kneeFlex: 45 + 45 * k });
  const { session, outs } = runPoses([[600, () => pose({ kneeFlex: 90 })], [700, half], [400, () => pose({ kneeFlex: 45 })], [700, back]]);
  assert.equal(session.reps.length, 0);
  assert.equal(outs.find((o) => o.aborted).aborted.reason, 'not_standing');
});

test('de pie de verdad exige las dos rodillas estiradas, la cadera arriba y los dos pies en el suelo', () => {
  const standing = E.computeAngles(pose({ kneeFlex: 0 }));
  near(standing.hipHeight, 1, 0.02, 'de pie, la cadera está a un largo de pierna de los tobillos');
  near(standing.feetLevel, 0, 0.01, 'pies al mismo nivel');
  const seated = E.computeAngles(pose({ kneeFlex: 90 }));
  near(seated.hipHeight, 0.49, 0.03, 'sentado, a la mitad');
  // la demo sigue contando sus 10 repeticiones reales
  const { session } = run(S.DEFAULT_SCRIPT);
  assert.equal(session.reps.length, 10);
});

test('una compensación que la cámara no ve bien no se evalúa (ADR-015)', () => {
  const { session } = run(S.DEFAULT_SCRIPT, { disabled: { valgus: true } });
  const events = session.events.map((e) => e.type);
  assert.deepEqual(events, ['trunk_flexion'], 'el valgo no alerta con la cámara de lado; el tronco sí');
});
