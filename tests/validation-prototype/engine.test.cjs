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

// ---------------------------------------------------------------- valgo en el marco de la pelvis (ADR-024, TD-96)

/** Gira una pose alrededor de la vertical (cámara en diagonal), la escala y la traslada. */
function transform(pts, { yawDeg = 0, scale = 1, dx = 0, dz = 0 } = {}) {
  const c = Math.cos((yawDeg * Math.PI) / 180), s = Math.sin((yawDeg * Math.PI) / 180);
  return pts.map((p) => ({ x: (p.x * c + p.z * s) * scale + dx, y: p.y * scale, z: (p.z * c - p.x * s) * scale + dz, visibility: p.visibility }));
}
/** El proxy anterior (marco de la cámara), para comparar. */
const legacyL = (pts) => E.valgusProxy(pts[23], pts[25], pts[27], pts[24]);

test('normalizar: caderas en x = ±0,5, origen en su punto medio y sin giro', () => {
  const { points, hipWidth, yawDeg } = E.normalizeSkeleton(transform(pose(), { yawDeg: 20, scale: 1.3, dx: 0.4, dz: -2 }));
  near(points[23].x, 0.5, 1e-9, 'cadera izquierda');
  near(points[24].x, -0.5, 1e-9, 'cadera derecha');
  near(points[23].z, 0, 1e-9, 'sin profundidad entre caderas');
  near(points[23].y, 0, 1e-9, 'origen a la altura de la cadera');
  near(hipWidth, 0.26, 1e-9, 'ancho de cadera en metros (0,2 × 1,3)');
  near(Math.abs(yawDeg), 20, 1e-9, 'giro detectado');
});

test('el valgo no cambia con la estatura, la distancia ni la posición en la imagen', () => {
  const base = E.computeAngles(pose({ shiftL: 0.08 })).valgusL;
  for (const t of [{ scale: 0.6 }, { scale: 1.5 }, { dx: 0.7 }, { dz: -1.5 }, { scale: 0.8, dx: -0.3, dz: 1 }]) {
    near(E.computeAngles(transform(pose({ shiftL: 0.08 }), t)).valgusL, base, 1e-6, JSON.stringify(t));
  }
});

test('con la cámara en diagonal el valgo ya no se achica (el proxy anterior perdía el coseno del giro)', () => {
  const front = pose({ shiftL: 0.08 });
  const base = E.computeAngles(front).valgusL;
  for (const yawDeg of [15, 30, 45, -30]) {
    const turned = transform(front, { yawDeg });
    near(E.computeAngles(turned).valgusL, base, 0.05, `giro ${yawDeg}°`);
  }
  const turned30 = transform(front, { yawDeg: 30 });
  assert.ok(base - legacyL(turned30) > 1, `el proxy anterior subestima: ${legacyL(turned30).toFixed(1)}° vs ${base.toFixed(1)}°`);
});

test('el giro corregido se limita a ±45°; de espaldas se mide igual que de frente', () => {
  const front = pose({ shiftL: 0.08 });
  const side = E.computeAngles(transform(front, { yawDeg: 70 }));
  near(Math.abs(side.pelvisYaw), 45, 1e-9, 'giro aplicado limitado');
  near(Math.abs(side.rawPelvisYaw), 70, 1e-6, 'giro real');
  assert.ok(Number.isFinite(side.valgusL));
  const back = E.computeAngles(transform(front, { yawDeg: 180 }));
  near(back.pelvisYaw, 0, 1e-6, 'de espaldas = el mismo plano frontal');
  near(back.valgusL, E.computeAngles(front).valgusL, 1e-6, 'valgo de espaldas');
});

test('demo con la cámara en diagonal: las mismas alertas y el mismo pico de valgo que de frente', () => {
  const runYaw = (yawDeg) => {
    const session = E.createSession();
    S.generateSession({ seed: 11, yawDeg }).forEach((f) => session.update({ t: f.t, world: f.world, visibility: f.image }));
    return session;
  };
  const front = runYaw(0), diag = runYaw(30);
  const key = (s) => s.events.map((e) => `${e.rep}:${e.type}${e.side ? ':' + e.side : ''}`);
  assert.deepEqual(key(diag), ['5:trunk_flexion', '7:knee_valgus:left']);
  near(diag.reps[6].peakValgusL, front.reps[6].peakValgusL, 1.5, 'pico de valgo de la repetición 7');
  near(diag.snapshot().baseline.valgusL, front.snapshot().baseline.valgusL, 1.5, 'línea base de valgo');
});

test('la voz de cada alerta dice qué pasa, de qué lado y qué hacer (TD-97)', () => {
  const app = require('node:fs').readFileSync(path.join(SRC, 'app.js'), 'utf8');
  assert.ok(app.includes("knee_valgus_left: 'Tu rodilla izquierda se está yendo hacia adentro: llévala hacia afuera'"));
  assert.ok(app.includes("knee_valgus_right: 'Tu rodilla derecha se está yendo hacia adentro: llévala hacia afuera'"));
  assert.ok(app.includes("trunk_flexion: 'Te estás inclinando mucho hacia adelante: sube el pecho'"));
  assert.ok(app.includes('speak(VOICE[key] || phrase'), 'la alerta habla con la frase situacional');
});
