/* AXONFAS · seguimiento visual y conteo para los ejercicios de la galería (ADR-014).
 *
 * Funciones puras sobre los 33 puntos de MediaPipe Pose: una medida por ejercicio (un ángulo, una distancia o un tiempo
 * sostenido) y un contador de repeticiones o de sostenes con valores de partida NO clínicos. No detecta
 * compensaciones ni emite alertas de seguridad: eso solo lo hace el motor de reglas de sentarse y pararse (engine.js,
 * ADR-004 y ADR-009). El mismo archivo corre en el navegador (window.AxonTracker) y en Node (tests).
 *
 * Coordenadas: worldLandmarks de MediaPipe en metros, x hacia la derecha de la imagen, y hacia abajo, z negativa hacia
 * la cámara. "Izquierda" y "derecha" son las de la persona.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonTracker = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIDES = {
    L: { ear: 7, sh: 11, osh: 12, el: 13, wr: 15, hip: 23, ohip: 24, kn: 25, an: 27, heel: 29, toe: 31 },
    R: { ear: 8, sh: 12, osh: 11, el: 14, wr: 16, hip: 24, ohip: 23, kn: 26, an: 28, heel: 30, toe: 32 },
  };
  const SIDE_NAMES = { L: 'izquierda', R: 'derecha' };
  const UP = { x: 0, y: -1, z: 0 };
  const DOWN = { x: 0, y: 1, z: 0 };

  const DEFAULTS = {
    minConfidence: 0.5,   // visibilidad mínima de los puntos que usa la medida
    settleMs: 1000,       // tiempo quieto en la posición inicial para tomar la referencia
    releaseRatio: 0.35,   // vuelta a la posición inicial: menos del 35 % del recorrido pedido
    partialRatio: 0.5,    // un recorrido entre el 50 % y el 100 % que vuelve sin llegar = repetición incompleta
    holdZone: 0.8,        // dentro del 80 % del recorrido pedido cuenta como sostener arriba
    holdGraceMs: 400,     // cortes breves (ruido de la pose) no reinician un sostén
    lostAbortMs: 1500,    // en modo manual, sin ver a la persona este tiempo se cancela el sostén
    restFollow: 0.02,     // la referencia sigue despacio a la persona mientras está quieta en la posición inicial
    restBand: 0.15,       // ...solo dentro del 15 % del recorrido pedido (no la arrastra el inicio del movimiento)
  };

  // ------------------------------------------------------------------ geometría
  const deg = (rad) => (rad * 180) / Math.PI;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });
  const flat = (v) => ({ x: v.x, y: v.y, z: 0 });            // plano frontal de la cámara
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const norm = (a) => Math.sqrt(dot(a, a));
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;

  function angleBetween(a, b) {
    const n = norm(a) * norm(b);
    return n === 0 ? 0 : deg(Math.acos(clamp(dot(a, b) / n, -1, 1)));
  }
  const angleAt = (a, b, c) => angleBetween(sub(a, b), sub(c, b));
  /** Ángulo con signo de b respecto de a en el plano de la imagen (positivo = sentido horario en pantalla). */
  const signedFlat = (a, b) => deg(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));

  // ------------------------------------------------------------------ medidas
  // Cada medida recibe p(i) (punto world) y v(i) (visibilidad) y devuelve { value, conf }; las de un lado reciben
  // además los índices de ese lado. value = null cuando la medida no aplica en ese frame (por ejemplo, la pierna que no
  // está estirada en la elevación de pierna recta).
  const conf = (v, ids) => Math.min(...ids.map(v));

  const METRICS = {
    kneeFlex: { label: 'Flexión de rodilla', unit: '°', plane: 'sagittal', need: [23, 24, 25, 26, 27, 28], sided: true,
      fn: (p, v, s) => ({ value: 180 - angleAt(p(s.hip), p(s.kn), p(s.an)), conf: conf(v, [s.hip, s.kn, s.an]) }) },
    hipFlex: { label: 'Flexión de cadera', unit: '°', plane: 'sagittal', need: [11, 12, 23, 24, 25, 26], sided: true,
      fn: (p, v, s) => ({ value: 180 - angleAt(p(s.sh), p(s.hip), p(s.kn)), conf: conf(v, [s.sh, s.hip, s.kn]) }) },
    hipLine: { label: 'Alineación hombro-cadera-rodilla', unit: '°', plane: 'sagittal', need: [11, 12, 23, 24, 25, 26], sided: true,
      fn: (p, v, s) => ({ value: angleAt(p(s.sh), p(s.hip), p(s.kn)), conf: conf(v, [s.sh, s.hip, s.kn]) }) },
    straightLegRaise: { label: 'Elevación de la pierna estirada', unit: '°', plane: 'sagittal', need: [11, 12, 23, 24, 25, 26, 27, 28], sided: true,
      fn: (p, v, s) => {
        const knee = 180 - angleAt(p(s.hip), p(s.kn), p(s.an));
        return { value: knee <= 30 ? 180 - angleAt(p(s.sh), p(s.hip), p(s.kn)) : null, conf: conf(v, [s.sh, s.hip, s.kn, s.an]) };
      } },
    kneeStraightRaised: { label: 'Rodilla estirada con la pierna arriba', unit: '°', plane: 'sagittal', need: [11, 12, 23, 24, 25, 26, 27, 28], sided: true,
      fn: (p, v, s) => {
        const hip = 180 - angleAt(p(s.sh), p(s.hip), p(s.kn));
        return { value: hip >= 50 ? angleAt(p(s.hip), p(s.kn), p(s.an)) : null, conf: conf(v, [s.sh, s.hip, s.kn, s.an]) };
      } },
    shoulderElev: { label: 'Elevación del brazo', unit: '°', plane: 'sagittal', need: [11, 12, 13, 14, 23, 24], sided: true,
      fn: (p, v, s) => ({ value: angleBetween(sub(p(s.el), p(s.sh)), sub(p(s.hip), p(s.sh))), conf: conf(v, [s.sh, s.el, s.hip]) }) },
    elbowFlex: { label: 'Flexión de codo', unit: '°', plane: 'sagittal', need: [11, 12, 13, 14, 15, 16], sided: true,
      fn: (p, v, s) => ({ value: 180 - angleAt(p(s.sh), p(s.el), p(s.wr)), conf: conf(v, [s.sh, s.el, s.wr]) }) },
    armHang: { label: 'Vaivén del brazo', unit: '°', plane: 'sagittal', need: [11, 12, 15, 16], sided: true,
      fn: (p, v, s) => ({ value: angleBetween(sub(p(s.wr), p(s.sh)), DOWN), conf: conf(v, [s.sh, s.wr]) }) },
    crossArm: { label: 'Brazo cruzado sobre el pecho', unit: '°', plane: 'frontal', need: [11, 12, 13, 14], sided: true,
      // 90° con el brazo colgando; se acerca a 180° cuando el brazo apunta al otro hombro.
      fn: (p, v, s) => ({ value: 180 - angleBetween(flat(sub(p(s.el), p(s.sh))), flat(sub(p(s.osh), p(s.sh)))),
        conf: conf(v, [s.sh, s.el, s.osh]) }) },
    forearmRot: { label: 'Rotación del antebrazo (afuera +)', unit: '°', plane: 'transverse', need: [11, 12, 13, 14, 15, 16], sided: true,
      // Codo a 90° pegado al cuerpo y antebrazo hacia la cámara: girar hacia afuera aleja la muñeca de la línea media.
      fn: (p, v, s) => {
        const out = Math.sign(p(s.sh).x - p(s.osh).x) || 1;
        const lateral = (p(s.wr).x - p(s.el).x) * out;
        const forward = -((p(s.wr).z || 0) - (p(s.el).z || 0));
        return { value: deg(Math.atan2(lateral, Math.max(forward, 0.01))), conf: conf(v, [s.sh, s.el, s.wr]) };
      } },
    heelRise: { label: 'Altura del talón sobre la punta', unit: 'cm', plane: 'vertical', need: [27, 28, 29, 30, 31, 32], sided: true,
      fn: (p, v, s) => ({ value: (p(s.toe).y - p(s.heel).y) * 100, conf: conf(v, [s.heel, s.toe]) }) },
    thighSpread: { label: 'Apertura entre muslos', unit: '°', plane: 'frontal', need: [23, 24, 25, 26],
      fn: (p, v) => ({ value: angleBetween(sub(p(25), p(23)), sub(p(26), p(24))), conf: conf(v, [23, 24, 25, 26]) }) },
    trunkLean: { label: 'Inclinación del tronco', unit: '°', plane: 'sagittal', need: [11, 12, 23, 24],
      fn: (p, v) => ({ value: angleBetween(sub(mid(p(11), p(12)), mid(p(23), p(24))), UP), conf: conf(v, [11, 12, 23, 24]) }) },
    trunkRot: { label: 'Giro de hombros sobre la cadera', unit: '°', plane: 'transverse', need: [11, 12, 23, 24],
      fn: (p, v) => {
        const yaw = (a, b) => deg(Math.atan2((b.z || 0) - (a.z || 0), b.x - a.x));
        let d = yaw(p(11), p(12)) - yaw(p(23), p(24));
        d = ((d + 540) % 360) - 180;
        return { value: d, conf: conf(v, [11, 12, 23, 24]) };
      } },
    neckTilt: { label: 'Inclinación lateral de la cabeza', unit: '°', plane: 'frontal', need: [7, 8, 11, 12],
      fn: (p, v) => ({ value: signedFlat(flat(sub(p(12), p(11))), flat(sub(p(8), p(7)))), conf: conf(v, [7, 8, 11, 12]) }) },
    headForward: { label: 'Cabeza adelantada', unit: '°', plane: 'sagittal', need: [7, 8, 11, 12],
      // De perfil: ángulo entre la vertical y la línea hombro-oreja del lado que mejor se ve. Baja al retraer el mentón.
      fn: (p, v) => {
        const s = v(7) + v(11) >= v(8) + v(12) ? SIDES.L : SIDES.R;
        return { value: angleBetween(flat(sub(p(s.ear), p(s.sh))), UP), conf: conf(v, [s.ear, s.sh]) };
      } },
    footLift: { label: 'Pie levantado', unit: 'cm', plane: 'vertical', need: [23, 24, 27, 28],
      fn: (p, v) => ({ value: Math.abs(p(27).y - p(28).y) * 100, conf: conf(v, [27, 28]) }) },
    feetInLine: { label: 'Separación lateral de los pies (% de la cadera)', unit: '%', plane: 'frontal', need: [23, 24, 27, 28],
      fn: (p, v) => {
        const hips = Math.abs(p(23).x - p(24).x) || 0.01;
        const lifted = Math.abs(p(27).y - p(28).y) * 100;
        return { value: lifted > 5 ? null : (Math.abs(p(27).x - p(28).x) / hips) * 100, conf: conf(v, [23, 24, 27, 28]) };
      } },
    standHeight: { label: 'Altura de la cadera (% de la pierna)', unit: '%', plane: 'vertical', need: [23, 24, 25, 26, 27, 28],
      // De pie, la cadera está a un largo de pierna sobre los tobillos (100 %); sentado, a la mitad. Con un pie en el
      // aire no vale (estirar una pierna sentado no es pararse, TD-55).
      fn: (p, v) => {
        const len = (a, b) => norm(sub(p(a), p(b)));
        const leg = ((len(23, 25) + len(25, 27)) + (len(24, 26) + len(26, 28))) / 2 || 1;
        const ankleY = (p(27).y + p(28).y) / 2;
        const lifted = Math.abs(p(27).y - p(28).y) / leg > 0.15;
        return { value: lifted ? null : ((ankleY - mid(p(23), p(24)).y) / leg) * 100, conf: conf(v, [23, 24, 25, 26, 27, 28]) };
      } },
    birdDog: { label: 'Brazo y pierna contraria estirados', unit: '°', plane: 'sagittal', need: [11, 12, 13, 14, 23, 24, 25, 26],
      fn: (p, v) => {
        const arm = (s) => angleBetween(sub(p(s.el), p(s.sh)), sub(p(s.hip), p(s.sh)));
        const leg = (s) => angleAt(p(s.sh), p(s.hip), p(s.kn));
        return { value: Math.max(Math.min(arm(SIDES.L), leg(SIDES.R)), Math.min(arm(SIDES.R), leg(SIDES.L))),
          conf: conf(v, [11, 12, 13, 14, 23, 24, 25, 26]) };
      } },
  };

  // ------------------------------------------------------------------ cómo se sigue cada ejercicio
  // mode: 'reps' (ida y vuelta desde la posición inicial), 'hold' (sostener una condición) o 'manual' (la cámara no ve
  // el movimiento: la persona marca el sostén y la cámara solo confirma que sigue en posición).
  // combine (medidas de un lado): 'mean' = promedio de ambos lados; 'active' = el lado que más se mueve; 'both' = los
  // dos lados tienen que moverse (cuenta el que menos se movió, así una sola pierna no alcanza).
  // dir: +1 la medida sube con el esfuerzo, -1 baja, 0 cualquiera de los dos sentidos. delta: recorrido pedido desde la
  // posición inicial. threshold (modo hold): valor absoluto a sostener; from: valor de reposo típico, solo para pintar el
  // progreso. quality 'limited' = la cámara lo ve con
  // dificultad (acostado, de perfil o con profundidad) y la página lo avisa. Todos los números son de partida (TD-48).
  const SPECS = {
    'sit-to-stand': { metric: 'standHeight', mode: 'reps', dir: 1, delta: 28, stable: 5, quality: 'good',
      camera: 'De frente o en diagonal, a 2–3 m, a la altura de la cadera, empezando sentado.' },
    'tandem-stance': { metric: 'feetInLine', mode: 'hold', dir: -1, threshold: 45, from: 100, quality: 'good',
      camera: 'De frente, a 2–3 m, con los pies a la vista.' },
    'one-leg-stand': { metric: 'footLift', mode: 'hold', dir: 1, threshold: 5, from: 0, quality: 'good',
      camera: 'De frente, a 2–3 m, con los pies a la vista.' },
    'calf-raises': { metric: 'heelRise', combine: 'mean', mode: 'reps', dir: 1, delta: 3, stable: 1.5, quality: 'good',
      camera: 'De costado o en diagonal, a 2 m, con los pies a la vista.' },
    'half-squat': { metric: 'kneeFlex', combine: 'both', mode: 'reps', dir: 1, delta: 35, quality: 'good',
      camera: 'De frente o en diagonal, a 2–3 m, a la altura de la cadera, empezando de pie.' },
    'leg-extension': { metric: 'kneeFlex', combine: 'active', mode: 'reps', dir: -1, delta: 45, quality: 'good',
      camera: 'De costado o en diagonal, a 2 m, sentado con las piernas a la vista.' },
    'straight-leg-raise': { metric: 'straightLegRaise', combine: 'active', mode: 'reps', dir: 1, delta: 20, quality: 'limited',
      note: 'Acostado, la cámara ve peor el cuerpo: ponla de costado y a la altura del suelo.',
      camera: 'De costado, a 2 m, con la cámara baja.' },
    'hamstring-curl': { metric: 'kneeFlex', combine: 'active', mode: 'reps', dir: 1, delta: 45, quality: 'good',
      camera: 'De costado o en diagonal, a 2–3 m, de pie.' },
    'supine-hamstring-stretch': { metric: 'kneeStraightRaised', combine: 'active', mode: 'hold', dir: 1, threshold: 150,
      from: 90, quality: 'limited', note: 'Acostado, la cámara ve peor el cuerpo: ponla de costado y a la altura del suelo.',
      camera: 'De costado, a 2 m, con la cámara baja.' },
    'hip-abduction': { metric: 'thighSpread', mode: 'reps', dir: 1, delta: 20, quality: 'limited',
      note: 'Acostado de lado: la cámara de frente a tu cuerpo, que se vean las dos piernas.',
      camera: 'De frente al cuerpo acostado de lado, a 2 m, con la cámara baja.' },
    'clamshell': { metric: 'thighSpread', mode: 'reps', dir: 1, delta: 18, quality: 'limited',
      note: 'Acostado de lado: la cámara de frente a tu cuerpo, que se vean las dos rodillas.',
      camera: 'De frente al cuerpo acostado de lado, a 2 m, con la cámara baja.' },
    'knee-to-chest': { metric: 'hipFlex', combine: 'active', mode: 'reps', dir: 1, delta: 35, quality: 'limited',
      note: 'Acostado, la cámara ve peor el cuerpo: ponla de costado y a la altura del suelo.',
      camera: 'De costado, a 2 m, con la cámara baja.' },
    'hip-bridge': { metric: 'hipLine', combine: 'mean', mode: 'reps', dir: 1, delta: 22, quality: 'limited',
      note: 'Acostado, la cámara ve peor el cuerpo: ponla de costado y a la altura del suelo.',
      camera: 'De costado, a 2 m, con la cámara baja.' },
    'bird-dog': { metric: 'birdDog', mode: 'reps', dir: 1, delta: 50, quality: 'limited',
      note: 'En cuatro apoyos se tapan brazos y piernas: ponte de costado a la cámara.',
      camera: 'De costado, a 2 m, con la cámara a la altura de la espalda.' },
    'abdominal-bracing': { metric: 'trunkLean', mode: 'manual', quality: 'limited',
      note: 'La cámara no ve el abdomen: toca "Sostener" en cada repetición y la cámara confirma que sigues en posición.',
      camera: 'De costado, a 2 m, con la cámara baja.' },
    'chin-retraction': { metric: 'headForward', mode: 'reps', dir: -1, delta: 6, stable: 3, quality: 'limited',
      note: 'Es un movimiento pequeño: la cámara de perfil y cerca (1 m), con cabeza y hombro a la vista.',
      camera: 'De perfil, a 1 m, a la altura de la cabeza.' },
    'neck-side-flexion': { metric: 'neckTilt', mode: 'reps', dir: 0, delta: 15, perSide: true, quality: 'good',
      camera: 'De frente, a 1–2 m, con cabeza y hombros a la vista.' },
    'seated-trunk-rotation': { metric: 'trunkRot', mode: 'reps', dir: 0, delta: 20, perSide: true, quality: 'limited',
      note: 'El giro se calcula con la profundidad que estima la cámara: es aproximado.',
      camera: 'De frente, a 2 m, sentado con hombros y cadera a la vista.' },
    'pendulum': { metric: 'armHang', combine: 'active', mode: 'reps', dir: 0, delta: 10, quality: 'limited',
      note: 'Cuenta cada vaivén del brazo, no cada círculo.',
      camera: 'De costado o de frente, a 2 m, con el brazo que cuelga a la vista.' },
    'crossover-arm-stretch': { metric: 'crossArm', combine: 'active', mode: 'hold', dir: 1, threshold: 130, from: 90, perSide: true,
      quality: 'good', camera: 'De frente, a 1–2 m, con hombros y brazos a la vista.' },
    'external-rotation-band': { metric: 'forearmRot', combine: 'active', mode: 'reps', dir: 1, delta: 30, quality: 'limited',
      note: 'El giro se calcula con la profundidad que estima la cámara: es aproximado.',
      camera: 'De frente, a 1–2 m, con el codo y la mano a la vista.' },
    'internal-rotation-band': { metric: 'forearmRot', combine: 'active', mode: 'reps', dir: -1, delta: 30, quality: 'limited',
      note: 'El giro se calcula con la profundidad que estima la cámara: es aproximado.',
      camera: 'De frente, a 1–2 m, con el codo y la mano a la vista.' },
    'standing-row': { metric: 'elbowFlex', combine: 'mean', mode: 'reps', dir: 1, delta: 45, quality: 'good',
      camera: 'De costado o en diagonal, a 2 m, con brazos y tronco a la vista.' },
    'scapula-setting': { metric: 'trunkLean', mode: 'manual', quality: 'limited',
      note: 'La cámara no ve las escápulas: toca "Sostener" en cada repetición y la cámara confirma que sigues en posición.',
      camera: 'De frente o de espalda, a 2 m, sentado.' },
  };

  /** Dosis a seguir: la del plan del paciente si existe, si no la de la fuente (catalog.js). */
  function targetFor(spec, dose) {
    const perSide = spec.perSide ? 2 : 1;
    const sets = Math.max(1, dose.sets || 1);
    const reps = Math.max(1, dose.reps || 1) * perSide;
    return { sets, perSet: reps, total: sets * reps, hold: Math.max(0, dose.hold || 0) };
  }

  /** Lee la medida de un frame. Devuelve { L, R } en las medidas de un lado o { value, conf } en las demás. */
  function measure(metricId, world, visibilitySource) {
    const m = METRICS[metricId];
    const vis = visibilitySource || world;
    const p = (i) => world[i];
    const v = (i) => (vis[i] && Number.isFinite(vis[i].visibility) ? vis[i].visibility : 0);
    if (!m.sided) return m.fn(p, v);
    return { L: m.fn(p, v, SIDES.L), R: m.fn(p, v, SIDES.R) };
  }

  /**
   * Sesión de seguimiento de un ejercicio. update({ t, world, visibility }) devuelve lo que la página pinta y los eventos
   * nuevos: rep (repetición contada), partial (recorrido incompleto), hold_start, hold_done, hold_short, set_done, done.
   */
  function createTracker(spec, dose, options) {
    const cfg = Object.assign({}, DEFAULTS, options || {});
    const metric = METRICS[spec.metric];
    const target = targetFor(spec, dose || {});
    const stableTol = spec.stable || 8;
    const s = {
      phase: spec.mode === 'reps' ? 'setup' : 'active',   // setup = esperando la posición inicial quieta
      rest: null,           // referencia por lado ({ L, R } o { one })
      window: [],           // [{ t, vals }] para detectar que la persona está quieta
      state: 'rest',        // reps: rest | up
      rep: null,
      excursion: 0,         // mayor recorrido desde el reposo (para las repeticiones incompletas)
      hold: null,           // { start, lastIn, counted, side }
      manual: null,         // { start, lastSeen }
      count: 0,
      reps: [],
      partials: 0,
      shortHolds: 0,        // llegó arriba pero bajó antes de terminar el sostén: no cuenta
      lastSeen: null,
    };

    const keys = () => (metric.sided ? ['L', 'R'] : ['one']);
    const sideOf = (key) => (key === 'L' || key === 'R' ? key : null);
    const valuesOf = (m) => (metric.sided ? { L: m.L, R: m.R } : { one: m });

    function deviation(value, rest) {
      const d = value - rest;
      return spec.dir === 0 ? Math.abs(d) : spec.dir * d;
    }

    /** Lado que se mueve (o el promedio) y su desvío respecto de la referencia. */
    function pick(vals) {
      if (metric.sided && spec.combine === 'both') {
        if (['L', 'R'].some((k) => vals[k].value == null || s.rest[k] == null)) return null;
        const devs = ['L', 'R'].map((k) => ({ k, dev: deviation(vals[k].value, s.rest[k]) }));
        const low = devs[0].dev <= devs[1].dev ? devs[0] : devs[1];
        return { key: null, value: vals[low.k].value, rest: s.rest[low.k], dev: low.dev };
      }
      if (metric.sided && spec.combine === 'mean') {
        const ok = ['L', 'R'].filter((k) => vals[k].value != null && s.rest[k] != null);
        if (!ok.length) return null;
        const value = mean(ok.map((k) => vals[k].value));
        const rest = mean(ok.map((k) => s.rest[k]));
        return { key: null, value, rest, dev: deviation(value, rest) };
      }
      let best = null;
      keys().forEach((k) => {
        if (vals[k].value == null || s.rest[k] == null) return;
        const dev = deviation(vals[k].value, s.rest[k]);
        if (!best || dev > best.dev) best = { key: k, value: vals[k].value, rest: s.rest[k], dev };
      });
      return best;
    }

    function settle(t, vals) {
      s.window.push({ t, vals });
      while (s.window.length && t - s.window[0].t > cfg.settleMs) s.window.shift();
      if (t - s.window[0].t < cfg.settleMs * 0.9) return false;
      const rest = {};
      keys().forEach((k) => {
        const xs = s.window.map((w) => w.vals[k].value).filter((x) => x != null);
        if (xs.length >= s.window.length * 0.8 && Math.max(...xs) - Math.min(...xs) <= stableTol) rest[k] = mean(xs);
        else rest[k] = null;
      });
      const ready = keys().some((k) => rest[k] != null);   // de perfil, un lado puede quedar tapado
      if (ready) s.rest = rest;
      return ready;
    }

    function count(events, extra) {
      s.count += 1;
      const rep = Object.assign({ index: s.count }, extra);
      s.reps.push(rep);
      events.push(Object.assign({ type: 'rep' }, rep));
      if (s.count >= target.total) {
        s.phase = 'done';
        events.push({ type: 'done', count: s.count });
      } else if (s.count % target.perSet === 0) {
        events.push({ type: 'set_done', set: s.count / target.perSet });
      }
    }

    const r1 = (v) => Math.round(v * 10) / 10;

    function stepReps(t, vals, events) {
      if (s.phase === 'setup') {
        if (settle(t, vals)) {
          s.phase = 'active';
          events.push({ type: 'ready' });
        }
        return { pick: null };
      }
      const cur = s.state === 'up' && s.rep.key ? (() => {
        const k = s.rep.key;
        return vals[k].value == null ? null : { key: k, value: vals[k].value, rest: s.rest[k], dev: deviation(vals[k].value, s.rest[k]) };
      })() : pick(vals);
      if (!cur) return { pick: null };
      const { dev } = cur;
      if (s.state === 'rest') {
        if (dev >= spec.delta) {
          s.state = 'up';
          s.rep = { key: cur.key, sign: Math.sign(cur.value - cur.rest), start: t, peak: dev, holdStart: t, lastIn: t,
            holdMax: 0, holdDone: !target.hold };
          s.excursion = 0;
          if (target.hold) events.push({ type: 'hold_start', seconds: target.hold });
        } else {
          s.excursion = Math.max(s.excursion, dev);
          if (dev <= spec.delta * cfg.releaseRatio) {
            if (s.excursion >= spec.delta * cfg.partialRatio) { s.partials += 1; events.push({ type: 'partial', peak: r1(s.excursion) }); }
            s.excursion = 0;
            // La referencia sigue despacio a la persona (se acomoda en la silla, la cámara se movió un poco).
            const follow = cur.key ? [cur.key] : ['L', 'R'];
            follow.forEach((k) => {
              const v = vals[k].value;
              if (v != null && s.rest[k] != null && Math.abs(v - s.rest[k]) <= spec.delta * cfg.restBand) {
                s.rest[k] += cfg.restFollow * (v - s.rest[k]);
              }
            });
          }
        }
      } else {
        // Sostener = quedarse arriba sin pausa hasta que la cuenta llegue a 0. Un corte breve (ruido) no la reinicia;
        // bajar más tiempo sí, y la cuenta vuelve a empezar al subir otra vez.
        const rep = s.rep;
        rep.peak = Math.max(rep.peak, dev);
        if (dev >= spec.delta * cfg.holdZone) {
          if (rep.holdStart == null) {
            rep.holdStart = t;
            if (target.hold && !rep.holdDone) events.push({ type: 'hold_start', seconds: target.hold });
          }
          rep.lastIn = t;
          rep.holdMax = Math.max(rep.holdMax, t - rep.holdStart);
          if (!rep.holdDone && rep.holdMax >= target.hold * 1000) {
            rep.holdDone = true;
            events.push({ type: 'hold_done' });
          }
        } else if (rep.holdStart != null && t - rep.lastIn > cfg.holdGraceMs) {
          rep.holdStart = null;
        }
        if (dev <= spec.delta * cfg.releaseRatio) {
          s.state = 'rest';
          s.rep = null;
          const holdSec = r1(rep.holdMax / 1000);
          if (!rep.holdDone) {
            // Llegó arriba pero bajó antes de que la cuenta del sostén llegara a 0: no cuenta.
            s.shortHolds += 1;
            events.push({ type: 'hold_short', seconds: holdSec, needed: target.hold });
          } else {
            count(events, { side: sideOf(rep.key) || (spec.dir === 0 ? (rep.sign > 0 ? '+' : '-') : null), peak: r1(rep.peak),
              holdSec, holdOk: true, seconds: r1((t - rep.start) / 1000) });
          }
        }
      }
      return { pick: cur };
    }

    function stepHold(t, vals, events) {
      let best = null;
      keys().forEach((k) => {
        const val = vals[k].value;
        if (val == null) return;
        const inside = spec.dir >= 0 ? val >= spec.threshold : val <= spec.threshold;
        const score = spec.dir >= 0 ? val - spec.threshold : spec.threshold - val;
        const from = spec.from != null ? spec.from : spec.threshold - spec.dir * 10;
        const progress = inside ? 1 : clamp((val - from) / (spec.threshold - from), 0, 0.95);
        if (!best || score > best.score) best = { key: sideOf(k), value: val, inside, score, progress };
      });
      const h = s.hold;
      if (best && best.inside) {
        if (!h) {
          s.hold = { start: t, lastIn: t, counted: false, side: best.key };
          events.push({ type: 'hold_start', seconds: target.hold });
        } else {
          h.lastIn = t;
          if (!h.counted && t - h.start >= target.hold * 1000) {
            h.counted = true;
            events.push({ type: 'hold_done' });
            count(events, { side: h.side, holdSec: target.hold, holdOk: true, seconds: target.hold });
          }
        }
      } else if (h && t - h.lastIn > cfg.holdGraceMs) {
        if (!h.counted) events.push({ type: 'hold_short', seconds: r1((h.lastIn - h.start) / 1000) });
        s.hold = null;
      }
      return { pick: best };
    }

    function update(frame) {
      const out = { events: [], lowConfidence: false };
      if (s.phase === 'done') return Object.assign(out, snapshot(null, frame.t));
      const m = measure(spec.metric, frame.world, frame.visibility);
      const vals = valuesOf(m);
      const confs = keys().map((k) => vals[k].conf);
      out.conf = Math.max(...confs);
      // En las medidas de un lado basta con ver bien uno (el otro puede quedar tapado de perfil).
      keys().forEach((k) => { if (vals[k].conf < cfg.minConfidence) vals[k] = { value: null, conf: vals[k].conf }; });
      out.lowConfidence = keys().every((k) => vals[k].value == null && vals[k].conf < cfg.minConfidence);
      let picked = null;
      if (!out.lowConfidence) {
        s.lastSeen = frame.t;
        if (spec.mode === 'reps') picked = stepReps(frame.t, vals, out.events).pick;
        else if (spec.mode === 'hold') picked = stepHold(frame.t, vals, out.events).pick;
        else {
          const k = keys().find((key) => vals[key].value != null);
          picked = k ? { key: null, value: vals[k].value, progress: s.manual ? clamp((frame.t - s.manual.start) / (target.hold * 1000 || 1), 0, 1) : 0 } : null;
        }
      } else if (spec.mode === 'hold' && s.hold && frame.t - s.hold.lastIn > cfg.holdGraceMs) {
        if (!s.hold.counted) out.events.push({ type: 'hold_short', seconds: r1((s.hold.lastIn - s.hold.start) / 1000) });
        s.hold = null;
      }
      if (spec.mode === 'manual') stepManual(frame.t, out);
      return Object.assign(out, snapshot(picked, frame.t));
    }

    function stepManual(t, out) {
      const h = s.manual;
      if (!h) return;
      const seen = s.lastSeen != null && t - s.lastSeen <= cfg.holdGraceMs;
      if (!seen && t - Math.max(s.lastSeen == null ? h.start : s.lastSeen, h.start) > cfg.lostAbortMs) {
        s.manual = null;
        out.events.push({ type: 'hold_lost' });
        return;
      }
      if (seen && t - h.start >= target.hold * 1000) {
        s.manual = null;
        out.events.push({ type: 'hold_done' });
        count(out.events, { side: null, holdSec: target.hold, holdOk: true, seconds: target.hold });
      }
    }

    /** Modo manual: la persona toca "Sostener"; cuenta si la cámara la sigue viendo hasta el final del tiempo. */
    function startManualHold(t) {
      if (spec.mode !== 'manual' || s.phase === 'done') return [];
      s.manual = { start: t };
      return [{ type: 'hold_start', seconds: target.hold }];
    }

    function recalibrate() {
      if (spec.mode !== 'reps') return;
      Object.assign(s, { phase: 'setup', rest: null, window: [], state: 'rest', rep: null, excursion: 0 });
    }

    function snapshot(picked, t) {
      const progress = !picked ? 0 : picked.dev != null ? clamp(picked.dev / spec.delta, 0, 1) : picked.progress || 0;
      const holding = spec.mode === 'reps' ? (s.rep && s.rep.holdStart != null && !s.rep.holdDone ? t - s.rep.holdStart : null)
        : spec.mode === 'hold' ? (s.hold && !s.hold.counted ? t - s.hold.start : null)
          : (s.manual ? t - s.manual.start : null);
      return {
        phase: s.phase, state: s.state, count: s.count, partials: s.partials, shortHolds: s.shortHolds,
        holdDone: spec.mode === 'reps' ? Boolean(s.rep && s.rep.holdDone && target.hold) : false,
        set: Math.min(target.sets, Math.floor(s.count / target.perSet) + 1), setCount: s.count % target.perSet,
        target, value: picked ? picked.value : null, side: picked ? sideOf(picked.key) : null,
        rest: picked && picked.rest != null ? picked.rest : null, progress,
        holdMs: holding, metric: { id: spec.metric, label: metric.label, unit: metric.unit },
      };
    }

    return {
      update, recalibrate, startManualHold,
      end() { if (s.phase !== 'done') s.phase = 'done'; },
      get reps() { return s.reps.slice(); },
      get target() { return Object.assign({}, target); },
      get spec() { return spec; },
    };
  }

  return { SIDES, SIDE_NAMES, METRICS, SPECS, DEFAULTS, measure, targetFor, createTracker, angleAt };
});
