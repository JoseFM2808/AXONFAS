/* AXONFAS · componente "Figura de referencia" de cada ejercicio (design system §4, TD-44, ADR-014).
 *
 * Dibujo propio (no copia las imágenes de las fuentes): figura con volumen, posición inicial, movimiento, sostén y
 * vuelta, más la silla, la mesa, la banda o la colchoneta que use el ejercicio. Lo que se mueve va en el color activo,
 * la pose objetivo como silueta punteada y una flecha marca el recorrido. Colores, grosores y brillo salen de los tokens
 * --fig-* de docs/design-system/tokens.css; el marco y las etiquetas, de la clase .fig de hud.css. Todas las páginas lo
 * pintan con render(); con movimiento reducido muestra inicio y final lado a lado. Las poses son ángulos absolutos de cada segmento, en grados: 0 = hacia abajo,
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

  const VIEW_LABEL = { side: 'De lado', front: 'De frente', back: 'De espalda', lying: 'Acostado · de frente' };
  const viewLabel = (guide) => (guide.plane ? 'Acostado · desde arriba' : VIEW_LABEL[guide.view]);

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

  // ------------------------------------------------------------------ anatomía (marioneta muscular)
  // Cada segmento del cuerpo se dibuja con polígonos de músculos, en el mismo estilo del mapa muscular (body-map.js):
  // `m` son los nombres del mapa (o 'neutral' para cabeza, manos, pies y rodillas). Coordenadas locales del hueso:
  // u = fracción del hueso (0 = articulación de arriba, 1 = la de abajo; la cabeza usa metros), v = metros hacia el
  // frente del cuerpo (vista de lado) o hacia afuera (vistas de frente y de espalda). `sym` dibuja también el lado
  // espejado. Las uniones quedan con una separación oscura, como entre los músculos del mapa.
  const M = (m, pts, o) => Object.assign({ m: Array.isArray(m) ? m : [m], pts }, o || {});
  const HEAD_SIDE = [[0.115, 0], [0.1, 0.06], [0.06, 0.095], [0, 0.1], [-0.02, 0.122], [-0.045, 0.1], [-0.08, 0.085],
    [-0.105, 0.04], [-0.11, -0.02], [-0.08, -0.085], [-0.02, -0.11], [0.05, -0.105], [0.1, -0.06]];
  const HEAD_FRONT = [[0.115, 0], [0.1, 0.06], [0.06, 0.088], [0, 0.095], [-0.06, 0.088], [-0.1, 0.06], [-0.12, 0],
    [-0.1, -0.06], [-0.06, -0.088], [0, -0.095], [0.06, -0.088], [0.1, -0.06]];
  const FOREARM = [
    M('forearm', [[0.06, -0.034], [0.06, 0.036], [0.35, 0.04], [0.9, 0.022], [0.94, 0], [0.9, -0.022], [0.35, -0.038]]),
    M('neutral', [[1, -0.026], [1, 0.026], [1.2, 0.032], [1.38, 0.014], [1.4, -0.006], [1.2, -0.03]]),
  ];
  const NECK_FRONT = [M('neck', [[0.02, -0.045], [0.02, 0.045], [0.52, 0.04], [0.52, -0.04]])];
  const ARM_FRONT = (main) => [
    M(['front-deltoids', 'back-deltoids'], [[-0.1, -0.035], [-0.07, 0.05], [0.08, 0.072], [0.3, 0.05], [0.33, -0.03], [0.1, -0.05]]),
    M(main, [[0.36, -0.045], [0.36, 0.048], [0.7, 0.05], [0.95, 0.03], [0.95, -0.03], [0.7, -0.045]]),
  ];
  const LEGS_FRONT = {
    thigh: [
      M('quadriceps', [[0.08, -0.045], [0.08, 0.06], [0.4, 0.075], [0.85, 0.05], [0.95, 0.03], [0.95, -0.03], [0.6, -0.04], [0.3, -0.045]]),
      M('adductor', [[0.06, -0.055], [0.35, -0.05], [0.58, -0.046], [0.52, -0.075], [0.25, -0.088], [0.06, -0.085]]),
      M('abductors', [[-0.14, 0.058], [0.05, 0.062], [0.3, 0.072], [0.38, 0.1], [0.2, 0.128], [-0.1, 0.135]]),
    ],
    shin: [
      M('tibialis', [[0.07, -0.028], [0.07, 0.034], [0.5, 0.03], [0.92, 0.018], [0.92, -0.018], [0.5, -0.026]]),
      M('calves', [[0.1, 0.036], [0.28, 0.058], [0.52, 0.042], [0.56, 0.032]]),
      M('calves', [[0.1, -0.032], [0.28, -0.055], [0.52, -0.04], [0.56, -0.03]]),
    ],
    foot: [M('neutral', [[-0.1, -0.04], [0.95, -0.035], [1.05, 0], [0.95, 0.035], [-0.1, 0.04]])],
  };
  const SHAPES = {
    side: {
      torso: [
        M('gluteal', [[-0.13, -0.03], [-0.07, -0.115], [0.06, -0.135], [0.2, -0.12], [0.27, -0.07], [0.22, -0.03]]),
        M('abductors', [[0, -0.01], [0.05, 0.055], [0.2, 0.065], [0.26, 0.02], [0.24, -0.02]]),
        M('lower-back', [[0.3, -0.04], [0.29, -0.11], [0.45, -0.115], [0.6, -0.1], [0.6, -0.045]]),
        M('obliques', [[0.29, -0.025], [0.62, -0.035], [0.62, 0.065], [0.45, 0.075], [0.29, 0.065]]),
        M('abs', [[0.1, 0.075], [0.3, 0.085], [0.64, 0.085], [0.64, 0.125], [0.4, 0.13], [0.12, 0.11]]),
        M('upper-back', [[0.63, -0.03], [0.62, -0.1], [0.78, -0.125], [0.92, -0.11], [0.9, -0.03]]),
        M('chest', [[0.66, 0], [0.66, 0.1], [0.78, 0.135], [0.94, 0.12], [0.95, 0.02]]),
        M('trapezius', [[0.88, -0.085], [0.95, -0.11], [1.06, -0.06], [1.1, -0.02], [0.93, -0.015]]),
      ],
      neck: [M('neck', [[0.02, -0.04], [0.02, 0.035], [0.5, 0.035], [0.55, -0.035]])],
      head: [M('neutral', HEAD_SIDE, { head: true })],
      upper: [
        M('front-deltoids', [[-0.1, 0], [-0.06, 0.06], [0.08, 0.07], [0.3, 0.04], [0.33, 0]]),
        M('back-deltoids', [[-0.1, -0.005], [-0.06, -0.062], [0.08, -0.07], [0.3, -0.04], [0.33, -0.005]]),
        M('biceps', [[0.36, 0], [0.42, 0.048], [0.7, 0.05], [0.9, 0.028], [0.95, 0]]),
        M('triceps', [[0.36, -0.005], [0.42, -0.055], [0.7, -0.05], [0.9, -0.03], [0.95, -0.005]]),
      ],
      fore: FOREARM,
      thigh: [
        M('quadriceps', [[0.08, 0], [0.1, 0.07], [0.35, 0.088], [0.65, 0.078], [0.88, 0.055], [0.95, 0.025], [0.95, 0]]),
        M('hamstring', [[0.15, -0.005], [0.2, -0.072], [0.45, -0.08], [0.75, -0.062], [0.92, -0.035], [0.95, -0.005]]),
        M('neutral', [[0.95, 0.03], [1.02, 0.055], [1.08, 0.035], [1.04, 0.006]]),
      ],
      shin: [
        M('tibialis', [[0.07, 0.003], [0.08, 0.045], [0.45, 0.038], [0.85, 0.02], [0.93, 0.003]]),
        M('calves', [[0.06, -0.003], [0.1, -0.062], [0.3, -0.078], [0.5, -0.052], [0.6, -0.022], [0.6, -0.003]]),
        M('soleus', [[0.62, -0.003], [0.62, -0.024], [0.68, -0.04], [0.8, -0.032], [0.94, -0.012], [0.94, -0.003]]),
      ],
      foot: [M('neutral', [[-0.32, -0.05], [-0.36, -0.01], [-0.22, 0.03], [0.3, 0.03], [0.8, 0.012], [1.02, -0.012], [1, -0.05], [0.2, -0.055]])],
    },
    front: {
      torso: [
        M('chest', [[0.66, 0.012], [0.95, 0.02], [0.96, 0.15], [0.86, 0.17], [0.7, 0.14], [0.65, 0.08]], { sym: true }),
        M('abs', [[0.47, 0.008], [0.63, 0.008], [0.63, 0.058], [0.47, 0.058]], { sym: true }),
        M('abs', [[0.3, 0.008], [0.45, 0.008], [0.45, 0.058], [0.3, 0.056]], { sym: true }),
        M('abs', [[0.12, 0.008], [0.28, 0.008], [0.28, 0.054], [0.14, 0.05]], { sym: true }),
        M('obliques', [[0.12, 0.062], [0.6, 0.068], [0.64, 0.13], [0.42, 0.135], [0.18, 0.11]], { sym: true }),
        M('trapezius', [[0.96, 0.03], [1.1, 0.05], [1.03, 0.16], [0.97, 0.155]], { sym: true }),
        M('neutral', [[-0.1, 0.005], [0.1, 0.005], [0.1, 0.1], [-0.02, 0.118], [-0.1, 0.085]], { sym: true }),
      ],
      neck: NECK_FRONT,
      head: [M('neutral', HEAD_FRONT, { head: true })],
      upper: ARM_FRONT('biceps'),
      fore: FOREARM,
      thigh: LEGS_FRONT.thigh, shin: LEGS_FRONT.shin, foot: LEGS_FRONT.foot,
    },
    back: {
      torso: [
        M('trapezius', [[0.6, 0.006], [0.84, 0.05], [1, 0.16], [1.08, 0.04], [1.08, 0.006]], { sym: true, scap: true }),
        M('upper-back', [[0.42, 0.012], [0.62, 0.02], [0.86, 0.075], [0.94, 0.17], [0.72, 0.175], [0.5, 0.11]], { sym: true, scap: true }),
        M('lower-back', [[0.1, 0.008], [0.42, 0.008], [0.42, 0.075], [0.14, 0.065]], { sym: true }),
        M('gluteal', [[-0.16, 0.012], [0.08, 0.012], [0.09, 0.12], [-0.06, 0.14], [-0.17, 0.1]], { sym: true }),
      ],
      neck: NECK_FRONT,
      head: [M('neutral', HEAD_FRONT, { head: true })],
      upper: ARM_FRONT('triceps'),
      fore: FOREARM,
      thigh: LEGS_FRONT.thigh, shin: LEGS_FRONT.shin, foot: LEGS_FRONT.foot,
    },
  };
  const shapeSet = (guide) => SHAPES[guide.view === 'side' ? 'side' : guide.view === 'back' ? 'back' : 'front'];

  /** Envolvente convexa (cadena monótona): la silueta base de un segmento a partir de sus músculos. */
  function hull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    pts.forEach((pt) => { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); });
    const upper = [];
    pts.slice().reverse().forEach((pt) => { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); });
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  /**
   * Contorno de la figura: polígonos de músculos en coordenadas del mundo, en orden de dibujo (lo de atrás primero).
   * Cada segmento lleva primero su silueta base (base: true) y después sus músculos.
   * Devuelve [{ part, side, seg, m, neutral, base, far, pts }].
   */
  function outlines(p, guide, pose) {
    const set = shapeSet(guide);
    const side = guide.view === 'side';
    const lying = guide.view === 'lying';
    const front = guide.view === 'front' || guide.view === 'back';
    const yawK = Math.cos(rad((pose && pose.yaw) || 0));
    const scap = (pose && pose.scap) || 0;
    const out = [];
    const unit = (a, b) => { const d = dist(a, b) || 1e-6; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d, len: d }; };
    // perp: frente del cuerpo (de lado) o afuera (de frente). Extremidades: dirección del hueso girada -90°; tronco,
    // cuello y cabeza: +90° (apuntan hacia arriba). En las vistas de frente se elige el lado de afuera de cada miembro.
    function add(part, sideKey, a, b, opts = {}) {
      const shapes = set[part];
      if (!shapes || !a || !b) return;
      const d = opts.headFrame ? opts.headFrame : unit(a, b);
      const up = part === 'torso' || part === 'neck' || part === 'head';
      let perp = up ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
      if (!side && !up && opts.flip) perp = { x: -perp.x, y: -perp.y };
      const seg = part === 'head' ? 'neck' : (part === 'torso' || part === 'neck' ? part : part + sideKey);
      const mine = [];
      shapes.forEach((sh) => {
        const variants = sh.sym ? [1, -1] : [1];
        variants.forEach((sgn) => {
          const pts = sh.pts.map(([u, v0]) => {
            let v = v0 * sgn;
            if (sh.scap && scap) v = Math.sign(v) * Math.max(0.004, Math.abs(v) - 0.03 * scap);
            if (part === 'torso' && front) v *= 1 + (yawK - 1) * Math.max(0, Math.min(1, u));
            const along = sh.head ? u : u * d.len;
            return { x: a.x + d.x * along + perp.x * v, y: a.y + d.y * along + perp.y * v };
          });
          mine.push({ part, side: sideKey, seg, m: sh.m, neutral: sh.m[0] === 'neutral', base: false, far: opts.far || false, pts });
        });
      });
      if (part !== 'head') {
        out.push({ part, side: sideKey, seg, m: ['neutral'], neutral: true, base: true, far: opts.far || false,
          pts: hull([].concat(...mine.map((x) => x.pts))) });
      }
      out.push(...mine);
    }
    const arm = (s, far) => {
      const flip = front ? s === 'N' : lying ? s === 'F' : false;
      add('upper', s, p[`sh${s}`], p[`el${s}`], { far, flip });
      add('fore', s, p[`el${s}`], p[`wr${s}`], { far, flip });
    };
    const leg = (s, far) => {
      if (guide.upper) return;
      const flip = front ? s === 'N' : lying ? s === 'F' : false;
      add('thigh', s, p[`hip${s}`], p[`kn${s}`], { far, flip });
      add('shin', s, p[`kn${s}`], p[`an${s}`], { far, flip });
      add('foot', s, p[`an${s}`], p[`to${s}`], { far, flip });
    };
    const trunk = () => {
      add('torso', null, p.hip, p.sh);
      add('neck', null, p.sh, p.head);
      const nd = unit(p.sh, p.head);
      add('head', null, p.head, p.head, { headFrame: { x: nd.x, y: nd.y, len: 1 } });
    };
    if (front) { trunk(); arm('F', false); arm('N', false); leg('F', false); leg('N', false); }
    else { arm('F', true); leg('F', true); trunk(); leg('N', false); arm('N', false); }
    return out;
  }

  const KEYS = ['hip', 'sh', 'shN', 'shF', 'hipN', 'hipF', 'head', 'elN', 'wrN', 'elF', 'wrF', 'knN', 'anN', 'toN', 'knF', 'anF', 'toF'];
  function shift(p, dx, dy) {
    const out = {};
    Object.keys(p).forEach((k) => { out[k] = p[k] && Number.isFinite(p[k].x) ? { x: p[k].x + dx, y: p[k].y + dy } : p[k]; });
    return out;
  }

  /** Lo más bajo del contorno de la figura (planta del pie, espalda, glúteos...). */
  function lowestY(p, guide, pose) {
    let maxY = -Infinity;
    outlines(p, guide, pose).forEach((o) => o.pts.forEach((pt) => { if (pt.y > maxY) maxY = pt.y; }));
    return maxY;
  }

  /** Apoya la figura en el suelo (y = 0): el contorno más bajo toca el piso. En las vistas de medio cuerpo, la cadera. */
  function ground(p, guide, pose) {
    if (guide.upper) return shift(p, 0, -p.hip.y);
    return shift(p, 0, -lowestY(p, guide, pose));
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
    let p = ground(bodyPoints(pose, guide), guide, pose);
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
    const first = ground(bodyPoints(guide.seq[0][0], guide), guide, guide.seq[0][0]);
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
      outlines(p, guide, step[0]).forEach((o) => o.pts.forEach((pt) => grow(pt)));
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
        const seat = h.y + 0.085;
        line([h.x - 0.24, seat - 0.48], [h.x - 0.24, 0]);
        line([h.x - 0.24, seat], [h.x + 0.2, seat]);
        line([h.x + 0.18, seat], [h.x + 0.18, 0]);
      } else if (name === 'chairBack') {
        const hand = ctx.hands.N;
        const x = hand.x + 0.09;
        line([x, hand.y], [x, 0]);
        line([x, -0.46], [x + 0.42, -0.46]);
        line([x + 0.4, -0.46], [x + 0.4, 0]);
      } else if (name === 'table') {
        const hand = ctx.hands.F;
        const top = hand.y + 0.03;
        line([hand.x - 0.12, top], [hand.x + 0.5, top]);
        line([hand.x - 0.08, top], [hand.x - 0.08, 0]);
        line([hand.x + 0.46, top], [hand.x + 0.46, 0]);
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
        return { pose: lerpPose(prev, step.pose, k), cap: step.cap, caption: captionFor(guide, step.cap, hold), step: i,
          k: Math.min(1, rest / step.ms) };
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

  // ------------------------------------------------------------------ qué se mueve en cada ejercicio
  // Segmentos que se resaltan con el color activo. Grupos: aN/aF = brazo, lN/lF = pierna, feet = los dos pies,
  // abs = abdomen, scap = escápulas. Es una decisión de diseño por ejercicio, no se deduce de los ángulos.
  const FOCUS = {
    'sit-to-stand': ['torso', 'lN', 'lF'], 'tandem-stance': ['lN', 'lF'], 'one-leg-stand': ['lN'], 'calf-raises': ['feet'],
    'half-squat': ['torso', 'lN', 'lF'], 'leg-extension': ['shinN', 'footN'], 'straight-leg-raise': ['lN'],
    'hamstring-curl': ['shinN', 'footN'], 'supine-hamstring-stretch': ['shinN', 'footN'], 'hip-abduction': ['lN'],
    'clamshell': ['lN'], 'knee-to-chest': ['lN', 'aN', 'aF'], 'hip-bridge': ['torso', 'lN', 'lF'], 'bird-dog': ['aF', 'lN'],
    'abdominal-bracing': ['abs'], 'chin-retraction': ['neck'], 'neck-side-flexion': ['neck'],
    'seated-trunk-rotation': ['shoulders', 'aN', 'aF'], 'pendulum': ['aN'], 'crossover-arm-stretch': ['aN'],
    'external-rotation-band': ['foreN'], 'internal-rotation-band': ['foreN'], 'standing-row': ['aN', 'aF'],
    'scapula-setting': ['scap'],
  };
  const GROUPS = { aN: ['upperN', 'foreN'], aF: ['upperF', 'foreF'], lN: ['thighN', 'shinN', 'footN'],
    lF: ['thighF', 'shinF', 'footF'], feet: ['footN', 'footF'] };
  const SEGMENTS = {
    torso: ['hip', 'sh'], neck: ['sh', 'head'], shoulders: ['shN', 'shF'], hips: ['hipN', 'hipF'],
    upperN: ['shN', 'elN'], foreN: ['elN', 'wrN'], thighN: ['hipN', 'knN'], shinN: ['knN', 'anN'], footN: ['anN', 'toN'],
    upperF: ['shF', 'elF'], foreF: ['elF', 'wrF'], thighF: ['hipF', 'knF'], shinF: ['knF', 'anF'], footF: ['anF', 'toF'],
  };
  Object.entries(FOCUS).forEach(([id, f]) => { if (GUIDES[id]) GUIDES[id].focus = f; });
  GUIDES['one-leg-stand'].muscleLimbs = ['lN', 'lF'];      // la pierna de apoyo también trabaja

  /** Músculos del catálogo que trabaja el ejercicio, con los nombres del mapa (sóleo izquierdo y derecho son uno). */
  function musclesFor(exerciseId, catalog) {
    const C = catalog || (typeof self !== 'undefined' && self.AxonCatalog);
    const ex = C && C.get ? C.get(exerciseId) : null;
    return new Set((ex ? ex.muscles : []).map((m) => (m === 'left-soleus' || m === 'right-soleus' ? 'soleus' : m)));
  }

  /** En qué brazos y piernas se encienden esos músculos: los que se mueven (FOCUS), o todos si no se mueve ninguno de
   *  ese tipo, o los que la guía declare en `muscleLimbs` (apoyo en un pie: trabaja también la pierna de apoyo). */
  function limbsFor(guide) {
    if (guide.muscleLimbs) {
      const out = { aN: false, aF: false, lN: false, lF: false };
      guide.muscleLimbs.forEach((k) => { out[k] = true; });
      if (!out.aN && !out.aF) { out.aN = true; out.aF = true; }
      return out;
    }
    const f = focusOf(guide);
    const any = (names) => names.some((n) => f.has(n));
    const out = {
      aN: any(['upperN', 'foreN']), aF: any(['upperF', 'foreF']),
      lN: any(['thighN', 'shinN', 'footN']), lF: any(['thighF', 'shinF', 'footF']),
    };
    if (!out.aN && !out.aF) { out.aN = true; out.aF = true; }
    if (!out.lN && !out.lF) { out.lN = true; out.lF = true; }
    return out;
  }

  /** Segmentos (y marcas abs/scap) que se mueven en una guía. */
  function focusOf(guide) {
    const out = new Set();
    (guide.focus || []).forEach((k) => (GROUPS[k] || [k]).forEach((sname) => out.add(sname)));
    return out;
  }

  /** Punto que más se desplaza entre dos poses, entre los extremos de lo que se mueve: de ahí sale la flecha. */
  function motion(guide, ctx, fromPose, toPose) {
    const a = solvePose(fromPose, guide, ctx);
    const b = solvePose(toPose, guide, ctx);
    const keys = new Set();
    focusOf(guide).forEach((sname) => { if (SEGMENTS[sname]) SEGMENTS[sname].forEach((k) => keys.add(k)); });
    let best = null;
    keys.forEach((k) => {
      if (!a[k] || !b[k]) return;
      const d = dist(a[k], b[k]);
      if (!best || d > best.d) best = { key: k, from: a[k], to: b[k], d };
    });
    return best && best.d >= 0.06 ? best : null;
  }

  // Encuadre común: todas las figuras de cuerpo entero a la misma escala (y todas las de medio cuerpo entre sí), con
  // espacio arriba para las etiquetas del componente.
  const FRAME = { top: 0.17, bottom: 0.12, side: 0.06, fullHeight: 1.95, upperHeight: 1.05 };

  function layout(guide, ctx, w, h, n) {
    const box = ctx.box;
    const bw = box.maxX - box.minX || 1;
    const bh = box.maxY - box.minY || 1;
    const rows = n > 1 && bw / bh > 1.3;
    const areaTop = h * FRAME.top * (n > 1 ? 0.75 : 1);
    const cellW = rows ? w : w / n;
    const cellH = rows ? (h - areaTop) / n : h - areaTop;
    const labelH = n > 1 ? Math.max(12, cellH * 0.11) : 0;
    const usableH = cellH - labelH - h * FRAME.bottom * (rows ? 0.5 : 1);
    // La escala común se fija con el lienzo entero (una sola pose), así inicio y final no se achican por compartirlo.
    const ref = guide.upper ? FRAME.upperHeight : FRAME.fullHeight;
    const fullH = h - h * FRAME.top - h * FRAME.bottom;
    const common = Math.min(fullH / ref, fullH / bh, (w * (1 - 2 * FRAME.side)) / bw);
    const s = Math.min(common, usableH / bh, (cellW * (1 - 2 * FRAME.side)) / bw);
    const cells = Array.from({ length: n }, (_, i) => {
      const cx = rows ? 0 : cellW * i;
      const cy = areaTop + (rows ? cellH * i : 0);
      return {
        x: cx, y: cy, w: cellW, h: cellH,
        ox: cx + cellW / 2 - ((box.minX + box.maxX) / 2) * s,
        oy: cy + cellH - labelH - h * FRAME.bottom * (rows ? 0.5 : 1),
      };
    });
    return { rows, s, cells, labelH };
  }

  // ------------------------------------------------------------------ dibujo (solo navegador)
  /** Lee los tokens del design system (docs/design-system/tokens.css, sección "Figuras de referencia"). */
  function theme() {
    const css = typeof getComputedStyle === 'undefined' ? null : getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css && css.getPropertyValue(name).trim()) || fallback;
    const num = (name, fallback) => { const x = parseFloat(v(name, '')); return Number.isFinite(x) ? x : fallback; };
    return {
      bg: v('--fig-bg', '#050B1A'), muscle: v('--muscle', '#94A3B8'), muscleFill: num('--muscle-fill', 0.16),
      muscleEdge: num('--muscle-edge', 0.35), neutralFill: num('--muscle-neutral-fill', 0.08),
      activeMin: num('--muscle-active-min', 0.25), activeRange: num('--muscle-active-range', 0.7),
      active: v('--fig-active', '#00F2FE'), hold: v('--fig-hold', '#FFB800'), done: v('--fig-done', '#00FF88'),
      ghost: v('--fig-ghost', 'rgba(0,242,254,0.3)'), prop: v('--fig-prop', '#5E6E85'),
      floor: v('--fig-floor', 'rgba(0,242,254,0.3)'), band: v('--fig-band', '#CBD5E1'), ink: v('--ink', '#F1F5F9'),
      muted: v('--muted', '#94A3B8'), mono: v('--font-mono', 'monospace'), glow: num('--fig-glow', 14),
    };
  }

  /** Dibuja una pose en una celda, con el estilo del mapa muscular. opts: phase, level (0-1, cuánto trabajan los
   *  músculos), muscles (Set), eligible ({aN, aF, lN, lF}), ghost (pose objetivo), arrow, holdK, holdAt, dash, label. */
  function drawCell(g, guide, ctx, cell, s, pose, T, opts = {}) {
    const dpr = (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1;
    const p = solvePose(pose, guide, ctx);
    const X = (pt) => [cell.ox + pt.x * s, cell.oy + pt.y * s];
    const phase = opts.phase || 'start';
    const activeColor = phase === 'hold' ? T.hold : phase === 'top' ? T.done : T.active;
    const level = opts.level == null ? 0.6 : Math.max(0, Math.min(1, opts.level));
    const thin = Math.max(1, dpr);
    const propW = Math.max(2 * dpr, 0.028 * s);
    const line = (a, b, width, color, o = {}) => {
      if (!a || !b) return;
      g.save();
      g.globalAlpha = o.alpha == null ? 1 : o.alpha;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineCap = 'round';
      if (o.dash) { g.setLineDash(o.dash); g.lineDashOffset = o.dashOffset || 0; }
      g.beginPath(); g.moveTo(...X(a)); g.lineTo(...X(b)); g.stroke();
      g.restore();
    };
    const poly = (pts) => {
      g.beginPath();
      pts.forEach((pt, i) => { const [x, y] = X(pt); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
    };
    const parts = outlines(p, guide, pose);

    // suelo, sombra y apoyo
    if (guide.plane) {                                    // colchoneta vista desde arriba: área suave con borde
      const [x0, y0] = X({ x: ctx.box.minX - 0.1, y: ctx.box.minY - 0.06 });
      const [x1, y1] = X({ x: ctx.box.maxX + 0.1, y: ctx.box.maxY + 0.06 });
      const r = Math.min(12 * dpr, (y1 - y0) / 4);
      g.save();
      g.beginPath();
      if (g.roundRect) g.roundRect(x0, y0, x1 - x0, y1 - y0, r); else g.rect(x0, y0, x1 - x0, y1 - y0);
      g.globalAlpha = 0.08; g.fillStyle = T.prop; g.fill();
      g.globalAlpha = 0.55; g.strokeStyle = T.prop; g.lineWidth = thin; g.setLineDash([6 * dpr, 4 * dpr]); g.stroke();
      g.restore();
    } else if (guide.upper) {
      line({ x: -0.3, y: 0.03 }, { x: 0.3, y: 0.03 }, propW, T.prop);
    } else {
      const fy = X({ x: 0, y: 0 })[1];
      const grad = g.createLinearGradient(cell.x, 0, cell.x + cell.w, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.15, T.floor); grad.addColorStop(0.85, T.floor);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.save(); g.strokeStyle = grad; g.lineWidth = Math.max(1, 1.5 * dpr);
      g.beginPath(); g.moveTo(cell.x, fy); g.lineTo(cell.x + cell.w, fy); g.stroke(); g.restore();
      const low = [];
      parts.forEach((o) => o.pts.forEach((pt) => { if (pt.y > -0.06) low.push(pt.x); }));
      if (low.length) {
        const [cx] = X({ x: (Math.min(...low) + Math.max(...low)) / 2, y: 0 });
        const rx = ((Math.max(...low) - Math.min(...low)) / 2 + 0.1) * s;
        g.save(); g.fillStyle = 'rgba(0, 0, 0, 0.5)';
        g.beginPath(); g.ellipse(cx, fy + 0.01 * s, rx, 0.028 * s, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
    }
    ctx.props.forEach((shape) => {
      if (shape.anchor) return;
      if (shape.mat) {
        if (guide.plane) return;
        const [x0, y0] = X({ x: shape.pts[0].x, y: -0.03 });
        const [x1] = X({ x: shape.pts[1].x, y: 0 });
        g.save(); g.globalAlpha = 0.45; g.fillStyle = T.prop;
        g.fillRect(x0, y0, x1 - x0, 0.03 * s); g.restore();
        return;
      }
      for (let k = 1; k < shape.pts.length; k += 1) line(shape.pts[k - 1], shape.pts[k], propW, T.prop);
    });

    // silueta holográfica de la posición a la que hay que llegar
    if (opts.ghost) {
      const q = solvePose(opts.ghost, guide, ctx);
      const moving = focusOf(guide);
      g.save();
      g.fillStyle = T.ghost;
      g.shadowColor = T.active;
      g.shadowBlur = T.glow * dpr * 0.8;
      outlines(q, guide, opts.ghost).forEach((o) => {
        if (!o.base || !moving.has(o.seg)) return;
        poly(o.pts);
        g.globalAlpha = 0.28;
        g.fill();
      });
      g.restore();
    }

    // flecha del movimiento
    if (opts.arrow) {
      const A = opts.arrow.from, B = opts.arrow.to;
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const len = dist(A, B);
      let nx = -(B.y - A.y) / len, ny = (B.x - A.x) / len;            // perpendicular, hacia afuera del cuerpo
      if ((mx - p.hip.x) * nx + (my - p.hip.y) * ny < 0) { nx = -nx; ny = -ny; }
      const ctl = { x: mx + nx * len * 0.28, y: my + ny * len * 0.28 };
      const [ax, ay] = X(A), [bx, by] = X(B), [cx, cy] = X(ctl);
      g.save();
      g.strokeStyle = T.active; g.globalAlpha = 0.9; g.lineWidth = Math.max(1.5 * dpr, 0.02 * s);
      g.setLineDash([7 * dpr, 6 * dpr]); g.lineDashOffset = -(opts.dash || 0);
      g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(cx, cy, bx, by); g.stroke();
      g.setLineDash([]);
      const ang = Math.atan2(by - cy, bx - cx);
      const hs = Math.max(6 * dpr, 0.07 * s);
      g.fillStyle = T.active;
      g.beginPath(); g.moveTo(bx, by);
      g.lineTo(bx - hs * Math.cos(ang - 0.45), by - hs * Math.sin(ang - 0.45));
      g.lineTo(bx - hs * Math.cos(ang + 0.45), by - hs * Math.sin(ang + 0.45));
      g.closePath(); g.fill();
      g.restore();
    }

    // cuerpo: polígonos de músculos (lo de atrás primero). Cada uno tapa lo que queda detrás con el fondo del marco y
    // después lleva el relleno y el borde del mapa muscular; los que trabajan se encienden según `level`.
    const muscles = opts.muscles || new Set();
    const eligible = opts.eligible || {};
    const limbKey = (o) => (o.side == null ? null
      : (o.part === 'upper' || o.part === 'fore' ? 'a' : 'l') + o.side);
    parts.forEach((o) => {
      const key = limbKey(o);
      const on = !o.neutral && o.m.some((m) => muscles.has(m)) && (key == null || eligible[key] !== false);
      const farK = o.far ? 0.55 : 1;
      poly(o.pts);
      g.save();
      g.fillStyle = T.bg;
      g.fill();
      if (o.base) {                                       // cuerpo sólido debajo de los músculos
        g.globalAlpha = 0.75 * T.muscleFill * farK;
        g.fillStyle = T.muscle;
        g.fill();
        g.globalAlpha = 0.5 * T.muscleEdge * farK;
        g.strokeStyle = T.muscle;
        g.lineWidth = thin;
        g.lineJoin = 'round';
        g.stroke();
        g.restore();
        return;
      }
      if (on) {
        g.globalAlpha = (T.activeMin + T.activeRange * level) * farK;
        g.fillStyle = activeColor;
        if (!o.far) { g.shadowColor = activeColor; g.shadowBlur = T.glow * dpr * (0.3 + 0.7 * level); }
        g.fill();
        g.shadowBlur = 0;
        g.globalAlpha = 0.6 * farK;
        g.strokeStyle = activeColor;
      } else {
        g.globalAlpha = (o.neutral ? T.neutralFill : T.muscleFill) * farK;
        g.fillStyle = T.muscle;
        g.fill();
        g.globalAlpha = T.muscleEdge * farK;
        g.strokeStyle = T.muscle;
      }
      g.lineWidth = thin * 1.2;
      g.lineJoin = 'round';
      g.stroke();
      g.restore();
    });

    // ojos: hacia dónde mira la persona (uno de perfil, dos de frente; de espalda no se ven)
    if (guide.view !== 'back') {
      const d = (() => { const len = dist(p.sh, p.head) || 1; return { x: (p.head.x - p.sh.x) / len, y: (p.head.y - p.sh.y) / len }; })();
      const face = { x: -d.y, y: d.x };
      const eye = (u, v) => {
        const [x, y] = X({ x: p.head.x + d.x * u + face.x * v, y: p.head.y + d.y * u + face.y * v });
        g.beginPath(); g.arc(x, y, Math.max(1.5 * dpr, 0.012 * s), 0, Math.PI * 2); g.fill();
      };
      g.save(); g.fillStyle = T.ink; g.globalAlpha = 0.75;
      if (guide.view === 'side') eye(0.02, 0.06);
      else {
        const off = Math.sin(rad(pose.yaw || 0)) * 0.05;
        eye(0.015, 0.04 + off); eye(0.015, -0.04 + off);
      }
      g.restore();
    }

    // banda elástica y su anclaje
    if (guide.band && ctx.bandAnchor) {
      guide.band.hands.forEach((sfx) => line(p[`wr${sfx}`], ctx.bandAnchor, Math.max(1.5 * dpr, 0.016 * s), T.band,
        { dash: [3 * dpr, 3 * dpr], alpha: 0.9 }));
      const [ax, ay] = X(ctx.bandAnchor);
      const r = Math.max(3 * dpr, 0.035 * s);
      g.save(); g.fillStyle = T.prop; g.fillRect(ax - r, ay - r, 2 * r, 2 * r); g.restore();
    }

    // anillo del sostén alrededor del punto que se mueve
    if (opts.holdK != null && opts.holdAt) {
      const [x, y] = X(opts.holdAt);
      const r = Math.max(8 * dpr, 0.11 * s);
      g.save();
      g.lineWidth = Math.max(2 * dpr, 0.024 * s);
      g.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = T.hold; g.shadowColor = T.hold; g.shadowBlur = T.glow * dpr * 0.6;
      g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, opts.holdK)); g.stroke();
      g.restore();
    }

    if (opts.label) {
      g.save();
      g.fillStyle = T.muted;
      g.font = `700 ${Math.round(Math.max(9 * dpr, Math.min(13 * dpr, opts.labelH * 0.5)))}px ${T.mono}`;
      g.textAlign = 'center';
      g.fillText(opts.label.toUpperCase(), cell.x + cell.w / 2, cell.y + cell.h - opts.labelH * 0.25);
      g.restore();
    }
  }

  // ------------------------------------------------------------------ componente .fig (design system)
  const PHASE = { start: 'Inicio', go: 'Movimiento', go2: 'Movimiento', hold: 'Sostén', top: 'Posición final', back: 'Vuelta' };
  const phaseOf = (cap, hold) => (cap === 'go2' ? 'go' : cap === 'hold' && !(hold > 0) ? 'top' : cap);

  function chipText(phase, hold) {
    const order = ['start', 'go', phase === 'top' ? 'top' : 'hold', 'back'];
    const n = order.indexOf(phase) + 1;
    const label = phase === 'hold' ? `${PHASE.hold} ${hold} s` : PHASE[phase];
    return `${n} · ${label}`;
  }

  /** Para cada paso: pose de partida, pose objetivo y flecha (se calcula una vez por guía). */
  function plan(guide, ctx, steps) {
    const holdIdx = steps.map((st, i) => (st.cap === 'hold' ? i : -1)).filter((i) => i >= 0);
    return steps.map((st, i) => {
      if (!['start', 'go', 'go2'].includes(st.cap)) return {};
      const j = holdIdx.find((x) => x >= i);
      const target = j != null ? steps[j].pose : endPose(guide);
      let from = steps[0].pose;
      for (let k = i; k >= 0; k -= 1) if (steps[k].cap === 'start' || steps[k].cap === 'back') { from = steps[k].pose; break; }
      return { target, arrow: motion(guide, ctx, from, target) };
    });
  }

  /**
   * Componente "Figura de referencia" (design system §4): pinta en `container` el marco, el lienzo, la etiqueta de la
   * fase, la vista y el texto. opts: hold (s), variant ('card' | 'pip' | 'large'), autoplay ('visible' | 'always'),
   * caption (false = sin texto). Con movimiento reducido muestra inicio y final, sin animar. Devuelve { stop() }.
   */
  function render(container, exerciseId, opts = {}) {
    const guide = GUIDES[exerciseId];
    if (!guide || !container || typeof document === 'undefined') return { stop() {} };
    const ctx = prepare(guide);
    const hold = opts.hold || 0;
    const variant = opts.variant || 'card';
    const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
    container.innerHTML = '';
    const fig = el('figure', `fig fig--${variant}`);
    fig.dataset.phase = 'start';
    const stage = el('div', 'fig-stage');
    const canvas = el('canvas', 'fig-canvas');
    const name = (typeof self !== 'undefined' && self.AxonCatalog && self.AxonCatalog.get(exerciseId)) ? self.AxonCatalog.get(exerciseId).name : exerciseId;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Figura de referencia: ${name}`);
    const chip = el('span', 'fig-chip');
    const view = el('span', 'fig-view', viewLabel(guide));
    stage.append(canvas, chip, view);
    fig.appendChild(stage);
    const cap = opts.caption === false ? null : el('figcaption', 'fig-cap');
    if (cap) fig.appendChild(cap);
    container.appendChild(fig);

    const g = canvas.getContext('2d');
    const tl = timeline(guide, hold);
    const steps = plan(guide, ctx, tl.steps);
    const muscles = musclesFor(exerciseId);                 // los mismos que pinta el mapa muscular
    const eligible = limbsFor(guide);
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, t0 = 0, last = '', visible = opts.autoplay !== 'visible', observer = null, resizer = null;
    const size = () => {
      const dpr = (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1;
      const w = Math.round((canvas.clientWidth || 0) * dpr);
      const h = Math.round((canvas.clientHeight || 0) * dpr);
      if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
      return { w: canvas.width, h: canvas.height, ok: Boolean(w && h) };
    };
    const setText = (phase, chipT, capT) => {
      const key = `${phase}|${chipT}|${capT}`;
      if (key === last) return;
      last = key;
      fig.dataset.phase = phase;
      chip.textContent = chipT;
      if (cap) cap.textContent = capT;
    };
    function still() {
      const { w, h, ok } = size();
      if (!ok) return;
      const T = theme();
      const lay = layout(guide, ctx, w, h, 2);
      g.clearRect(0, 0, w, h);
      const end = endPose(guide);
      const first = steps.find((x) => x.arrow) || {};
      drawCell(g, guide, ctx, lay.cells[0], lay.s, guide.seq[0][0], T, { phase: 'start', level: 0.2, muscles, eligible,
        ghost: end, arrow: first.arrow, label: '1 · Inicio', labelH: lay.labelH });
      drawCell(g, guide, ctx, lay.cells[1], lay.s, end, T, { phase: hold > 0 ? 'hold' : 'top', level: 1, muscles, eligible,
        label: '2 · Final', labelH: lay.labelH });
      setText('go', 'Inicio → final', `${guide.cues.start}. ${guide.cues.go}${hold > 0 ? `; sostén ${hold} s` : ''}.`);
    }
    function tick(ts) {
      if (typeof canvas.isConnected === 'boolean' && !canvas.isConnected) { raf = 0; if (observer) observer.disconnect(); return; }
      raf = requestAnimationFrame(tick);
      const { w, h, ok } = size();
      if (!ok) return;
      if (!t0) t0 = ts;
      const f = frameAt(guide, hold, ts - t0);
      const phase = phaseOf(f.cap, hold);
      const info = steps[f.step] || {};
      const T = theme();
      const lay = layout(guide, ctx, w, h, 1);
      g.clearRect(0, 0, w, h);
      const holdStep = f.cap === 'hold' && hold > 0;
      const holdAt = holdStep ? (motion(guide, ctx, guide.seq[0][0], tl.steps[f.step].pose) || {}).to : null;
      // Cuánto trabajan los músculos: poco al inicio, suben con el movimiento, al máximo en el sostén y bajan al volver.
      const level = f.cap === 'start' ? 0.15 : (f.cap === 'go' || f.cap === 'go2') ? 0.15 + 0.85 * f.k
        : f.cap === 'back' ? 1 - 0.85 * f.k : 0.92 + 0.08 * Math.sin(ts / 180);
      drawCell(g, guide, ctx, lay.cells[0], lay.s, f.pose, T, {
        phase, level, muscles, eligible, ghost: info.target, arrow: info.arrow, dash: (ts / 25) % 1000,
        holdK: holdStep ? f.k : null, holdAt,
      });
      setText(phase, chipText(phase, hold), f.caption);
    }
    function play() { if (!raf && !reduce && visible) { t0 = 0; raf = requestAnimationFrame(tick); } }
    function pause() { cancelAnimationFrame(raf); raf = 0; }
    if (reduce) {
      still();
      if (typeof ResizeObserver !== 'undefined') { resizer = new ResizeObserver(() => still()); resizer.observe(canvas); }
    } else if (opts.autoplay === 'visible' && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) play(); else pause();
      });
      observer.observe(canvas);
    } else { visible = true; play(); }
    return {
      el: fig,
      stop() { pause(); if (observer) observer.disconnect(); if (resizer) resizer.disconnect(); },
    };
  }

  /** Textos de cada fase para guiar en vivo (seguimiento.js). */
  function cuesFor(exerciseId) {
    const guide = GUIDES[exerciseId];
    return guide ? Object.assign({ view: viewLabel(guide) }, guide.cues) : null;
  }

  return { GUIDES, VIEW_LABEL, FOCUS, SEGMENTS, FRAME, SHAPES, L, bodyPoints, solvePose, prepare, frameAt, endPose, timeline,
    reach, focusOf, motion, layout, outlines, lowestY, musclesFor, render, cuesFor };
});
