/* AXONFAS · figura de referencia animada de cada ejercicio (TD-44, ADR-014).
 *
 * Dibujo propio (no copia las imágenes de las fuentes): una figura de palitos con posición inicial, movimiento, sostén y
 * vuelta, más la silla, la mesa, la banda o la colchoneta que use el ejercicio. Con movimiento reducido muestra la
 * posición inicial y la final lado a lado. Las poses son ángulos absolutos de cada segmento, en grados: 0 = hacia abajo,
 * 90 = hacia adelante (derecha de la imagen), 180 = hacia arriba, -90 = hacia atrás. En las vistas de frente, 90 es la
 * derecha de la imagen. "N" es el lado cercano (o el izquierdo de la imagen) y "F" el lejano (o el derecho).
 * Las funciones de geometría corren también en Node (tests); el dibujo solo en el navegador.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonGuide = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const L = { torso: 0.52, neck: 0.2, head: 0.11, upper: 0.3, fore: 0.27, thigh: 0.45, shin: 0.43, foot: 0.18,
    shoulderHalf: 0.19, hipHalf: 0.1 };
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const dir = (a) => ({ x: Math.sin(rad(a)), y: Math.cos(rad(a)) });          // y hacia abajo, como el lienzo
  const add = (p, a, len) => { const d = dir(a); return { x: p.x + d.x * len, y: p.y + d.y * len }; };
  const angleOf = (v) => deg(Math.atan2(v.x, v.y));
  const lerpP = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // ------------------------------------------------------------------ poses base
  const P = (...parts) => Object.assign({}, ...parts);
  const STAND = { torso: 180, aN: [4, 4], aF: [-4, -4], lN: [0, 0, 90], lF: [0, 0, 90] };
  const SUPPORT = { aN: [5, 66], aF: [3, 64], ikN: 'prop', ikF: 'prop' };     // manos en el respaldo de una silla
  const SEAT = { torso: 178, aN: [23, 37], aF: [21, 35], lN: [90, 0, 90], lF: [90, 0, 90] };   // manos en los muslos
  const SUPINE = { torso: -90, neck: -90, aN: [90, 90], aF: [92, 92], lN: [140, 30, 90], lF: [138, 29, 90] };
  const SIDE_LYING = { torso: -90, neck: -95, aN: [88, 88], aF: [-160, -110] };
  const FRONT = { torso: 180, neck: 180, aN: [-5, -5], aF: [5, 5] };

  /** view: side | front | back | lying. upper: solo tronco, brazos y cabeza. anchor: punto que no se mueve en x.
   *  seq: [pose, ms | 'hold', clave del texto]. cues: textos de cada fase. */
  const G = (view, props, anchor, cues, seq, extra) => Object.assign({ view, props, anchor, cues, seq }, extra || {});

  const GUIDES = {
    'sit-to-stand': G('side', ['chair'], 'anN', {
      start: 'Sentado, brazos cruzados sobre el pecho', go: 'Inclínate y ponte de pie sin usar los brazos',
      top: 'De pie, con rodillas y caderas estiradas', back: 'Vuelve a sentarte despacio',
    }, [
      [{ torso: 172, armsRel: true, aN: [30, 200], aF: [26, 198], lN: [88, -5, 90], lF: [88, -5, 90] }, 900, 'start'],
      [{ torso: 138, armsRel: true, aN: [30, 200], aF: [26, 198], lN: [88, -8, 90], lF: [88, -8, 90] }, 600, 'go'],
      [{ torso: 180, armsRel: true, aN: [30, 200], aF: [26, 198], lN: [0, 0, 90], lF: [0, 0, 90] }, 900, 'go'],
      [{ torso: 180, armsRel: true, aN: [30, 200], aF: [26, 198], lN: [0, 0, 90], lF: [0, 0, 90] }, 'hold', 'hold'],
      [{ torso: 138, armsRel: true, aN: [30, 200], aF: [26, 198], lN: [88, -8, 90], lF: [88, -8, 90] }, 900, 'back'],
      [{ torso: 172, armsRel: true, aN: [30, 200], aF: [26, 198], lN: [88, -5, 90], lF: [88, -5, 90] }, 600, 'back'],
    ]),
    'tandem-stance': G('side', ['chairBack'], 'hip', {
      start: 'De pie, con una mano en el respaldo', go: 'Pon un pie delante del otro, talón con punta',
      back: 'Vuelve a separar los pies',
    }, [
      [P(STAND, { aN: [5, 66], ikN: 'prop' }), 900, 'start'],
      [P(STAND, { aN: [5, 66], ikN: 'prop', lN: [6, 6, 90], lF: [-6, -6, 90] }), 900, 'go'],
      [P(STAND, { aN: [5, 66], ikN: 'prop', lN: [6, 6, 90], lF: [-6, -6, 90] }), 'hold', 'hold'],
      [P(STAND, { aN: [5, 66], ikN: 'prop' }), 900, 'back'],
    ]),
    'one-leg-stand': G('side', ['chairBack'], 'anF', {
      start: 'De pie, de costado a la silla y con una mano apoyada', go: 'Levanta un pie unos centímetros',
      back: 'Apoya el pie y cambia de pierna',
    }, [
      [P(STAND, { aN: [5, 66], ikN: 'prop' }), 900, 'start'],
      [P(STAND, { aN: [5, 66], ikN: 'prop', lN: [25, -40, 50] }), 800, 'go'],
      [P(STAND, { aN: [5, 66], ikN: 'prop', lN: [25, -40, 50] }), 'hold', 'hold'],
      [P(STAND, { aN: [5, 66], ikN: 'prop' }), 800, 'back'],
    ]),
    'calf-raises': G('side', ['chairBack'], 'toN', {
      start: 'De pie, manos en el respaldo de una silla', go: 'Sube sobre la punta de los pies, despacio',
      top: 'Arriba, con el peso en ambos pies', back: 'Baja los talones con control',
    }, [
      [P(STAND, SUPPORT), 800, 'start'],
      [P(STAND, SUPPORT, { lN: [0, 0, 58], lF: [0, 0, 58] }), 800, 'go'],
      [P(STAND, SUPPORT, { lN: [0, 0, 58], lF: [0, 0, 58] }), 'hold', 'hold'],
      [P(STAND, SUPPORT), 900, 'back'],
    ]),
    'half-squat': G('side', ['chairBack'], 'anN', {
      start: 'De pie, pies al ancho de los hombros, manos en la silla', go: 'Baja como para sentarte, solo hasta la mitad',
      back: 'Sube despacio, con el peso en los talones',
    }, [
      [P(STAND, SUPPORT), 800, 'start'],
      [P(STAND, SUPPORT, { torso: 155, lN: [50, -22, 90], lF: [50, -22, 90] }), 1000, 'go'],
      [P(STAND, SUPPORT, { torso: 155, lN: [50, -22, 90], lF: [50, -22, 90] }), 'hold', 'hold'],
      [P(STAND, SUPPORT), 1000, 'back'],
    ]),
    'leg-extension': G('side', ['chair'], 'hip', {
      start: 'Sentado con la espalda apoyada', go: 'Estira la rodilla hasta dejar la pierna recta',
      back: 'Baja despacio y cambia de pierna',
    }, [
      [SEAT, 800, 'start'],
      [P(SEAT, { lN: [90, 88, 175] }), 900, 'go'],
      [P(SEAT, { lN: [90, 88, 175] }), 'hold', 'hold'],
      [SEAT, 900, 'back'],
    ]),
    'straight-leg-raise': G('side', ['mat'], 'hip', {
      start: 'Boca arriba, una rodilla doblada y la otra pierna estirada', go: 'Aprieta el muslo y levanta la pierna estirada',
      back: 'Bájala despacio',
    }, [
      [P(SUPINE, { lN: [90, 90, 180] }), 800, 'start'],
      [P(SUPINE, { lN: [132, 132, 222] }), 900, 'go'],
      [P(SUPINE, { lN: [132, 132, 222] }), 'hold', 'hold'],
      [P(SUPINE, { lN: [90, 90, 180] }), 900, 'back'],
    ]),
    'hamstring-curl': G('side', ['chairBack'], 'anF', {
      start: 'De pie, manos en el respaldo de una silla', go: 'Lleva el talón hacia el glúteo, muslos alineados',
      back: 'Baja despacio y cambia de pierna',
    }, [
      [P(STAND, SUPPORT), 800, 'start'],
      [P(STAND, SUPPORT, { lN: [4, -88, 2] }), 900, 'go'],
      [P(STAND, SUPPORT, { lN: [4, -88, 2] }), 'hold', 'hold'],
      [P(STAND, SUPPORT), 900, 'back'],
    ]),
    'supine-hamstring-stretch': G('side', ['mat'], 'hip', {
      start: 'Boca arriba, sujeta un muslo por detrás', go: 'Estira la rodilla hasta sentir el estiramiento',
      back: 'Relaja y cambia de pierna',
    }, [
      [P(SUPINE, { lN: [178, 88, 178], ikN: 'thighN', ikF: 'thighN' }), 900, 'start'],
      [P(SUPINE, { lN: [178, 176, 266], ikN: 'thighN', ikF: 'thighN' }), 1000, 'go'],
      [P(SUPINE, { lN: [178, 176, 266], ikN: 'thighN', ikF: 'thighN' }), 'hold', 'hold'],
      [P(SUPINE, { lN: [178, 88, 178], ikN: 'thighN', ikF: 'thighN' }), 900, 'back'],
    ]),
    'hip-abduction': G('lying', ['mat'], 'hip', {
      start: 'Acostado de lado, la pierna de abajo doblada', go: 'Levanta la pierna de arriba, recta',
      back: 'Bájala despacio, sin balancearla',
    }, [
      [P(SIDE_LYING, { lF: [80, 120, 200], lN: [90, 90, 180] }), 800, 'start'],
      [P(SIDE_LYING, { lF: [80, 120, 200], lN: [124, 124, 214] }), 900, 'go'],
      [P(SIDE_LYING, { lF: [80, 120, 200], lN: [124, 124, 214] }), 'hold', 'hold'],
      [P(SIDE_LYING, { lF: [80, 120, 200], lN: [90, 90, 180] }), 900, 'back'],
    ]),
    'clamshell': G('lying', ['mat'], 'hip', {
      start: 'De lado, caderas y rodillas dobladas, pies juntos', go: 'Abre la rodilla de arriba sin separar los pies',
      back: 'Cierra despacio',
    }, [
      [P(SIDE_LYING, { lF: [55, -45, 45], lN: [55, -45, 45] }), 800, 'start'],
      [P(SIDE_LYING, { lF: [55, -45, 45], lN: [98, -22, 68] }), 900, 'go'],
      [P(SIDE_LYING, { lF: [55, -45, 45], lN: [98, -22, 68] }), 'hold', 'hold'],
      [P(SIDE_LYING, { lF: [55, -45, 45], lN: [55, -45, 45] }), 900, 'back'],
    ], { plane: true }),
    'knee-to-chest': G('side', ['mat'], 'hip', {
      start: 'Boca arriba, rodillas dobladas, manos en una rodilla', go: 'Lleva la rodilla hacia el pecho con las manos',
      back: 'Vuelve despacio y cambia de lado',
    }, [
      [P(SUPINE, { ikN: 'kneeN', ikF: 'kneeN' }), 800, 'start'],
      [P(SUPINE, { lN: [212, 118, 208], ikN: 'kneeN', ikF: 'kneeN' }), 1000, 'go'],
      [P(SUPINE, { lN: [212, 118, 208], ikN: 'kneeN', ikF: 'kneeN' }), 'hold', 'hold'],
      [P(SUPINE, { ikN: 'kneeN', ikF: 'kneeN' }), 900, 'back'],
    ]),
    'hip-bridge': G('side', ['mat'], 'shN', {
      start: 'Boca arriba, rodillas dobladas, pies apoyados', go: 'Aprieta los glúteos y sube la cadera hasta alinearte',
      back: 'Baja vértebra por vértebra',
    }, [
      [SUPINE, 800, 'start'],
      [P(SUPINE, { torso: -62, lN: [110, 18, 90], lF: [108, 17, 90] }), 1000, 'go'],
      [P(SUPINE, { torso: -62, lN: [110, 18, 90], lF: [108, 17, 90] }), 'hold', 'hold'],
      [SUPINE, 1000, 'back'],
    ]),
    'bird-dog': G('side', ['mat'], 'knF', {
      start: 'En cuatro apoyos, espalda plana', go: 'Estira un brazo adelante y la pierna contraria atrás',
      back: 'Vuelve a cuatro apoyos y cambia de lado',
    }, [
      [{ torso: 102, neck: 98, aN: [0, 0], aF: [0, 0], lN: [0, -90, -90], lF: [0, -90, -90] }, 800, 'start'],
      [{ torso: 102, neck: 98, aN: [0, 0], aF: [95, 95], lN: [-98, -98, -8], lF: [0, -90, -90] }, 1000, 'go'],
      [{ torso: 102, neck: 98, aN: [0, 0], aF: [95, 95], lN: [-98, -98, -8], lF: [0, -90, -90] }, 'hold', 'hold'],
      [{ torso: 102, neck: 98, aN: [0, 0], aF: [0, 0], lN: [0, -90, -90], lF: [0, -90, -90] }, 900, 'back'],
    ]),
    'abdominal-bracing': G('side', ['mat'], 'hip', {
      start: 'Boca arriba, rodillas dobladas', go: 'Tensa el abdomen sin hundir la panza, respirando',
      back: 'Relaja y repite',
    }, [
      [SUPINE, 900, 'start'],
      [P(SUPINE, { glow: 1 }), 500, 'go'],
      [P(SUPINE, { glow: 1 }), 'hold', 'hold'],
      [SUPINE, 600, 'back'],
    ]),
    'chin-retraction': G('side', ['chair'], 'hip', {
      start: 'Sentado con la espalda recta', go: 'Lleva la cabeza atrás en línea recta, como doble mentón',
      back: 'Vuelve sin inclinar la cabeza',
    }, [
      [P(SEAT, { neck: 160 }), 800, 'start'],
      [P(SEAT, { neck: 186 }), 700, 'go'],
      [P(SEAT, { neck: 186 }), 'hold', 'hold'],
      [P(SEAT, { neck: 160 }), 700, 'back'],
    ]),
    'neck-side-flexion': G('front', [], 'hip', {
      start: 'Sentado, hombros relajados', go: 'Inclina la oreja hacia el hombro, sin subirlo',
      go2: 'Ahora hacia el otro lado', back: 'Vuelve al centro',
    }, [
      [FRONT, 700, 'start'],
      [P(FRONT, { neck: 154 }), 800, 'go'],
      [P(FRONT, { neck: 154 }), 'hold', 'hold'],
      [FRONT, 700, 'back'],
      [P(FRONT, { neck: 206 }), 800, 'go2'],
      [P(FRONT, { neck: 206 }), 'hold', 'hold'],
      [FRONT, 700, 'back'],
    ], { upper: true }),
    'seated-trunk-rotation': G('front', [], 'hip', {
      start: 'Sentado, brazos cruzados sobre el pecho', go: 'Gira el tronco hacia un lado sin mover la cadera',
      go2: 'Ahora hacia el otro lado', back: 'Vuelve al centro',
    }, [
      [P(FRONT, { aN: [28, 95], aF: [-28, -95] }), 700, 'start'],
      [P(FRONT, { aN: [28, 95], aF: [-28, -95], yaw: 50 }), 900, 'go'],
      [P(FRONT, { aN: [28, 95], aF: [-28, -95], yaw: 50 }), 'hold', 'hold'],
      [P(FRONT, { aN: [28, 95], aF: [-28, -95] }), 800, 'back'],
      [P(FRONT, { aN: [28, 95], aF: [-28, -95], yaw: -50 }), 900, 'go2'],
      [P(FRONT, { aN: [28, 95], aF: [-28, -95], yaw: -50 }), 'hold', 'hold'],
      [P(FRONT, { aN: [28, 95], aF: [-28, -95] }), 800, 'back'],
    ], { upper: true }),
    'pendulum': G('side', ['table'], 'anF', {
      start: 'Inclinado, con una mano apoyada en la mesa', go: 'Deja colgar el brazo y muévelo con el balanceo del cuerpo',
      back: 'Sin forzar el hombro: el movimiento lo da el cuerpo',
    }, [
      [{ torso: 122, neck: 112, aF: [45, 45], ikF: 'prop', aN: [0, 0], lF: [0, 0, 90], lN: [-12, -6, 90] }, 700, 'start'],
      [{ torso: 122, neck: 112, aF: [45, 45], ikF: 'prop', aN: [24, 24], lF: [0, 0, 90], lN: [-12, -6, 90] }, 700, 'go'],
      [{ torso: 122, neck: 112, aF: [45, 45], ikF: 'prop', aN: [-24, -24], lF: [0, 0, 90], lN: [-12, -6, 90] }, 1100, 'go'],
      [{ torso: 122, neck: 112, aF: [45, 45], ikF: 'prop', aN: [24, 24], lF: [0, 0, 90], lN: [-12, -6, 90] }, 1100, 'go'],
      [{ torso: 122, neck: 112, aF: [45, 45], ikF: 'prop', aN: [0, 0], lF: [0, 0, 90], lN: [-12, -6, 90] }, 700, 'back'],
    ]),
    'crossover-arm-stretch': G('front', [], 'hip', {
      start: 'De pie o sentado, hombros relajados', go: 'Cruza un brazo por delante del pecho y acércalo con el otro',
      back: 'Suelta y cambia de lado',
    }, [
      [FRONT, 800, 'start'],
      [P(FRONT, { aN: [92, 96], ikF: 'upperN' }), 1000, 'go'],
      [P(FRONT, { aN: [92, 96], ikF: 'upperN' }), 'hold', 'hold'],
      [FRONT, 900, 'back'],
    ], { upper: true }),
    'external-rotation-band': G('front', ['band'], 'hip', {
      start: 'Codo a 90° pegado al cuerpo, banda hacia el otro lado', go: 'Gira el antebrazo hacia afuera sin despegar el codo',
      back: 'Vuelve despacio',
    }, [
      [P(FRONT, { aN: [-2, 0], rotN: -45 }), 800, 'start'],
      [P(FRONT, { aN: [-2, 0], rotN: 55 }), 900, 'go'],
      [P(FRONT, { aN: [-2, 0], rotN: 55 }), 'hold', 'hold'],
      [P(FRONT, { aN: [-2, 0], rotN: -45 }), 900, 'back'],
    ], { upper: true, band: { ref: 'shF', dx: 0.5, dy: 0.32, hands: ['N'] } }),
    'internal-rotation-band': G('front', ['band'], 'hip', {
      start: 'Codo a 90° pegado al cuerpo, banda hacia el mismo lado', go: 'Lleva el antebrazo hacia el abdomen',
      back: 'Vuelve despacio',
    }, [
      [P(FRONT, { aN: [-2, 0], rotN: 50 }), 800, 'start'],
      [P(FRONT, { aN: [-2, 0], rotN: -50 }), 900, 'go'],
      [P(FRONT, { aN: [-2, 0], rotN: -50 }), 'hold', 'hold'],
      [P(FRONT, { aN: [-2, 0], rotN: 50 }), 900, 'back'],
    ], { upper: true, band: { ref: 'shN', dx: -0.5, dy: 0.32, hands: ['N'] } }),
    'standing-row': G('side', ['band'], 'anN', {
      start: 'De pie frente a la banda, brazos al frente', go: 'Lleva los codos atrás, pegados al cuerpo, y junta las escápulas',
      back: 'Vuelve despacio',
    }, [
      [P(STAND, { aN: [85, 88], aF: [83, 86] }), 800, 'start'],
      [P(STAND, { aN: [-28, 72], aF: [-26, 70] }), 900, 'go'],
      [P(STAND, { aN: [-28, 72], aF: [-26, 70] }), 'hold', 'hold'],
      [P(STAND, { aN: [85, 88], aF: [83, 86] }), 900, 'back'],
    ], { band: { ref: 'shN', dx: 1.05, dy: 0.05, hands: ['N', 'F'] } }),
    'scapula-setting': G('back', [], 'hip', {
      start: 'Sentado, espalda recta (vista de espalda)', go: 'Junta las escápulas hacia atrás y abajo',
      back: 'Relaja y repite',
    }, [
      [P(FRONT, { scap: 0 }), 800, 'start'],
      [P(FRONT, { scap: 1 }), 800, 'go'],
      [P(FRONT, { scap: 1 }), 'hold', 'hold'],
      [P(FRONT, { scap: 0 }), 700, 'back'],
    ], { upper: true }),
  };

  const VIEW_LABEL = { side: 'Vista de lado', front: 'Vista de frente', back: 'Vista de espalda',
    lying: 'Acostado de lado, visto de frente' };
  const viewLabel = (guide) => (guide.plane ? 'Acostado de lado, visto desde arriba y de frente' : VIEW_LABEL[guide.view]);

  // ------------------------------------------------------------------ geometría
  /** Puntos del cuerpo sin brazos resueltos por IK todavía. y hacia abajo; todavía sin apoyar en el suelo. */
  function bodyPoints(pose, guide) {
    const front = guide.view === 'front' || guide.view === 'back';
    const hip = { x: 0, y: 0 };
    const torso = pose.torso == null ? 180 : pose.torso;
    const sh = add(hip, torso, L.torso);
    const yawK = Math.cos(rad(pose.yaw || 0));
    const scap = pose.scap || 0;
    const p = { hip, sh };
    if (front) {
      const half = L.shoulderHalf * yawK * (1 - 0.1 * scap);
      p.shN = { x: sh.x - half, y: sh.y + 0.025 * scap };
      p.shF = { x: sh.x + half, y: sh.y + 0.025 * scap };
      p.hipN = { x: -L.hipHalf, y: 0 };
      p.hipF = { x: L.hipHalf, y: 0 };
    } else {
      p.shN = p.shF = sh;
      p.hipN = p.hipF = hip;
    }
    p.head = add(sh, pose.neck == null ? torso : pose.neck, L.neck);
    const rel = pose.armsRel ? torso - 180 : 0;
    ['N', 'F'].forEach((s) => {
      const arm = pose[`a${s}`] || [0, 0];
      p[`el${s}`] = add(p[`sh${s}`], arm[0] + rel, L.upper);
      const rot = pose[`rot${s}`];
      if (rot != null) {                                  // antebrazo que gira en el plano horizontal, visto de frente
        const out = s === 'N' ? -1 : 1;
        p[`wr${s}`] = { x: p[`el${s}`].x + out * Math.sin(rad(rot)) * L.fore, y: p[`el${s}`].y + 0.07 * Math.cos(rad(rot)) };
      } else {
        p[`wr${s}`] = add(p[`el${s}`], arm[1] + rel, L.fore);
      }
      if (!guide.upper) {
        const leg = pose[`l${s}`] || [0, 0, 90];
        p[`kn${s}`] = add(p[`hip${s}`], leg[0], L.thigh);
        p[`an${s}`] = add(p[`kn${s}`], leg[1], L.shin);
        p[`to${s}`] = add(p[`an${s}`], leg[2], L.foot);
      }
    });
    return p;
  }

  /** Brazo de dos segmentos que llega a un punto; el codo queda del lado de abajo. */
  function reach(shoulder, target) {
    const a = L.upper, b = L.fore;
    const d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, dist(shoulder, target)));
    const base = angleOf({ x: target.x - shoulder.x, y: target.y - shoulder.y });
    const off = deg(Math.acos((a * a + d * d - b * b) / (2 * a * d)));
    const e1 = add(shoulder, base + off, a);
    const e2 = add(shoulder, base - off, a);
    const elbow = e1.y >= e2.y ? e1 : e2;
    const wrist = add(elbow, angleOf({ x: target.x - elbow.x, y: target.y - elbow.y }), b);
    return { elbow, wrist };
  }

  const KEYS = ['hip', 'sh', 'shN', 'shF', 'hipN', 'hipF', 'head', 'elN', 'wrN', 'elF', 'wrF', 'knN', 'anN', 'toN', 'knF', 'anF', 'toF'];
  function shift(p, dx, dy) {
    const out = {};
    Object.keys(p).forEach((k) => { out[k] = p[k] && Number.isFinite(p[k].x) ? { x: p[k].x + dx, y: p[k].y + dy } : p[k]; });
    return out;
  }

  /** Apoya la figura en el suelo (y = 0): el punto más bajo toca el piso. En las vistas de medio cuerpo, la cadera. */
  function ground(p, guide) {
    if (guide.upper) return shift(p, 0, -p.hip.y);
    let maxY = -Infinity;
    KEYS.forEach((k) => { if (p[k]) maxY = Math.max(maxY, p[k].y); });
    maxY = Math.max(maxY, p.head.y + L.head);
    return shift(p, 0, -maxY);
  }

  function ikTarget(name, p, ctx) {
    if (name === 'prop') return null;                     // lo resuelve el llamador con la mano del primer cuadro
    if (name === 'kneeN') return p.knN;
    if (name === 'thighN') return lerpP(p.hipN, p.knN, 0.62);
    if (name === 'upperN') return lerpP(p.shN, p.elN, 0.7);
    return ctx && ctx[name];
  }

  /** Pose → puntos apoyados en el suelo, con el ancla fija y los brazos que se agarran de algo resueltos. */
  function solvePose(pose, guide, ctx) {
    let p = ground(bodyPoints(pose, guide), guide);
    if (ctx && ctx.anchorX != null) p = shift(p, ctx.anchorX - p[guide.anchor].x, 0);
    ['N', 'F'].forEach((s) => {
      const ik = pose[`ik${s}`];
      if (!ik) return;
      const target = ik === 'prop' ? ctx && ctx.hands && ctx.hands[s] : ikTarget(ik, p, ctx);
      if (!target) return;
      const r = reach(p[`sh${s}`], target);
      p[`el${s}`] = r.elbow;
      p[`wr${s}`] = r.wrist;
    });
    return p;
  }

  /** Contexto fijo de una guía: ancla, manos del primer cuadro (para la silla o la mesa) y la caja de todo el recorrido. */
  function prepare(guide) {
    const first = ground(bodyPoints(guide.seq[0][0], guide), guide);
    const ctx = { anchorX: first[guide.anchor].x, hands: { N: first.wrN, F: first.wrF }, hip0: first.hip };
    // Cada cuadro clave con agarre guarda los ángulos que resultan, para poder interpolar con cuadros sin agarre.
    guide.seq.forEach((step) => {
      const pose = step[0];
      ['N', 'F'].forEach((s) => {
        if (!pose[`ik${s}`]) return;
        const pts = solvePose(pose, guide, ctx);
        const rel = pose.armsRel ? (pose.torso == null ? 180 : pose.torso) - 180 : 0;
        pose[`a${s}`] = [angleOf({ x: pts[`el${s}`].x - pts[`sh${s}`].x, y: pts[`el${s}`].y - pts[`sh${s}`].y }) - rel,
          angleOf({ x: pts[`wr${s}`].x - pts[`el${s}`].x, y: pts[`wr${s}`].y - pts[`el${s}`].y }) - rel];
      });
    });
    let box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: 0 };
    const grow = (pt, r = 0) => {
      box.minX = Math.min(box.minX, pt.x - r); box.maxX = Math.max(box.maxX, pt.x + r);
      box.minY = Math.min(box.minY, pt.y - r); box.maxY = Math.max(box.maxY, pt.y + r);
    };
    guide.seq.forEach((step) => {
      const p = solvePose(step[0], guide, ctx);
      KEYS.forEach((k) => { if (p[k]) grow(p[k]); });
      grow(p.head, L.head);
    });
    ctx.props = propShapes(guide, ctx, box);
    ctx.props.forEach((shape) => shape.pts.forEach((pt) => grow(pt)));
    ctx.box = box;
    return ctx;
  }

  /** Muebles y accesorios como polilíneas en coordenadas del mundo (y = 0 es el suelo). */
  function propShapes(guide, ctx, box) {
    const out = [];
    const line = (...pts) => out.push({ pts: pts.map(([x, y]) => ({ x, y })) });
    (guide.props || []).forEach((name) => {
      if (name === 'chair') {
        const h = ctx.hip0;
        const seat = h.y + 0.06;
        line([h.x - 0.24, seat - 0.48], [h.x - 0.24, 0]);
        line([h.x - 0.24, seat], [h.x + 0.2, seat]);
        line([h.x + 0.18, seat], [h.x + 0.18, 0]);
      } else if (name === 'chairBack') {
        const hand = ctx.hands.N;
        const x = hand.x + 0.02;
        line([x, hand.y], [x, 0]);
        line([x, -0.46], [x + 0.42, -0.46]);
        line([x + 0.4, -0.46], [x + 0.4, 0]);
      } else if (name === 'table') {
        const hand = ctx.hands.F;
        line([hand.x - 0.12, hand.y], [hand.x + 0.5, hand.y]);
        line([hand.x - 0.08, hand.y], [hand.x - 0.08, 0]);
        line([hand.x + 0.46, hand.y], [hand.x + 0.46, 0]);
      } else if (name === 'mat') {
        out.push({ pts: [{ x: box.minX - 0.12, y: 0 }, { x: box.maxX + 0.12, y: 0 }], mat: true });
      }
    });
    if (guide.band) {
      const first = solvePose(guide.seq[0][0], guide, ctx);
      const ref = first[guide.band.ref];
      ctx.bandAnchor = { x: ref.x + guide.band.dx, y: ref.y + guide.band.dy };
      out.push({ pts: [ctx.bandAnchor], anchor: true });
    }
    return out;
  }

  // ------------------------------------------------------------------ tiempo
  const ease = (k) => k * k * (3 - 2 * k);
  function lerpPose(a, b, k) {
    const out = {};
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((key) => {
      const va = a[key], vb = b[key];
      if (Array.isArray(va) || Array.isArray(vb)) {
        const xa = va || vb, xb = vb || va;
        out[key] = xa.map((v, i) => v + (xb[i] - v) * k);
      } else if (typeof va === 'number' || typeof vb === 'number') {
        const na = va == null ? (key === 'glow' || key === 'scap' || key === 'yaw' ? 0 : vb) : va;
        const nb = vb == null ? (key === 'glow' || key === 'scap' || key === 'yaw' ? 0 : va) : vb;
        out[key] = na + (nb - na) * k;
      } else if (key.startsWith('ik')) {
        if (va === vb) out[key] = va;                     // mismo agarre en los dos cuadros: se mantiene
      } else {
        out[key] = k < 0.5 ? va : vb;
      }
    });
    return out;
  }

  /** Línea de tiempo de una guía con el sostén de la dosis (la animación lo acorta a 3 s como mucho). */
  function timeline(guide, hold) {
    const holdMs = hold > 0 ? Math.min(hold, 3) * 1000 : 500;
    const steps = guide.seq.map(([pose, ms, cap]) => ({ pose, ms: ms === 'hold' ? holdMs : ms, cap }));
    return { steps, total: steps.reduce((s, x) => s + x.ms, 0) };
  }

  function captionFor(guide, cap, hold) {
    if (cap === 'hold') return hold > 0 ? `Sostén ${hold} s` : (guide.cues.top || guide.cues.go);
    return guide.cues[cap] || '';
  }

  /** Pose y texto en el instante t (ms, con vuelta al principio). */
  function frameAt(guide, hold, t) {
    const tl = timeline(guide, hold);
    let rest = ((t % tl.total) + tl.total) % tl.total;
    for (let i = 0; i < tl.steps.length; i += 1) {
      const step = tl.steps[i];
      if (rest <= step.ms || i === tl.steps.length - 1) {
        const prev = tl.steps[i === 0 ? tl.steps.length - 1 : i - 1].pose;
        const k = i === 0 ? 1 : ease(Math.min(1, rest / step.ms));
        return { pose: lerpPose(prev, step.pose, k), cap: step.cap, caption: captionFor(guide, step.cap, hold), step: i };
      }
      rest -= step.ms;
    }
    return null;
  }

  /** La pose final que se muestra en la vista sin animación: la del primer sostén (o la primera de movimiento). */
  function endPose(guide) {
    const hold = guide.seq.find((s) => s[2] === 'hold');
    return (hold || guide.seq[1])[0];
  }

  // ------------------------------------------------------------------ dibujo (solo navegador)
  function cssVar(name, fallback) {
    if (typeof getComputedStyle === 'undefined') return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function draw(g, guide, ctx, poses, w, h, opts = {}) {
    const box = ctx.box;
    const margin = 0.08;
    const n = poses.length;
    const bw = box.maxX - box.minX || 1;
    const bh = box.maxY - box.minY || 1;
    // Varias poses (inicio y final): lado a lado, o una debajo de la otra si la figura es ancha (acostada).
    const rows = n > 1 && bw / bh > 1.3;
    const cellW = rows ? w : w / n;
    const cellH = rows ? h / n : h;
    const labelH = opts.labels ? Math.max(14, cellH * 0.12) : 0;
    const s = Math.min((cellW * (1 - 2 * margin)) / bw, (cellH * (1 - 2 * margin) - labelH) / bh);
    g.clearRect(0, 0, w, h);
    if (!(s > 0)) return;                                 // lienzo todavía sin tamaño: lo redibuja el próximo cuadro
    const tape = cssVar('--tape', '#00F2FE');
    const muted = cssVar('--muted', '#8A9BB0');
    const ink = cssVar('--ink', '#E0E9EC');
    const alertC = cssVar('--hold', '#FFB800');
    const font = cssVar('--font-body', 'sans-serif');
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    poses.forEach((pose, i) => {
      const p = solvePose(pose, guide, ctx);
      const cx = rows ? 0 : cellW * i;
      const cy = rows ? cellH * i : 0;
      const ox = cx + cellW / 2 - ((box.minX + box.maxX) / 2) * s;
      const oy = cy + cellH * (1 - margin) - labelH - box.maxY * s;
      const X = (pt) => [ox + pt.x * s, oy + pt.y * s];
      const seg = (a, b, width, color, alpha = 1) => {
        if (!a || !b) return;
        g.globalAlpha = alpha;
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath(); g.moveTo(...X(a)); g.lineTo(...X(b)); g.stroke();
        g.globalAlpha = 1;
      };
      const lw = Math.max(2.5, s * 0.055);
      // suelo y accesorios
      if (guide.plane) {                                  // colchoneta vista desde arriba: área, sin línea de suelo
        const [x0, y0] = X({ x: box.minX - 0.12, y: box.minY - 0.08 });
        const [x1, y1] = X({ x: box.maxX + 0.12, y: box.maxY + 0.08 });
        g.globalAlpha = 0.16;
        g.fillStyle = muted;
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        g.globalAlpha = 1;
      } else if (!guide.upper) seg({ x: box.minX - 0.3, y: 0 }, { x: box.maxX + 0.3, y: 0 }, Math.max(1.5, s * 0.012), muted, 0.8);
      ctx.props.forEach((shape) => {
        if (shape.anchor) return;
        if (shape.mat) { if (!guide.plane) seg(shape.pts[0], shape.pts[1], Math.max(3, s * 0.035), muted, 0.55); return; }
        for (let k = 1; k < shape.pts.length; k += 1) seg(shape.pts[k - 1], shape.pts[k], Math.max(2, s * 0.025), muted, 0.9);
      });
      if (guide.upper) seg({ x: -0.28, y: 0.02 }, { x: 0.28, y: 0.02 }, Math.max(2, s * 0.025), muted, 0.8);   // asiento
      const side = guide.view === 'side' || guide.view === 'lying';
      const farAlpha = side ? 0.42 : 1;
      const limb = (sfx, alpha) => {
        seg(p[`sh${sfx}`], p[`el${sfx}`], lw, tape, alpha);
        seg(p[`el${sfx}`], p[`wr${sfx}`], lw, tape, alpha);
        if (!guide.upper) {
          seg(p[`hip${sfx}`], p[`kn${sfx}`], lw * 1.1, tape, alpha);
          seg(p[`kn${sfx}`], p[`an${sfx}`], lw * 1.1, tape, alpha);
          seg(p[`an${sfx}`], p[`to${sfx}`], lw * 0.9, tape, alpha);
        }
      };
      limb('F', farAlpha);
      // tronco, hombros y cadera
      if (side) seg(p.hip, p.sh, lw * 1.4, tape);
      else {
        seg(lerpP(p.hipN, p.hipF, 0.5), lerpP(p.shN, p.shF, 0.5), lw * 1.4, tape);
        seg(p.shN, p.shF, lw * 1.1, tape);
        seg(p.hipN, p.hipF, lw * 1.1, tape);
      }
      seg(lerpP(p.shN, p.shF, 0.5), p.head, lw * 0.8, tape);
      g.fillStyle = tape;
      const [hx, hy] = X(p.head);
      g.beginPath(); g.arc(hx, hy, L.head * s, 0, Math.PI * 2); g.fill();
      if (guide.view === 'front' && pose.yaw) {                           // nariz: hacia dónde mira el giro
        g.fillStyle = ink;
        g.beginPath(); g.arc(hx + Math.sin(rad(pose.yaw)) * L.head * 0.7 * s, hy, Math.max(2, s * 0.025), 0, Math.PI * 2); g.fill();
      }
      if (guide.view === 'back') {                                        // escápulas que se juntan
        const sc = pose.scap || 0;
        [[p.shN, 1], [p.shF, -1]].forEach(([shp, sign]) => {
          const cx = shp.x + sign * (0.09 + 0.03 * sc);
          g.globalAlpha = 0.8;
          g.strokeStyle = ink;
          g.lineWidth = Math.max(1.5, s * 0.018);
          g.beginPath();
          g.moveTo(...X({ x: cx, y: shp.y + 0.03 }));
          g.lineTo(...X({ x: cx + sign * 0.07, y: shp.y + 0.05 }));
          g.lineTo(...X({ x: cx, y: shp.y + 0.17 }));
          g.closePath();
          g.stroke();
          g.globalAlpha = 1;
        });
      }
      if (pose.glow) {                                                    // abdomen activo
        const c = lerpP(p.hip, p.sh, 0.4);
        const [cx, cy] = X(c);
        g.globalAlpha = 0.35 + 0.35 * pose.glow * (opts.pulse == null ? 1 : opts.pulse);
        g.fillStyle = alertC;
        g.beginPath(); g.ellipse(cx, cy, 0.16 * s, 0.07 * s, rad(-(side ? 0 : 90)) + 0, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
      limb('N', 1);
      if (guide.band && ctx.bandAnchor) {                                 // banda elástica
        guide.band.hands.forEach((sfx) => seg(p[`wr${sfx}`], ctx.bandAnchor, Math.max(1.5, s * 0.015), alertC, 0.9));
        g.fillStyle = muted;
        const [ax, ay] = X(ctx.bandAnchor);
        g.fillRect(ax - s * 0.03, ay - s * 0.03, s * 0.06, s * 0.06);
      }
      g.fillStyle = ink;                                                  // articulaciones
      ['elN', 'wrN', 'knN', 'anN', 'hip', 'sh'].forEach((k) => {
        if (!p[k] || (guide.upper && (k === 'knN' || k === 'anN'))) return;
        const [x, y] = X(p[k]);
        g.beginPath(); g.arc(x, y, Math.max(2, s * 0.022), 0, Math.PI * 2); g.fill();
      });
      if (opts.labels) {
        g.fillStyle = ink;
        g.font = `600 ${Math.round(Math.max(11, labelH * 0.7))}px ${font}`;
        g.textAlign = 'center';
        g.fillText(opts.labels[i], cx + cellW / 2, cy + cellH - labelH * 0.3);
      }
    });
  }

  /**
   * Monta la guía de un ejercicio en un lienzo. opts: hold (s), onCaption(texto, fase), autoplay ('always' | 'visible').
   * Devuelve { stop() }. Con movimiento reducido dibuja inicio y final lado a lado, sin animar.
   */
  function mount(canvas, exerciseId, opts = {}) {
    const guide = GUIDES[exerciseId];
    if (!guide || !canvas) return { stop() {} };
    const ctx = prepare(guide);
    const g = canvas.getContext('2d');
    const hold = opts.hold || 0;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let t0 = 0;
    let lastCap = null;
    let visible = opts.autoplay !== 'visible';
    const size = () => {
      const dpr = (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1;
      const w = Math.round((canvas.clientWidth || 300) * dpr);
      const hh = Math.round(w * 2 / 3);
      if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
      return { w, h: hh };
    };
    const caption = (text, cap) => {
      if (text === lastCap) return;
      lastCap = text;
      if (opts.onCaption) opts.onCaption(text, cap);
    };
    function still() {
      const { w, h } = size();
      draw(g, guide, ctx, [guide.seq[0][0], endPose(guide)], w, h, { labels: ['1 · Inicio', '2 · Final'] });
      caption(`${guide.cues.start}. ${guide.cues.go}${hold ? `; sostén ${hold} s` : ''}.`, 'still');
    }
    function tick(ts) {
      if (typeof canvas.isConnected === 'boolean' && !canvas.isConnected) { raf = 0; if (observer) observer.disconnect(); return; }
      if (!t0) t0 = ts;
      const f = frameAt(guide, hold, ts - t0);
      const { w, h } = size();
      draw(g, guide, ctx, [f.pose], w, h, { pulse: 0.5 + 0.5 * Math.sin(ts / 220) });
      caption(f.caption, f.cap);
      raf = requestAnimationFrame(tick);
    }
    function play() { if (!raf && !reduce && visible) { t0 = 0; raf = requestAnimationFrame(tick); } }
    function pause() { cancelAnimationFrame(raf); raf = 0; }
    let observer = null;
    // Sin animación se dibuja una sola vez: si el lienzo cambia de tamaño (pestaña oculta al cargar, giro del celular),
    // se vuelve a dibujar.
    let resizer = null;
    if (reduce && typeof ResizeObserver !== 'undefined') {
      resizer = new ResizeObserver(() => { if (canvas.clientWidth && canvas.width !== Math.round(canvas.clientWidth * ((typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1))) still(); });
      resizer.observe(canvas);
    }
    if (reduce) still();
    else if (opts.autoplay === 'visible' && typeof IntersectionObserver !== 'undefined') {
      draw(g, guide, ctx, [guide.seq[0][0]], size().w, size().h);
      observer = new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) play(); else pause();
      });
      observer.observe(canvas);
    } else { visible = true; play(); }
    return {
      stop() { pause(); if (observer) observer.disconnect(); if (resizer) resizer.disconnect(); },
      guide, viewLabel: viewLabel(guide),
    };
  }

  /** Textos de cada fase para guiar en vivo (seguimiento.js). */
  function cuesFor(exerciseId) {
    const guide = GUIDES[exerciseId];
    return guide ? Object.assign({ view: viewLabel(guide) }, guide.cues) : null;
  }

  return { GUIDES, VIEW_LABEL, L, bodyPoints, solvePose, prepare, frameAt, endPose, timeline, reach, mount, cuesFor };
});
