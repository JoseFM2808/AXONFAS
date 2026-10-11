/* AXONFAS · sesiones sintéticas de sentarse-pararse (TD-28).
 *
 * Genera frames con la misma forma que la salida de MediaPipe Pose (33 puntos 3D en metros + 33 puntos 2D
 * normalizados con `visibility`) a partir de un modelo cinemático simple. Sirve para el modo demo y para los tests:
 * nunca son datos de una persona real (ADR-010). Corre en el navegador (window.AxonSynthetic) y en Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonSynthetic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Guion por defecto: 3 repeticiones de calibración y 7 de ejercicio con un caso de cada tipo.
  const DEFAULT_SCRIPT = [
    {}, {}, {},                               // calibración
    {},                                       // 4: normal
    { trunkExtraDeg: 22 },                    // 5: compensa con el tronco
    {},                                       // 6: normal
    { valgusShift: { left: 0.12 } },          // 7: rodilla izquierda hacia adentro (~15° en el proxy)
    { lowConfidence: true },                  // 8: la cámara pierde las rodillas a mitad de la subida
    {},                                       // 9: normal
    {},                                       // 10: normal
  ];

  const BODY = { shank: 0.43, thigh: 0.45, trunk: 0.52, hipHalf: 0.1, shoulderHalf: 0.18, head: 0.24 };
  const POSE = { seatedKnee: 92, seatedTrunk: 8, standingTrunk: 3, peakTrunk: 32, descentTrunk: 24 };
  const TIMING = { seatedHold: 0.8, rise: 1.4, standHold: 0.7, descent: 1.4, lead: 1.0, tail: 1.0 };

  const rad = (d) => (d * Math.PI) / 180;
  const smooth = (u) => (1 - Math.cos(Math.PI * Math.min(Math.max(u, 0), 1))) / 2;
  const bump = (u, width) => Math.sin(Math.PI * Math.min(Math.max(u / width, 0), 1));

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Estado articular en el instante `sec` del guion: flexión de rodilla, tronco, valgo por lado y visibilidad.
   * `kneeSeatedDeg` de una repetición es la profundidad de la sentada desde la que se levanta, así que la bajada de la
   * repetición anterior ya termina en esa profundidad.
   */
  function stateAt(sec, script) {
    const repLen = TIMING.seatedHold + TIMING.rise + TIMING.standHold + TIMING.descent;
    const depthOf = (j) => (script[j] && script[j].kneeSeatedDeg != null ? script[j].kneeSeatedDeg : POSE.seatedKnee);
    const seatedAt = (j) => ({ knee: depthOf(j), trunk: POSE.seatedTrunk, shiftL: 0, shiftR: 0, kneeVisibility: 0.95 });
    let t = sec - TIMING.lead;
    if (t < 0) return seatedAt(0);
    const i = Math.floor(t / repLen);
    if (i >= script.length) return seatedAt(i);
    const r = script[i] || {};
    const depth = depthOf(i);
    const nextDepth = depthOf(i + 1);
    const peak = POSE.peakTrunk + (r.trunkExtraDeg || 0);
    const shift = r.valgusShift || {};
    t -= i * repLen;
    const st = { knee: depth, trunk: POSE.seatedTrunk, shiftL: 0, shiftR: 0, kneeVisibility: 0.95 };
    if (t < TIMING.seatedHold) return st;
    t -= TIMING.seatedHold;
    if (t < TIMING.rise) {
      const u = t / TIMING.rise;
      st.knee = depth * (1 - smooth(u));
      st.trunk = POSE.seatedTrunk + (POSE.standingTrunk - POSE.seatedTrunk) * smooth(u) + (peak - POSE.seatedTrunk) * bump(u, 0.7);
      st.shiftL = (shift.left || 0) * Math.sin(Math.PI * u);
      st.shiftR = (shift.right || 0) * Math.sin(Math.PI * u);
      if (r.lowConfidence && u > 0.2 && u < 0.8) st.kneeVisibility = 0.3;
      return st;
    }
    t -= TIMING.rise;
    if (t < TIMING.standHold) return Object.assign(st, { knee: 0, trunk: POSE.standingTrunk });
    const u = (t - TIMING.standHold) / TIMING.descent;
    st.knee = nextDepth * smooth(u);
    st.trunk = POSE.standingTrunk + (POSE.seatedTrunk - POSE.standingTrunk) * smooth(u)
      + (POSE.descentTrunk - POSE.standingTrunk) * bump(1 - u, 0.7);
    return st;
  }

  /**
   * Puntos de un frame. Coordenadas internas: x a la derecha de la imagen, y hacia arriba, z hacia la cámara (el
   * paciente mira a la cámara). Se devuelven como MediaPipe: y hacia abajo y z negativo hacia la cámara.
   */
  function landmarksFor(st, rand) {
    const noise = () => (rand() - 0.5) * 0.008;
    const pts = new Array(33);
    const leg = (side, shiftMedial) => {
      const xs = side * BODY.hipHalf;                       // side +1 = izquierda del paciente (derecha de la imagen)
      const as = rad(0.22 * st.knee);                       // la tibia se inclina hacia adelante al flexionar
      const k = rad(st.knee);
      const ankle = { x: xs, y: 0, z: 0 };
      const knee = { x: xs - side * shiftMedial, y: BODY.shank * Math.cos(as), z: BODY.shank * Math.sin(as) };
      const hip = { x: xs, y: knee.y + BODY.thigh * Math.cos(as - k), z: knee.z + BODY.thigh * Math.sin(as - k) };
      return { ankle, knee, hip };
    };
    const L = leg(+1, st.shiftL);
    const R = leg(-1, st.shiftR);
    const hipMid = { x: 0, y: (L.hip.y + R.hip.y) / 2, z: (L.hip.z + R.hip.z) / 2 };
    const f = rad(st.trunk);
    const shMid = { x: 0, y: hipMid.y + BODY.trunk * Math.cos(f), z: hipMid.z + BODY.trunk * Math.sin(f) };
    const nose = { x: 0, y: shMid.y + BODY.head * Math.cos(f), z: shMid.z + BODY.head * Math.sin(f) + 0.06 };
    const set = (i, p, vis) => { pts[i] = { x: p.x + noise(), y: p.y + noise(), z: p.z + noise(), visibility: vis }; };
    for (let i = 0; i < 33; i++) set(i, hipMid, 0);
    set(0, nose, 0.95);
    set(11, { x: BODY.shoulderHalf, y: shMid.y, z: shMid.z }, 0.95);
    set(12, { x: -BODY.shoulderHalf, y: shMid.y, z: shMid.z }, 0.95);
    set(23, L.hip, 0.95); set(24, R.hip, 0.95);
    set(25, L.knee, st.kneeVisibility); set(26, R.knee, st.kneeVisibility);
    set(27, L.ankle, 0.95); set(28, R.ankle, 0.95);
    const world = pts.map((p) => ({ x: p.x - hipMid.x, y: -(p.y - hipMid.y), z: -(p.z - hipMid.z), visibility: p.visibility }));
    // 2D: proyección oblicua (la profundidad se ve un poco de lado) en coordenadas normalizadas de imagen
    const image = pts.map((p) => ({ x: 0.5 + 0.75 * (p.x + 0.35 * p.z), y: 0.92 - 0.55 * p.y, z: 0, visibility: p.visibility }));
    return { world, image };
  }

  /** Frames a `fps` para todo el guion: [{ t (ms), world, image }]. Determinista para una misma semilla. */
  function generateSession(options) {
    const opts = Object.assign({ fps: 30, seed: 7, script: DEFAULT_SCRIPT }, options || {});
    const rand = mulberry32(opts.seed);
    const repLen = TIMING.seatedHold + TIMING.rise + TIMING.standHold + TIMING.descent;
    const total = TIMING.lead + opts.script.length * repLen + TIMING.tail;
    const frames = [];
    for (let n = 0; n * (1 / opts.fps) <= total; n++) {
      const sec = n / opts.fps;
      const { world, image } = landmarksFor(stateAt(sec, opts.script), rand);
      frames.push({ t: Math.round(sec * 1000), world, image });
    }
    return frames;
  }

  return { DEFAULT_SCRIPT, generateSession };
});
