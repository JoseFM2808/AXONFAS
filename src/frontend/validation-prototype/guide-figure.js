/* AXONFAS · componente "Figura de referencia" de cada ejercicio (design system §4, TD-44, ADR-014).
 *
 * Marioneta muscular en 3D con el estilo del mapa muscular: un esqueleto con ángulos anatómicos (flexión, abducción y
 * rotación de cadera y hombro; rodilla, codo y tobillo; inclinación y giro del tronco; cuello), visto por una cámara en
 * tres cuartos. Cada segmento se dibuja con los polígonos de músculos del mapa y elige mostrar su perfil, su frente o
 * su espalda según cómo lo ve la cámara; lo que está más lejos va detrás y más tenue, y lo que apunta a la cámara se
 * acorta. Suelo, silla, mesa, colchoneta y banda también se proyectan en 3D. Dibujo propio: no copia las imágenes de
 * las fuentes. Colores y trazos: tokens --muscle-* y --fig-* de docs/design-system/tokens.css; marco y etiquetas: clase
 * .fig de hud.css. Todas las páginas lo pintan con render(); con movimiento reducido muestra inicio y final.
 *
 * Mundo: x hacia adelante de la persona de pie, y hacia arriba, z hacia su derecha. "N" es el lado derecho (el cercano
 * en las vistas de lado) y "F" el izquierdo. La geometría corre también en Node (tests); el dibujo, en el navegador.
 */
(function (root, factory) {
  const I18N = (root && root.AxonI18n) || (typeof module === 'object' && module.exports ? require('./i18n.js') : null);
  const api = factory(I18N);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonGuide = api;
})(typeof self !== 'undefined' ? self : this, function (I18N) {
  'use strict';

  // Textos visibles en el idioma de la página (ADR-030). Los de cada fase (cues de GUIDES) siguen en español en este
  // archivo; en inglés salen de i18n/library.js (`data.guides`). Poses, cámaras y forma de GUIDES no cambian.
  const t = I18N ? I18N.t : (k) => k;

  // ------------------------------------------------------------------ vectores
  const rad = (d) => (d * Math.PI) / 180;
  const V = (x, y, z) => ({ x, y, z });
  const add3 = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
  const sub3 = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
  const mul3 = (a, k) => V(a.x * k, a.y * k, a.z * k);
  const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross3 = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const len3 = (a) => Math.sqrt(dot3(a, a));
  const norm3 = (a) => { const l = len3(a) || 1; return mul3(a, 1 / l); };
  const lerp3 = (a, b, k) => V(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
  /** Rota v alrededor del eje unitario k (Rodrigues), en grados. */
  function rot3(v, k, d) {
    const t = rad(d), c = Math.cos(t), s = Math.sin(t), kv = cross3(k, v), kd = dot3(k, v);
    return V(v.x * c + kv.x * s + k.x * kd * (1 - c), v.y * c + kv.y * s + k.y * kd * (1 - c), v.z * c + kv.z * s + k.z * kd * (1 - c));
  }
  const rotF = (fr, axis, d) => ({ d: rot3(fr.d, axis, d), f: rot3(fr.f, axis, d), l: rot3(fr.l, axis, d) });
  const perpTo = (v, axis) => sub3(v, mul3(axis, dot3(v, axis)));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);                  // en pantalla
  const lerpP = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

  const L = { torso: 0.52, neck: 0.2, head: 0.11, upper: 0.3, fore: 0.27, thigh: 0.45, shin: 0.43, foot: 0.18,
    shoulderHalf: 0.19, hipHalf: 0.1 };

  // ------------------------------------------------------------------ poses
  // body: postura base (de pie, boca arriba, de lado sobre el lado izquierdo, en cuatro apoyos); pitch la inclina.
  // trunk: [flexión, inclinación lateral, giro]; neck: [flexión, inclinación lateral, giro]; retract: cabeza atrás (m).
  // aN/aF: [flexión, abducción, codo, rotación externa, aducción horizontal] del hombro y el codo.
  // lN/lF: [flexión, abducción, rodilla, tobillo (punta abajo +), rotación externa] de cadera, rodilla y tobillo.
  // ikN/ikF: la mano se agarra de algo ('prop' = mueble, 'kneeN', 'thighN', 'upperN').
  const DEF = { body: 'stand', pitch: 0, trunk: [0, 0, 0], neck: [0, 0, 0], retract: 0, scap: 0,
    aN: [0, 8, 8, 0, 0], aF: [0, 8, 8, 0, 0], lN: [0, 4, 0, 0, 0], lF: [0, 4, 0, 0, 0] };
  const val = (pose, k) => (pose[k] == null ? DEF[k] : pose[k]);
  const P = (...parts) => Object.assign({}, ...parts);
  // Pie apoyado en el suelo: de pie (o sentado) el tobillo compensa lo que se inclina la pierna; boca arriba, igual pero
  // contra el suelo, que está a lo largo del cuerpo.
  const flat = (hf, kn, abd = 6, er = 0) => [hf, abd, kn, hf - kn, er];
  const flatUp = (hf, kn, abd = 6) => [hf, abd, kn, hf - kn + 90, 0];

  const SUPPORT = { aN: [42, 6, 55, 0, 0], aF: [42, 6, 55, 0, 0], ikN: 'prop', ikF: 'prop' };   // manos en el respaldo
  const ONE_HAND = { aN: [42, 6, 55, 0, 0], ikN: 'prop' };
  const CROSSED = { aN: [32, 0, 120, -75, 28], aF: [32, 0, 120, -75, 28] };                   // brazos cruzados
  const SEAT = { trunk: [4, 0, 0], lN: flat(90, 92, 7), lF: flat(90, 92, 7), aN: [30, 10, 50, 0, 0], aF: [30, 10, 50, 0, 0] };
  const SUPINE = { body: 'supine', aN: [0, 14, 5, 0, 0], aF: [0, 14, 5, 0, 0], lN: flatUp(50, 100), lF: flatUp(50, 100) };
  const SIDE_LYING = { body: 'side', aN: [4, 2, 10, 0, 0], aF: [168, 8, 110, 0, 0] };
  const QUAD = { body: 'quad', pitch: -11, aN: [101, 4, 0, 0, 0], aF: [101, 4, 0, 0, 0], lN: [79, 4, 90, 90, 0], lF: [79, 4, 90, 90, 0] };

  /** view: side | front | back | lying (de lado) | supine | quad, para la etiqueta y la cámara por defecto.
   *  upper: solo tronco, brazos y cabeza. anchor: punto que no se desliza por el suelo. seq: [pose, ms | 'hold', texto]. */
  const G = (view, props, anchor, cues, seq, extra) => Object.assign({ view, props, anchor, cues, seq }, extra || {});
  const CAM = { side: { az: 28, el: 8 }, front: { az: 90, el: 6 }, back: { az: -90, el: 6 }, lying: { az: 12, el: 30 },
    supine: { az: 24, el: 22 }, quad: { az: 26, el: 14 } };

  const GUIDES = {
    'sit-to-stand': G('side', ['chair'], 'anN', {
      start: 'Sentado, brazos cruzados sobre el pecho', go: 'Inclínate y ponte de pie sin usar los brazos',
      top: 'De pie, con rodillas y caderas estiradas', back: 'Vuelve a sentarte despacio',
    }, [
      [P(SEAT, CROSSED, { trunk: [8, 0, 0], lN: flat(90, 96, 7), lF: flat(90, 96, 7) }), 900, 'start'],
      [P(SEAT, CROSSED, { trunk: [42, 0, 0], lN: flat(90, 102, 7), lF: flat(90, 102, 7) }), 600, 'go'],
      [P(CROSSED, { lN: flat(0, 0, 7), lF: flat(0, 0, 7) }), 900, 'go'],
      [P(CROSSED, { lN: flat(0, 0, 7), lF: flat(0, 0, 7) }), 'hold', 'hold'],
      [P(SEAT, CROSSED, { trunk: [42, 0, 0], lN: flat(90, 102, 7), lF: flat(90, 102, 7) }), 900, 'back'],
      [P(SEAT, CROSSED, { trunk: [8, 0, 0], lN: flat(90, 96, 7), lF: flat(90, 96, 7) }), 600, 'back'],
    ]),
    'tandem-stance': G('side', ['chairBack'], 'hip', {
      start: 'De pie, con una mano en el respaldo', go: 'Pon un pie delante del otro, talón con punta',
      back: 'Vuelve a separar los pies',
    }, [
      [P(ONE_HAND), 900, 'start'],
      [P(ONE_HAND, { lN: [7, -6.5, 0, 7, 0], lF: [-7, -6.5, 0, -7, 0] }), 900, 'go'],
      [P(ONE_HAND, { lN: [7, -6.5, 0, 7, 0], lF: [-7, -6.5, 0, -7, 0] }), 'hold', 'hold'],
      [P(ONE_HAND), 900, 'back'],
    ]),
    'one-leg-stand': G('side', ['chairBack'], 'anF', {
      start: 'De pie, de costado a la silla y con una mano apoyada', go: 'Levanta un pie unos centímetros',
      back: 'Apoya el pie y cambia de pierna',
    }, [
      [P(ONE_HAND), 900, 'start'],
      [P(ONE_HAND, { lN: [15, 4, 60, 15, 0] }), 800, 'go'],
      [P(ONE_HAND, { lN: [15, 4, 60, 15, 0] }), 'hold', 'hold'],
      [P(ONE_HAND), 800, 'back'],
    ]),
    'calf-raises': G('side', ['chairBack'], 'toN', {
      start: 'De pie, manos en el respaldo de una silla', go: 'Sube sobre la punta de los pies, despacio',
      top: 'Arriba, con el peso en ambos pies', back: 'Baja los talones con control',
    }, [
      [P(SUPPORT), 800, 'start'],
      [P(SUPPORT, { lN: [0, 4, 0, 34, 0], lF: [0, 4, 0, 34, 0] }), 800, 'go'],
      [P(SUPPORT, { lN: [0, 4, 0, 34, 0], lF: [0, 4, 0, 34, 0] }), 'hold', 'hold'],
      [P(SUPPORT), 900, 'back'],
    ]),
    'half-squat': G('side', ['chairBack'], 'anN', {
      start: 'De pie, pies al ancho de los hombros, manos en la silla', go: 'Baja como para sentarte, solo hasta la mitad',
      back: 'Sube despacio, con el peso en los talones',
    }, [
      [P(SUPPORT, { lN: flat(0, 0, 9), lF: flat(0, 0, 9) }), 800, 'start'],
      [P(SUPPORT, { trunk: [30, 0, 0], lN: flat(60, 88, 11), lF: flat(60, 88, 11) }), 1000, 'go'],
      [P(SUPPORT, { trunk: [30, 0, 0], lN: flat(60, 88, 11), lF: flat(60, 88, 11) }), 'hold', 'hold'],
      [P(SUPPORT, { lN: flat(0, 0, 9), lF: flat(0, 0, 9) }), 1000, 'back'],
    ]),
    'leg-extension': G('side', ['chair'], 'hip', {
      start: 'Sentado con la espalda apoyada', go: 'Estira la rodilla hasta dejar la pierna recta',
      back: 'Baja despacio y cambia de pierna',
    }, [
      [SEAT, 800, 'start'],
      [P(SEAT, { lN: [90, 7, 4, -4, 0] }), 900, 'go'],
      [P(SEAT, { lN: [90, 7, 4, -4, 0] }), 'hold', 'hold'],
      [SEAT, 900, 'back'],
    ]),
    'straight-leg-raise': G('supine', ['mat'], 'hip', {
      start: 'Boca arriba, una rodilla doblada y la otra pierna estirada', go: 'Aprieta el muslo y levanta la pierna estirada',
      back: 'Bájala despacio',
    }, [
      [P(SUPINE, { lN: [0, 5, 0, 0, 0] }), 800, 'start'],
      [P(SUPINE, { lN: [45, 5, 0, 0, 0] }), 900, 'go'],
      [P(SUPINE, { lN: [45, 5, 0, 0, 0] }), 'hold', 'hold'],
      [P(SUPINE, { lN: [0, 5, 0, 0, 0] }), 900, 'back'],
    ]),
    'hamstring-curl': G('side', ['chairBack'], 'anF', {
      start: 'De pie, manos en el respaldo de una silla', go: 'Lleva el talón hacia el glúteo, muslos alineados',
      back: 'Baja despacio y cambia de pierna',
    }, [
      [P(SUPPORT), 800, 'start'],
      [P(SUPPORT, { lN: [2, 4, 92, 10, 0] }), 900, 'go'],
      [P(SUPPORT, { lN: [2, 4, 92, 10, 0] }), 'hold', 'hold'],
      [P(SUPPORT), 900, 'back'],
    ]),
    'supine-hamstring-stretch': G('supine', ['mat'], 'hip', {
      start: 'Boca arriba, sujeta un muslo por detrás', go: 'Estira la rodilla hasta sentir el estiramiento',
      back: 'Relaja y cambia de pierna',
    }, [
      [P(SUPINE, { lN: [88, 5, 90, 0, 0], ikN: 'thighN', ikF: 'thighN' }), 900, 'start'],
      [P(SUPINE, { lN: [88, 5, 4, -10, 0], ikN: 'thighN', ikF: 'thighN' }), 1000, 'go'],
      [P(SUPINE, { lN: [88, 5, 4, -10, 0], ikN: 'thighN', ikF: 'thighN' }), 'hold', 'hold'],
      [P(SUPINE, { lN: [88, 5, 90, 0, 0], ikN: 'thighN', ikF: 'thighN' }), 900, 'back'],
    ]),
    'hip-abduction': G('lying', ['mat'], 'hip', {
      start: 'Acostado de lado, la pierna de abajo doblada', go: 'Levanta la pierna de arriba, recta',
      back: 'Bájala despacio, sin balancearla',
    }, [
      [P(SIDE_LYING, { lF: [30, 0, 70, 0, 0], lN: [8, 0, 2, 0, 0] }), 800, 'start'],
      [P(SIDE_LYING, { lF: [30, 0, 70, 0, 0], lN: [8, 38, 2, 0, 0] }), 900, 'go'],
      [P(SIDE_LYING, { lF: [30, 0, 70, 0, 0], lN: [8, 38, 2, 0, 0] }), 'hold', 'hold'],
      [P(SIDE_LYING, { lF: [30, 0, 70, 0, 0], lN: [8, 0, 2, 0, 0] }), 900, 'back'],
    ]),
    'clamshell': G('lying', ['mat'], 'hip', {
      start: 'De lado, caderas y rodillas dobladas, pies juntos', go: 'Abre la rodilla de arriba sin separar los pies',
      back: 'Cierra despacio',
    }, [
      [P(SIDE_LYING, { lF: [45, 0, 90, 0, 0], lN: [45, 0, 90, 0, 0] }), 800, 'start'],
      [P(SIDE_LYING, { lF: [45, 0, 90, 0, 0], lN: [45, 30, 90, 0, 32] }), 900, 'go'],
      [P(SIDE_LYING, { lF: [45, 0, 90, 0, 0], lN: [45, 30, 90, 0, 32] }), 'hold', 'hold'],
      [P(SIDE_LYING, { lF: [45, 0, 90, 0, 0], lN: [45, 0, 90, 0, 0] }), 900, 'back'],
    ], { cam: { az: 18, el: 42 } }),
    'knee-to-chest': G('supine', ['mat'], 'hip', {
      start: 'Boca arriba, rodillas dobladas, manos en una rodilla', go: 'Lleva la rodilla hacia el pecho con las manos',
      back: 'Vuelve despacio y cambia de lado',
    }, [
      [P(SUPINE, { ikN: 'kneeN', ikF: 'kneeN' }), 800, 'start'],
      [P(SUPINE, { lN: [118, 6, 125, 20, 0], ikN: 'kneeN', ikF: 'kneeN' }), 1000, 'go'],
      [P(SUPINE, { lN: [118, 6, 125, 20, 0], ikN: 'kneeN', ikF: 'kneeN' }), 'hold', 'hold'],
      [P(SUPINE, { ikN: 'kneeN', ikF: 'kneeN' }), 900, 'back'],
    ]),
    'hip-bridge': G('supine', ['mat'], 'shN', {
      start: 'Boca arriba, rodillas dobladas, pies apoyados', go: 'Aprieta los glúteos y sube la cadera hasta alinearte',
      back: 'Baja vértebra por vértebra',
    }, [
      [SUPINE, 800, 'start'],
      [P(SUPINE, { pitch: -26, lN: [2, 6, 108, 16, 0], lF: [2, 6, 108, 16, 0] }), 1000, 'go'],
      [P(SUPINE, { pitch: -26, lN: [2, 6, 108, 16, 0], lF: [2, 6, 108, 16, 0] }), 'hold', 'hold'],
      [SUPINE, 1000, 'back'],
    ]),
    'bird-dog': G('quad', ['mat'], 'knF', {
      start: 'En cuatro apoyos, espalda plana', go: 'Estira un brazo adelante y la pierna contraria atrás',
      back: 'Vuelve a cuatro apoyos y cambia de lado',
    }, [
      [QUAD, 800, 'start'],
      [P(QUAD, { aF: [178, 4, 0, 0, 0], lN: [-10, 4, 0, 20, 0] }), 1000, 'go'],
      [P(QUAD, { aF: [178, 4, 0, 0, 0], lN: [-10, 4, 0, 20, 0] }), 'hold', 'hold'],
      [QUAD, 900, 'back'],
    ]),
    'abdominal-bracing': G('supine', ['mat'], 'hip', {
      start: 'Boca arriba, rodillas dobladas', go: 'Tensa el abdomen sin hundir la panza, respirando',
      back: 'Relaja y repite',
    }, [
      [SUPINE, 900, 'start'],
      [SUPINE, 500, 'go'],
      [SUPINE, 'hold', 'hold'],
      [SUPINE, 600, 'back'],
    ]),
    'chin-retraction': G('side', ['chair'], 'hip', {
      start: 'Sentado con la espalda recta', go: 'Lleva la cabeza atrás en línea recta, como doble mentón',
      back: 'Vuelve sin inclinar la cabeza',
    }, [
      [P(SEAT, { neck: [16, 0, 0] }), 800, 'start'],
      [P(SEAT, { neck: [-4, 0, 0], retract: 0.035 }), 700, 'go'],
      [P(SEAT, { neck: [-4, 0, 0], retract: 0.035 }), 'hold', 'hold'],
      [P(SEAT, { neck: [16, 0, 0] }), 700, 'back'],
    ]),
    'neck-side-flexion': G('front', [], 'hip', {
      start: 'Sentado, hombros relajados', go: 'Inclina la oreja hacia el hombro, sin subirlo',
      go2: 'Ahora hacia el otro lado', back: 'Vuelve al centro',
    }, [
      [{}, 700, 'start'],
      [{ neck: [0, 28, 0] }, 800, 'go'],
      [{ neck: [0, 28, 0] }, 'hold', 'hold'],
      [{}, 700, 'back'],
      [{ neck: [0, -28, 0] }, 800, 'go2'],
      [{ neck: [0, -28, 0] }, 'hold', 'hold'],
      [{}, 700, 'back'],
    ], { upper: true, cam: { az: 82, el: 6 } }),
    'seated-trunk-rotation': G('front', [], 'hip', {
      start: 'Sentado, brazos cruzados sobre el pecho', go: 'Gira el tronco hacia un lado sin mover la cadera',
      go2: 'Ahora hacia el otro lado', back: 'Vuelve al centro',
    }, [
      [P(CROSSED), 700, 'start'],
      [P(CROSSED, { trunk: [0, 0, 45] }), 900, 'go'],
      [P(CROSSED, { trunk: [0, 0, 45] }), 'hold', 'hold'],
      [P(CROSSED), 800, 'back'],
      [P(CROSSED, { trunk: [0, 0, -45] }), 900, 'go2'],
      [P(CROSSED, { trunk: [0, 0, -45] }), 'hold', 'hold'],
      [P(CROSSED), 800, 'back'],
    ], { upper: true, cam: { az: 72, el: 12 } }),
    'pendulum': G('side', ['table'], 'anF', {
      start: 'Inclinado, con una mano apoyada en la mesa', go: 'Deja colgar el brazo y muévelo con el balanceo del cuerpo',
      back: 'Sin forzar el hombro: el movimiento lo da el cuerpo',
    }, [
      [{ trunk: [62, 0, 0], aF: [70, 12, 30, 0, 0], ikF: 'prop', aN: [62, 4, 4, 0, 0], lN: flat(-12, 0, 6), lF: flat(8, 0, 6) }, 700, 'start'],
      [{ trunk: [62, 0, 0], aF: [70, 12, 30, 0, 0], ikF: 'prop', aN: [84, 4, 4, 0, 0], lN: flat(-12, 0, 6), lF: flat(8, 0, 6) }, 700, 'go'],
      [{ trunk: [62, 0, 0], aF: [70, 12, 30, 0, 0], ikF: 'prop', aN: [40, 4, 4, 0, 0], lN: flat(-12, 0, 6), lF: flat(8, 0, 6) }, 1100, 'go'],
      [{ trunk: [62, 0, 0], aF: [70, 12, 30, 0, 0], ikF: 'prop', aN: [84, 4, 4, 0, 0], lN: flat(-12, 0, 6), lF: flat(8, 0, 6) }, 1100, 'go'],
      [{ trunk: [62, 0, 0], aF: [70, 12, 30, 0, 0], ikF: 'prop', aN: [62, 4, 4, 0, 0], lN: flat(-12, 0, 6), lF: flat(8, 0, 6) }, 700, 'back'],
    ]),
    'crossover-arm-stretch': G('front', [], 'hip', {
      start: 'De pie o sentado, hombros relajados', go: 'Cruza un brazo por delante del pecho y acércalo con el otro',
      back: 'Suelta y cambia de lado',
    }, [
      [{}, 800, 'start'],
      [{ aN: [88, 0, 8, 0, 72], ikF: 'upperN' }, 1000, 'go'],
      [{ aN: [88, 0, 8, 0, 72], ikF: 'upperN' }, 'hold', 'hold'],
      [{}, 900, 'back'],
    ], { upper: true, cam: { az: 70, el: 10 } }),
    'external-rotation-band': G('front', ['band'], 'hip', {
      start: 'Codo a 90° pegado al cuerpo, banda hacia el otro lado', go: 'Gira el antebrazo hacia afuera sin despegar el codo',
      back: 'Vuelve despacio',
    }, [
      [{ aN: [4, 6, 90, -55, 0] }, 800, 'start'],
      [{ aN: [4, 6, 90, 50, 0] }, 900, 'go'],
      [{ aN: [4, 6, 90, 50, 0] }, 'hold', 'hold'],
      [{ aN: [4, 6, 90, -55, 0] }, 900, 'back'],
    ], { upper: true, cam: { az: 52, el: 14 }, band: { ref: 'shF', dx: 0.3, dy: -0.32, dz: -0.45, hands: ['N'] } }),
    'internal-rotation-band': G('front', ['band'], 'hip', {
      start: 'Codo a 90° pegado al cuerpo, banda hacia el mismo lado', go: 'Lleva el antebrazo hacia el abdomen',
      back: 'Vuelve despacio',
    }, [
      [{ aN: [4, 6, 90, 50, 0] }, 800, 'start'],
      [{ aN: [4, 6, 90, -55, 0] }, 900, 'go'],
      [{ aN: [4, 6, 90, -55, 0] }, 'hold', 'hold'],
      [{ aN: [4, 6, 90, 50, 0] }, 900, 'back'],
    ], { upper: true, cam: { az: 52, el: 14 }, band: { ref: 'shN', dx: 0.3, dy: -0.32, dz: 0.5, hands: ['N'] } }),
    'standing-row': G('side', ['band'], 'anN', {
      start: 'De pie frente a la banda, brazos al frente', go: 'Lleva los codos atrás, pegados al cuerpo, y junta las escápulas',
      back: 'Vuelve despacio',
    }, [
      [{ aN: [86, 6, 4, 0, 8], aF: [86, 6, 4, 0, 8] }, 800, 'start'],
      [{ aN: [-28, 10, 105, 0, 0], aF: [-28, 10, 105, 0, 0], scap: 1 }, 900, 'go'],
      [{ aN: [-28, 10, 105, 0, 0], aF: [-28, 10, 105, 0, 0], scap: 1 }, 'hold', 'hold'],
      [{ aN: [86, 6, 4, 0, 8], aF: [86, 6, 4, 0, 8] }, 900, 'back'],
    ], { band: { ref: 'sh', dx: 1.1, dy: -0.05, dz: 0, hands: ['N', 'F'] } }),
    'scapula-setting': G('back', [], 'hip', {
      start: 'Sentado, espalda recta (vista de espalda)', go: 'Junta las escápulas hacia atrás y abajo',
      back: 'Relaja y repite',
    }, [
      [{ scap: 0 }, 800, 'start'],
      [{ scap: 1 }, 800, 'go'],
      [{ scap: 1 }, 'hold', 'hold'],
      [{ scap: 0 }, 700, 'back'],
    ], { upper: true, cam: { az: -98, el: 8 } }),
  };

  const VIEW_LABEL = { side: t('fig.view.side'), front: t('fig.view.front'), back: t('fig.view.back'), lying: t('fig.view.lying'),
    supine: t('fig.view.supine'), quad: t('fig.view.quad') };
  const viewLabel = (guide) => VIEW_LABEL[guide.view];

  // Textos de cada fase en el idioma actual: los de data.guides (si hay) sobre los de GUIDES; lo que falte, en español.
  const CUES_TR = (I18N && typeof I18N.data === 'function' && I18N.data('guides')) || null;
  const ID_OF = new Map(Object.entries(GUIDES).map(([id, g]) => [g, id]));
  const cuesOf = (guide) => {
    const tr = CUES_TR && CUES_TR[ID_OF.get(guide)];
    return tr ? Object.assign({}, guide.cues, tr) : guide.cues;
  };

  // ------------------------------------------------------------------ esqueleto 3D
  // Posturas base: [hacia la cabeza, hacia el frente del cuerpo]. El lado derecho sale de su producto.
  const BODY = {
    stand: [V(0, 1, 0), V(1, 0, 0)],
    supine: [V(-1, 0, 0), V(0, 1, 0)],
    side: [V(1, 0, 0), V(0, 0, 1)],            // sobre el lado izquierdo, el frente hacia la cámara
    quad: [V(1, 0, 0), V(0, -1, 0)],
  };

  /** Puntos (en metros) y marcos de cada segmento: d = hacia el extremo, f = frente, l = afuera. */
  function skeleton(pose, guide) {
    const [U0, F0] = BODY[val(pose, 'body')] || BODY.stand;
    const R = cross3(F0, U0);
    // Flexión positiva = hacia el frente: alrededor del eje derecho, la cabeza va hacia F (por eso el signo menos).
    const U = rot3(U0, R, -val(pose, 'pitch'));
    const F = rot3(F0, R, -val(pose, 'pitch'));
    const [tf, ts, tw] = val(pose, 'trunk');
    let Ut = rot3(U, R, -tf), Ft = rot3(F, R, -tf), Rt = R;
    if (ts) { Ut = rot3(Ut, Ft, ts); Rt = rot3(Rt, Ft, ts); }
    if (tw) { Ft = rot3(Ft, Ut, tw); Rt = rot3(Rt, Ut, tw); }
    const scap = val(pose, 'scap');
    const p = { hip: V(0, 0, 0) };
    p.hipN = mul3(R, L.hipHalf);
    p.hipF = mul3(R, -L.hipHalf);
    p.sh = add3(mul3(Ut, L.torso), mul3(Ft, -0.03 * scap));
    const half = L.shoulderHalf * (1 - 0.12 * scap);
    p.shN = add3(p.sh, mul3(Rt, half));
    p.shF = add3(p.sh, mul3(Rt, -half));
    const [nf, ns, nr] = val(pose, 'neck');
    let Un = rot3(Ut, Rt, -nf), Fn = rot3(Ft, Rt, -nf);
    if (ns) Un = rot3(Un, Fn, ns);
    if (nr) Fn = rot3(Fn, Un, nr);
    p.head = add3(add3(p.sh, mul3(Un, L.neck)), mul3(Ft, -val(pose, 'retract')));
    const frames = { torso: { d: Ut, f: Ft, l: Rt }, neck: { d: Un, f: Fn, l: Rt }, head: { d: Un, f: Fn, l: Rt } };
    ['N', 'F'].forEach((s) => {
      const ls = s === 'N' ? 1 : -1;
      const [flex, abd, elbow, er, horiz] = val(pose, `a${s}`);
      let fr = { d: mul3(Ut, -1), f: Ft, l: mul3(Rt, ls) };
      fr = rotF(fr, mul3(Ft, -ls), abd);
      fr = rotF(fr, Rt, flex);
      if (horiz) fr = rotF(fr, Ut, ls * horiz);
      if (er) fr = rotF(fr, fr.d, ls * er);
      p[`el${s}`] = add3(p[`sh${s}`], mul3(fr.d, L.upper));
      const e = rad(elbow);
      const fd = add3(mul3(fr.d, Math.cos(e)), mul3(fr.f, Math.sin(e)));
      const ff = sub3(mul3(fr.f, Math.cos(e)), mul3(fr.d, Math.sin(e)));
      p[`wr${s}`] = add3(p[`el${s}`], mul3(fd, L.fore));
      frames[`upper${s}`] = fr;
      frames[`fore${s}`] = { d: fd, f: ff, l: fr.l };
      if (guide.upper) return;
      const [hf, ha, kn, an, her] = val(pose, `l${s}`);
      let lf = { d: mul3(U, -1), f: F, l: mul3(R, ls) };
      lf = rotF(lf, mul3(F, -ls), ha);
      lf = rotF(lf, R, hf);
      if (her) lf = rotF(lf, lf.d, ls * her);
      p[`kn${s}`] = add3(p[`hip${s}`], mul3(lf.d, L.thigh));
      const k = rad(kn);
      const sd = sub3(mul3(lf.d, Math.cos(k)), mul3(lf.f, Math.sin(k)));
      const sf = add3(mul3(lf.f, Math.cos(k)), mul3(lf.d, Math.sin(k)));
      p[`an${s}`] = add3(p[`kn${s}`], mul3(sd, L.shin));
      const a = rad(an);
      const footD = add3(mul3(sf, Math.cos(a)), mul3(sd, Math.sin(a)));
      const footUp = add3(mul3(sd, -Math.cos(a)), mul3(sf, Math.sin(a)));
      p[`to${s}`] = add3(p[`an${s}`], mul3(footD, L.foot));
      frames[`thigh${s}`] = lf;
      frames[`shin${s}`] = { d: sd, f: sf, l: lf.l };
      frames[`foot${s}`] = { d: footD, f: footUp, l: lf.l };
    });
    return { p, frames };
  }

  /** Marcos de un brazo después de un agarre (sale de los puntos; el frente sigue hacia donde se dobla el codo). */
  function refitArm(w, frames, s) {
    const ls = s === 'N' ? 1 : -1;
    const d = norm3(sub3(w[`el${s}`], w[`sh${s}`]));
    const fd = norm3(sub3(w[`wr${s}`], w[`el${s}`]));
    let f = perpTo(fd, d);
    if (len3(f) < 0.15) f = perpTo(frames[`upper${s}`].f, d);
    f = norm3(f);
    frames[`upper${s}`] = { d, f, l: mul3(cross3(d, f), ls) };
    let ff = perpTo(mul3(d, -1), fd);
    if (len3(ff) < 0.15) ff = perpTo(f, fd);
    frames[`fore${s}`] = { d: fd, f: norm3(ff), l: frames[`upper${s}`].l };
  }

  /** Brazo de dos segmentos que llega a T; el codo hacia `pole` (por defecto, hacia abajo). */
  function reach3(S, T, pole) {
    const a = L.upper, b = L.fore;
    const dv = sub3(T, S);
    const dl = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, len3(dv)));
    const dh = norm3(dv);
    let ph = perpTo(pole || V(0, -1, 0), dh);
    if (len3(ph) < 1e-4) ph = perpTo(V(-1, 0, 0), dh);
    ph = norm3(ph);
    const cosA = (a * a + dl * dl - b * b) / (2 * a * dl);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const elbow = add3(S, add3(mul3(dh, a * cosA), mul3(ph, a * sinA)));
    const wrist = add3(elbow, mul3(norm3(sub3(T, elbow)), b));
    return { elbow, wrist };
  }

  // Grosor de cada segmento (radio, m): para apoyar en el suelo la espalda, el glúteo o la planta, no la articulación.
  const RAD = { torso: 0.12, neck: 0.045, upper: 0.05, fore: 0.04, thigh: 0.08, shin: 0.055, foot: 0.05, hand: 0.03 };
  function lowest3(w, guide) {
    let m = w.head.y - L.head;
    const seg = (a, b, r) => { if (w[a] && w[b]) m = Math.min(m, w[a].y - r, w[b].y - r); };
    seg('hip', 'sh', RAD.torso); seg('sh', 'head', RAD.neck);
    ['N', 'F'].forEach((s) => {
      seg(`sh${s}`, `el${s}`, RAD.upper); seg(`el${s}`, `wr${s}`, RAD.fore);
      if (!guide.upper) { seg(`hip${s}`, `kn${s}`, RAD.thigh); seg(`kn${s}`, `an${s}`, RAD.shin); seg(`an${s}`, `to${s}`, RAD.foot); }
    });
    return m;
  }
  const shift3 = (w, d) => { const out = {}; Object.keys(w).forEach((k) => { out[k] = add3(w[k], d); }); return out; };

  function ikTarget3(name, w, ctx, s) {
    if (name === 'prop') return ctx && ctx.hands3 ? ctx.hands3[s] : null;
    if (name === 'kneeN') return w.knN;
    if (name === 'thighN') return lerp3(w.hipN, w.knN, 0.62);
    if (name === 'upperN') return lerp3(w.shN, w.elN, 0.7);
    return null;
  }

  /** Pose → puntos del mundo apoyados en el suelo, con el ancla fija y los agarres resueltos. */
  function solveWorld(pose, guide, ctx) {
    if (pose._mix) {
      // Transición entre un cuadro con agarre y otro sin él: se interpolan codo y muñeca entre ambos extremos.
      const { a, b, k } = pose._mix;
      const base = solveWorld(Object.assign({}, pose, { _mix: null }), guide, ctx);
      const A = solveWorld(a, guide, ctx);
      const B = solveWorld(b, guide, ctx);
      ['N', 'F'].forEach((s) => {
        if ((a[`ik${s}`] || null) === (b[`ik${s}`] || null)) return;
        base.w[`el${s}`] = lerp3(A.w[`el${s}`], B.w[`el${s}`], k);
        base.w[`wr${s}`] = lerp3(A.w[`wr${s}`], B.w[`wr${s}`], k);
        refitArm(base.w, base.frames, s);
      });
      return base;
    }
    const sk = skeleton(pose, guide);
    let w = shift3(sk.p, V(0, guide.upper ? -sk.p.hip.y : -lowest3(sk.p, guide), 0));
    if (ctx && ctx.anchor) {
      const a = w[guide.anchor];
      w = shift3(w, V(ctx.anchor.x - a.x, 0, ctx.anchor.z - a.z));
    }
    ['N', 'F'].forEach((s) => {
      const ik = pose[`ik${s}`];
      if (!ik) return;
      const T = ikTarget3(ik, w, ctx, s);
      if (!T) return;
      const r = reach3(w[`sh${s}`], T);
      w[`el${s}`] = r.elbow;
      w[`wr${s}`] = r.wrist;
      refitArm(w, sk.frames, s);
    });
    return { w, frames: sk.frames };
  }

  // ------------------------------------------------------------------ cámara
  /** Cámara en tres cuartos: az = 0 mira el lado derecho, 90 el frente, -90 la espalda; el = altura en grados. */
  function camera(guide) {
    const cam = guide.cam || CAM[guide.view] || CAM.side;
    const az = rad(cam.az), el = rad(cam.el);
    const c = V(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const Cr = norm3(cross3(V(0, 1, 0), c));
    const Cu = cross3(c, Cr);
    return { c, Cr, Cu };
  }
  /** A la pantalla: x a la derecha, y hacia abajo (m), d = profundidad (más grande = más lejos). */
  const proj = (cam, P3) => ({ x: dot3(P3, cam.Cr), y: -dot3(P3, cam.Cu), d: -dot3(P3, cam.c) });
  const projV = (cam, v) => ({ x: dot3(v, cam.Cr), y: -dot3(v, cam.Cu) });

  /** Pose → puntos en pantalla (x, y en metros, y hacia abajo; d profundidad). Guarda el mundo y los marcos aparte. */
  function solvePose(pose, guide, ctx) {
    const cam = (ctx && ctx.cam) || camera(guide);
    const { w, frames } = solveWorld(pose, guide, ctx);
    const p = {};
    Object.keys(w).forEach((k) => { p[k] = proj(cam, w[k]); });
    Object.defineProperty(p, '_w', { value: w });
    Object.defineProperty(p, '_frames', { value: frames });
    Object.defineProperty(p, '_cam', { value: cam });
    return p;
  }

  /** Lo más bajo del cuerpo en el mundo (0 = apoyado en el suelo). */
  function lowestY(p, guide) { return guide.upper ? p._w.hip.y : lowest3(p._w, guide); }

  /** Contexto fijo de una guía: cámara, ancla, manos del primer cuadro (silla o mesa), muebles y la caja del recorrido. */
  function prepare(guide) {
    const cam = camera(guide);
    const pose0 = guide.seq[0][0];
    const sk = skeleton(pose0, guide);
    const w0 = shift3(sk.p, V(0, guide.upper ? -sk.p.hip.y : -lowest3(sk.p, guide), 0));
    const ctx = { cam, anchor: { x: w0[guide.anchor].x, z: w0[guide.anchor].z }, hands3: { N: w0.wrN, F: w0.wrF }, w0 };
    ctx.hands = { N: proj(cam, w0.wrN), F: proj(cam, w0.wrF) };
    const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    const box3 = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    const grow = (pt) => {
      box.minX = Math.min(box.minX, pt.x); box.maxX = Math.max(box.maxX, pt.x);
      box.minY = Math.min(box.minY, pt.y); box.maxY = Math.max(box.maxY, pt.y);
    };
    guide.seq.forEach((step) => {
      const p = solvePose(step[0], guide, ctx);
      outlines(p, guide, step[0]).forEach((o) => o.pts.forEach(grow));
      Object.values(p._w).forEach((q) => {
        box3.minX = Math.min(box3.minX, q.x); box3.maxX = Math.max(box3.maxX, q.x);
        box3.minZ = Math.min(box3.minZ, q.z); box3.maxZ = Math.max(box3.maxZ, q.z);
      });
    });
    ctx.box3 = box3;
    ctx.props = propShapes(guide, ctx);
    ctx.props.forEach((shape) => { if (shape.kind !== 'floor') shape.pts.forEach(grow); });
    ctx.box = box;
    return ctx;
  }

  /** Suelo, muebles y accesorios en 3D, ya proyectados: líneas, caras y la colchoneta. */
  function propShapes(guide, ctx) {
    const cam = ctx.cam;
    const out = [];
    const P2 = (x, y, z) => proj(cam, V(x, y, z));
    const line = (a, b) => out.push({ kind: 'line', pts: [P2(...a), P2(...b)] });
    const face = (pts, kind) => out.push({ kind: kind || 'face', pts: pts.map((q) => P2(...q)) });
    const b3 = ctx.box3;
    if (!guide.upper) {
      face([[b3.minX - 0.6, 0, b3.minZ - 0.6], [b3.maxX + 0.6, 0, b3.minZ - 0.6], [b3.maxX + 0.6, 0, b3.maxZ + 0.6],
        [b3.minX - 0.6, 0, b3.maxZ + 0.6]], 'floor');
    } else {
      const h = ctx.w0.hip;
      face([[h.x - 0.22, -0.02, h.z - 0.24], [h.x + 0.22, -0.02, h.z - 0.24], [h.x + 0.22, -0.02, h.z + 0.24],
        [h.x - 0.22, -0.02, h.z + 0.24]], 'face');
    }
    const chair = (x0, x1, seatY, z0, z1, backX, backTop) => {
      face([[x0, seatY, z0], [x1, seatY, z0], [x1, seatY, z1], [x0, seatY, z1]]);
      [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].forEach(([x, z]) => line([x, seatY, z], [x, 0, z]));
      line([backX, seatY, z0], [backX, backTop, z0]);
      line([backX, seatY, z1], [backX, backTop, z1]);
      line([backX, backTop, z0], [backX, backTop, z1]);
      line([backX, (seatY + backTop) / 2, z0], [backX, (seatY + backTop) / 2, z1]);
    };
    (guide.props || []).forEach((name) => {
      if (name === 'chair') {                                // silla bajo el asiento del primer cuadro
        const h = ctx.w0.hip;
        const seatY = h.y - 0.09;
        chair(h.x - 0.24, h.x + 0.2, seatY, -0.24, 0.24, h.x - 0.24, seatY + 0.48);
      } else if (name === 'chairBack') {                     // silla delante, con el respaldo bajo las manos
        const hs = [ctx.hands3.N, ctx.hands3.F].filter(Boolean);
        const top = Math.max(...hs.map((q) => q.y)) - 0.02;
        const x = Math.max(...hs.map((q) => q.x)) + 0.05;
        chair(x, x + 0.44, 0.46, -0.24, 0.24, x, top);
      } else if (name === 'table') {                         // mesa bajo la mano apoyada
        const hnd = ctx.hands3.F;
        const top = hnd.y - 0.03;
        const x0 = hnd.x - 0.15, x1 = hnd.x + 0.55, z0 = hnd.z - 0.35, z1 = hnd.z + 0.35;
        face([[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]]);
        [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].forEach(([x, z]) => line([x, top, z], [x, 0, z]));
      } else if (name === 'mat') {
        face([[b3.minX - 0.18, 0.002, b3.minZ - 0.16], [b3.maxX + 0.18, 0.002, b3.minZ - 0.16],
          [b3.maxX + 0.18, 0.002, b3.maxZ + 0.16], [b3.minX - 0.18, 0.002, b3.maxZ + 0.16]], 'mat');
      }
    });
    if (guide.band) {
      const ref = ctx.w0[guide.band.ref];
      ctx.band3 = V(ref.x + guide.band.dx, ref.y + guide.band.dy, ref.z + guide.band.dz);
      ctx.band = proj(cam, ctx.band3);
      out.push({ kind: 'anchor', pts: [ctx.band] });
    }
    return out;
  }

  // ------------------------------------------------------------------ anatomía (marioneta muscular)
  // Cada segmento se dibuja con polígonos de músculos en el estilo del mapa muscular (body-map.js): `m` son los nombres
  // del mapa (o 'neutral' para cabeza, manos, pies y rodillas). Coordenadas locales: u = fracción del hueso (0 =
  // articulación de arriba; la cabeza usa metros), v = metros hacia el frente del segmento (perfil, 'side') o hacia
  // afuera (vista de frente o de espalda). `sym` dibuja también el lado espejado. Cada segmento tiene tres juegos:
  // perfil, frente y espalda; se usa el que corresponde a cómo lo ve la cámara.
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
  const ADDUCTOR = M('adductor', [[0.06, -0.055], [0.35, -0.05], [0.58, -0.046], [0.52, -0.075], [0.25, -0.088], [0.06, -0.085]]);
  const ABDUCTORS = M('abductors', [[-0.14, 0.058], [0.05, 0.062], [0.3, 0.072], [0.38, 0.1], [0.2, 0.128], [-0.1, 0.135]]);
  const FOOT_FRONT = [M('neutral', [[-0.1, -0.04], [0.95, -0.035], [1.05, 0], [0.95, 0.035], [-0.1, 0.04]])];

  const SHAPES = {
    torso: {
      side: [
        M('gluteal', [[-0.13, -0.03], [-0.07, -0.115], [0.06, -0.135], [0.2, -0.12], [0.27, -0.07], [0.22, -0.03]]),
        M('abductors', [[0, -0.01], [0.05, 0.055], [0.2, 0.065], [0.26, 0.02], [0.24, -0.02]]),
        M('lower-back', [[0.3, -0.04], [0.29, -0.11], [0.45, -0.115], [0.6, -0.1], [0.6, -0.045]]),
        M('obliques', [[0.29, -0.025], [0.62, -0.035], [0.62, 0.065], [0.45, 0.075], [0.29, 0.065]]),
        M('abs', [[0.1, 0.075], [0.3, 0.085], [0.64, 0.085], [0.64, 0.125], [0.4, 0.13], [0.12, 0.11]]),
        M('upper-back', [[0.63, -0.03], [0.62, -0.1], [0.78, -0.125], [0.92, -0.11], [0.9, -0.03]]),
        M('chest', [[0.66, 0], [0.66, 0.1], [0.78, 0.135], [0.94, 0.12], [0.95, 0.02]]),
        M('trapezius', [[0.88, -0.085], [0.95, -0.11], [1.06, -0.06], [1.1, -0.02], [0.93, -0.015]]),
      ],
      front: [
        M('chest', [[0.66, 0.012], [0.95, 0.02], [0.96, 0.15], [0.86, 0.17], [0.7, 0.14], [0.65, 0.08]], { sym: true }),
        M('abs', [[0.47, 0.008], [0.63, 0.008], [0.63, 0.058], [0.47, 0.058]], { sym: true }),
        M('abs', [[0.3, 0.008], [0.45, 0.008], [0.45, 0.058], [0.3, 0.056]], { sym: true }),
        M('abs', [[0.12, 0.008], [0.28, 0.008], [0.28, 0.054], [0.14, 0.05]], { sym: true }),
        M('obliques', [[0.12, 0.062], [0.6, 0.068], [0.64, 0.13], [0.42, 0.135], [0.18, 0.11]], { sym: true }),
        M('trapezius', [[0.96, 0.03], [1.1, 0.05], [1.03, 0.16], [0.97, 0.155]], { sym: true }),
        M('neutral', [[-0.1, 0.005], [0.1, 0.005], [0.1, 0.1], [-0.02, 0.118], [-0.1, 0.085]], { sym: true }),
      ],
      back: [
        M('trapezius', [[0.6, 0.006], [0.84, 0.05], [1, 0.16], [1.08, 0.04], [1.08, 0.006]], { sym: true, scap: true }),
        M('upper-back', [[0.42, 0.012], [0.62, 0.02], [0.86, 0.075], [0.94, 0.17], [0.72, 0.175], [0.5, 0.11]], { sym: true, scap: true }),
        M('lower-back', [[0.1, 0.008], [0.42, 0.008], [0.42, 0.075], [0.14, 0.065]], { sym: true }),
        M('gluteal', [[-0.16, 0.012], [0.08, 0.012], [0.09, 0.12], [-0.06, 0.14], [-0.17, 0.1]], { sym: true }),
      ],
    },
    neck: { side: [M('neck', [[0.02, -0.04], [0.02, 0.035], [0.5, 0.035], [0.55, -0.035]])], front: NECK_FRONT, back: NECK_FRONT },
    head: { side: [M('neutral', HEAD_SIDE, { head: true })], front: [M('neutral', HEAD_FRONT, { head: true })],
      back: [M('neutral', HEAD_FRONT, { head: true })] },
    upper: {
      side: [
        M('front-deltoids', [[-0.1, 0], [-0.06, 0.06], [0.08, 0.07], [0.3, 0.04], [0.33, 0]]),
        M('back-deltoids', [[-0.1, -0.005], [-0.06, -0.062], [0.08, -0.07], [0.3, -0.04], [0.33, -0.005]]),
        M('biceps', [[0.36, 0], [0.42, 0.048], [0.7, 0.05], [0.9, 0.028], [0.95, 0]]),
        M('triceps', [[0.36, -0.005], [0.42, -0.055], [0.7, -0.05], [0.9, -0.03], [0.95, -0.005]]),
      ],
      front: ARM_FRONT('biceps'),
      back: ARM_FRONT('triceps'),
    },
    fore: { side: FOREARM, front: FOREARM, back: FOREARM },
    thigh: {
      side: [
        M('quadriceps', [[0.08, 0], [0.1, 0.07], [0.35, 0.088], [0.65, 0.078], [0.88, 0.055], [0.95, 0.025], [0.95, 0]]),
        M('hamstring', [[0.15, -0.005], [0.2, -0.072], [0.45, -0.08], [0.75, -0.062], [0.92, -0.035], [0.95, -0.005]]),
        M('neutral', [[0.95, 0.03], [1.02, 0.055], [1.08, 0.035], [1.04, 0.006]]),
      ],
      front: [
        M('quadriceps', [[0.08, -0.045], [0.08, 0.06], [0.4, 0.075], [0.85, 0.05], [0.95, 0.03], [0.95, -0.03], [0.6, -0.04], [0.3, -0.045]]),
        ADDUCTOR, ABDUCTORS,
      ],
      back: [
        M('hamstring', [[0.15, -0.045], [0.15, 0.055], [0.5, 0.065], [0.92, 0.04], [0.92, -0.04], [0.5, -0.05]]),
        ADDUCTOR, ABDUCTORS,
      ],
    },
    shin: {
      side: [
        M('tibialis', [[0.07, 0.003], [0.08, 0.045], [0.45, 0.038], [0.85, 0.02], [0.93, 0.003]]),
        M('calves', [[0.06, -0.003], [0.1, -0.062], [0.3, -0.078], [0.5, -0.052], [0.6, -0.022], [0.6, -0.003]]),
        M('soleus', [[0.62, -0.003], [0.62, -0.024], [0.68, -0.04], [0.8, -0.032], [0.94, -0.012], [0.94, -0.003]]),
      ],
      front: [
        M('tibialis', [[0.07, -0.028], [0.07, 0.034], [0.5, 0.03], [0.92, 0.018], [0.92, -0.018], [0.5, -0.026]]),
        M('calves', [[0.1, 0.036], [0.28, 0.058], [0.52, 0.042], [0.56, 0.032]]),
        M('calves', [[0.1, -0.032], [0.28, -0.055], [0.52, -0.04], [0.56, -0.03]]),
      ],
      back: [
        M('calves', [[0.06, 0.003], [0.08, 0.055], [0.3, 0.062], [0.55, 0.022], [0.55, 0.003]], { sym: true }),
        M('soleus', [[0.57, -0.03], [0.57, 0.03], [0.8, 0.025], [0.93, 0.01], [0.93, -0.01], [0.8, -0.025]]),
      ],
    },
    foot: {
      side: [M('neutral', [[-0.32, -0.05], [-0.36, -0.01], [-0.22, 0.03], [0.3, 0.03], [0.8, 0.012], [1.02, -0.012], [1, -0.05], [0.2, -0.055]])],
      front: FOOT_FRONT, back: FOOT_FRONT,
    },
  };

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

  /** Qué juego de formas ve la cámara en un segmento: perfil, frente o espalda; y hacia dónde apunta `v` en pantalla. */
  function facing(frame, cam) {
    const a = dot3(frame.f, cam.c);
    const b = dot3(frame.l, cam.c);
    if (Math.abs(b) >= Math.abs(a)) return { set: 'side', v3: frame.f };
    return { set: a > 0 ? 'front' : 'back', v3: frame.l };
  }

  /**
   * Contorno de la figura: polígonos de músculos en pantalla, ordenados por profundidad (lo de atrás primero). Cada
   * segmento lleva su silueta base y sus músculos; `farK` lo oscurece según lo lejos que está detrás del tronco.
   * Devuelve [{ part, side, seg, m, neutral, base, farK, far, depth, pts }].
   */
  function outlines(p, guide, pose) {
    const cam = p._cam, w = p._w, fr = p._frames;
    const scap = (pose && pose.scap) || 0;
    const groups = [];
    const torsoDepth = (p.hip.d + p.sh.d) / 2;
    function add(part, side, A3, B3, frame) {
      if (!A3 || !frame) return;
      const isHead = part === 'head';
      const A = proj(cam, A3);
      const B = isHead ? A : proj(cam, B3);
      let dir = isHead ? projV(cam, frame.d) : { x: B.x - A.x, y: B.y - A.y };
      const len = isHead ? 1 : Math.hypot(dir.x, dir.y);
      let dl = Math.hypot(dir.x, dir.y);
      if (dl < 1e-6) { dir = projV(cam, frame.d); dl = Math.hypot(dir.x, dir.y) || 1; }
      const u2 = { x: dir.x / dl, y: dir.y / dl };
      const face = facing(frame, cam);
      let v2 = projV(cam, face.v3);
      const along = v2.x * u2.x + v2.y * u2.y;
      v2 = { x: v2.x - u2.x * along, y: v2.y - u2.y * along };
      let vl = Math.hypot(v2.x, v2.y);
      if (vl < 1e-4) { v2 = { x: -u2.y, y: u2.x }; vl = 1; }
      v2 = { x: v2.x / vl, y: v2.y / vl };
      const shapes = (SHAPES[part] && (SHAPES[part][face.set] || SHAPES[part].side)) || [];
      const seg = isHead ? 'neck' : (part === 'torso' || part === 'neck' ? part : part + side);
      const mine = [];
      shapes.forEach((sh) => {
        (sh.sym ? [1, -1] : [1]).forEach((sgn) => {
          const pts = sh.pts.map(([u, v0]) => {
            let v = v0 * sgn;
            if (sh.scap && scap) v = Math.sign(v) * Math.max(0.004, Math.abs(v) - 0.03 * scap);
            const t = isHead ? u : u * len;
            return { x: A.x + u2.x * t + v2.x * v, y: A.y + u2.y * t + v2.y * v };
          });
          mine.push({ part, side, seg, m: sh.m, neutral: sh.m[0] === 'neutral', base: false, pts });
        });
      });
      const depth = isHead ? A.d : (A.d + B.d) / 2;
      const items = isHead ? mine : [{ part, side, seg, m: ['neutral'], neutral: true, base: true,
        pts: hull([].concat(...mine.map((x) => x.pts))) }].concat(mine);
      groups.push({ depth, items, face: face.set, part });
    }
    add('torso', null, w.hip, w.sh, fr.torso);
    add('neck', null, w.sh, w.head, fr.neck);
    add('head', null, w.head, null, fr.head);
    ['N', 'F'].forEach((s) => {
      add('upper', s, w[`sh${s}`], w[`el${s}`], fr[`upper${s}`]);
      add('fore', s, w[`el${s}`], w[`wr${s}`], fr[`fore${s}`]);
      if (!guide.upper) {
        add('thigh', s, w[`hip${s}`], w[`kn${s}`], fr[`thigh${s}`]);
        add('shin', s, w[`kn${s}`], w[`an${s}`], fr[`shin${s}`]);
        add('foot', s, w[`an${s}`], w[`to${s}`], fr[`foot${s}`]);
      }
    });
    // El cuello y la cabeza van delante del tronco cuando están a su misma distancia (no se esconden tras el pecho).
    groups.forEach((g) => { if (g.part === 'neck' || g.part === 'head') g.depth = Math.min(g.depth, torsoDepth - 0.001); });
    groups.sort((a, b) => b.depth - a.depth);
    const out = [];
    groups.forEach((g) => {
      const farK = Math.max(0.5, Math.min(1, 1 - (g.depth - torsoDepth - 0.04) * 2.6));
      g.items.forEach((it) => out.push(Object.assign(it, { farK, far: farK < 0.95, depth: g.depth })));
    });
    return out;
  }

  /** Dónde y cómo se ve la cara: uno o dos ojos según si se ve de perfil o de frente; nada si se ve la nuca. */
  function eyes(p) {
    const cam = p._cam, fr = p._frames.head, h = p._w.head;
    const face = facing(fr, cam);
    const at = (u, f, r) => proj(cam, add3(add3(add3(h, mul3(fr.d, u)), mul3(fr.f, f)), mul3(fr.l, r)));
    if (face.set === 'side') return [at(0.02, 0.07, dot3(fr.l, cam.c) > 0 ? 0.03 : -0.03)];
    if (face.set === 'front') return [at(0.015, 0.09, 0.04), at(0.015, 0.09, -0.04)];
    return [];
  }

  // ------------------------------------------------------------------ tiempo
  const ease = (k) => k * k * (3 - 2 * k);
  function lerpPose(a, b, k) {
    const out = {};
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((key) => {
      if (key === '_mix') return;
      if (key.startsWith('ik')) { if (a[key] === b[key]) out[key] = a[key]; return; }
      const va = a[key] == null ? DEF[key] : a[key];
      const vb = b[key] == null ? DEF[key] : b[key];
      if (Array.isArray(va) && Array.isArray(vb)) out[key] = va.map((v, i) => v + (vb[i] - v) * k);
      else if (typeof va === 'number' && typeof vb === 'number') out[key] = va + (vb - va) * k;
      else out[key] = k < 0.5 ? va : vb;
    });
    if ((a.ikN || null) !== (b.ikN || null) || (a.ikF || null) !== (b.ikF || null)) out._mix = { a, b, k };
    return out;
  }

  /** Línea de tiempo de una guía con el sostén de la dosis (la animación lo acorta a 3 s como mucho). */
  function timeline(guide, hold) {
    const holdMs = hold > 0 ? Math.min(hold, 3) * 1000 : 500;
    const steps = guide.seq.map(([pose, ms, cap]) => ({ pose, ms: ms === 'hold' ? holdMs : ms, cap }));
    return { steps, total: steps.reduce((s, x) => s + x.ms, 0) };
  }

  function captionFor(guide, cap, hold) {
    const cues = cuesOf(guide);
    if (cap === 'hold') return hold > 0 ? t('fig.hold', { s: hold }) : (cues.top || cues.go);
    return cues[cap] || '';
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

  // ------------------------------------------------------------------ qué se mueve y qué trabaja
  // Segmentos que se mueven (para la flecha, el halo de la posición objetivo y en qué miembros se encienden los
  // músculos). Grupos: aN/aF = brazo, lN/lF = pierna, feet = los dos pies; abs y scap, lo que la cámara no ve moverse.
  const FOCUS = {
    'sit-to-stand': ['torso', 'lN', 'lF'], 'tandem-stance': ['lN', 'lF'], 'one-leg-stand': ['lN'], 'calf-raises': ['feet'],
    'half-squat': ['torso', 'lN', 'lF'], 'leg-extension': ['shinN', 'footN'], 'straight-leg-raise': ['lN'],
    'hamstring-curl': ['shinN', 'footN'], 'supine-hamstring-stretch': ['shinN', 'footN'], 'hip-abduction': ['lN'],
    'clamshell': ['lN'], 'knee-to-chest': ['lN', 'aN', 'aF'], 'hip-bridge': ['torso', 'lN', 'lF'], 'bird-dog': ['aF', 'lN'],
    'abdominal-bracing': ['abs'], 'chin-retraction': ['neck'], 'neck-side-flexion': ['neck'],
    'seated-trunk-rotation': ['torso', 'aN', 'aF'], 'pendulum': ['aN'], 'crossover-arm-stretch': ['aN'],
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

  /** Segmentos (y marcas abs/scap) que se mueven en una guía. */
  function focusOf(guide) {
    const out = new Set();
    (guide.focus || []).forEach((k) => (GROUPS[k] || [k]).forEach((sname) => out.add(sname)));
    return out;
  }

  /** En qué brazos y piernas se encienden los músculos: los que se mueven, todos si no se mueve ninguno de ese tipo, o
   *  los que declare `muscleLimbs` (apoyo en un pie: también trabaja la pierna de apoyo). */
  function limbsFor(guide) {
    if (guide.muscleLimbs) {
      const out = { aN: false, aF: false, lN: false, lF: false };
      guide.muscleLimbs.forEach((k) => { out[k] = true; });
      if (!out.aN && !out.aF) { out.aN = true; out.aF = true; }
      return out;
    }
    const f = focusOf(guide);
    const any = (names) => names.some((n) => f.has(n));
    const out = { aN: any(['upperN', 'foreN']), aF: any(['upperF', 'foreF']),
      lN: any(['thighN', 'shinN', 'footN']), lF: any(['thighF', 'shinF', 'footF']) };
    if (!out.aN && !out.aF) { out.aN = true; out.aF = true; }
    if (!out.lN && !out.lF) { out.lN = true; out.lF = true; }
    return out;
  }

  /** Punto que más se desplaza en pantalla entre dos poses, entre los extremos de lo que se mueve: de ahí sale la flecha. */
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

  // Encuadre común: todas las figuras de cuerpo entero a la misma escala (y las de medio cuerpo entre sí), con espacio
  // arriba para las etiquetas del componente.
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
        oy: cy + cellH - labelH - h * FRAME.bottom * (rows ? 0.5 : 1) - box.maxY * s,
      };
    });
    return { rows, s, cells, labelH };
  }

  // ------------------------------------------------------------------ dibujo (solo navegador)
  /** Lee los tokens del design system (docs/design-system/tokens.css: --muscle-* y --fig-*). */
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
    const propW = Math.max(1.5 * dpr, 0.016 * s);
    const poly = (pts) => {
      g.beginPath();
      pts.forEach((pt, i) => { const [x, y] = X(pt); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
    };
    const line = (a, b, width, color, o = {}) => {
      if (!a || !b) return;
      g.save();
      g.globalAlpha = o.alpha == null ? 1 : o.alpha;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineCap = 'round';
      if (o.dash) g.setLineDash(o.dash);
      g.beginPath(); g.moveTo(...X(a)); g.lineTo(...X(b)); g.stroke();
      g.restore();
    };
    const parts = outlines(p, guide, pose);
    g.save();
    if (opts.clip) { g.beginPath(); g.rect(cell.x, cell.y - 4 * dpr, cell.w, cell.h + 4 * dpr); g.clip(); }

    // suelo en perspectiva, sombra y muebles
    ctx.props.forEach((shape) => {
      if (shape.kind === 'floor') {
        poly(shape.pts);
        g.save();
        g.globalAlpha = 0.07; g.fillStyle = T.floor; g.fill();
        g.globalAlpha = 0.45; g.strokeStyle = T.floor; g.lineWidth = thin; g.stroke();
        g.restore();
      }
    });
    if (!guide.upper) {
      const low = Object.values(p._w).filter((q) => q.y < 0.18);
      if (low.length) {
        const xs = low.map((q) => q.x), zs = low.map((q) => q.z);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
        const rx = (Math.max(...xs) - Math.min(...xs)) / 2 + 0.16, rz = (Math.max(...zs) - Math.min(...zs)) / 2 + 0.16;
        const ring = Array.from({ length: 28 }, (_, i) => {
          const t = (i / 28) * Math.PI * 2;
          return proj(p._cam, V(cx + Math.cos(t) * rx, 0, cz + Math.sin(t) * rz));
        });
        poly(ring);
        g.save(); g.fillStyle = 'rgba(0, 0, 0, 0.45)'; g.fill(); g.restore();
      }
    }
    ctx.props.forEach((shape) => {
      if (shape.kind === 'line') line(shape.pts[0], shape.pts[1], propW, T.prop);
      else if (shape.kind === 'face' || shape.kind === 'mat') {
        poly(shape.pts);
        g.save();
        g.globalAlpha = shape.kind === 'mat' ? 0.28 : 0.12; g.fillStyle = T.prop; g.fill();
        g.globalAlpha = 0.7; g.strokeStyle = T.prop; g.lineWidth = shape.kind === 'mat' ? thin : propW; g.stroke();
        g.restore();
      }
    });

    // halo de la posición a la que hay que llegar: siluetas de la parte que se mueve
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

    // cuerpo, de atrás hacia adelante: cada polígono tapa lo que queda detrás con el fondo del marco y lleva el relleno y
    // el borde del mapa muscular; lo más lejano, más tenue; los músculos que trabajan se encienden según `level`.
    const muscles = opts.muscles || new Set();
    const eligible = opts.eligible || {};
    const limbKey = (o) => (o.side == null ? null : (o.part === 'upper' || o.part === 'fore' ? 'a' : 'l') + o.side);
    parts.forEach((o) => {
      const key = limbKey(o);
      const on = !o.neutral && o.m.some((m) => muscles.has(m)) && (key == null || eligible[key] !== false);
      const k = o.farK;
      poly(o.pts);
      g.save();
      g.fillStyle = T.bg;
      g.fill();
      g.lineJoin = 'round';
      if (o.base) {
        g.globalAlpha = 0.75 * T.muscleFill * k;
        g.fillStyle = T.muscle;
        g.fill();
        g.globalAlpha = 0.5 * T.muscleEdge * k;
        g.strokeStyle = T.muscle;
        g.lineWidth = thin;
        g.stroke();
      } else if (on) {
        g.globalAlpha = (T.activeMin + T.activeRange * level) * k;
        g.fillStyle = activeColor;
        if (k > 0.9) { g.shadowColor = activeColor; g.shadowBlur = T.glow * dpr * (0.3 + 0.7 * level); }
        g.fill();
        g.shadowBlur = 0;
        g.globalAlpha = 0.6 * k;
        g.strokeStyle = activeColor;
        g.lineWidth = thin * 1.2;
        g.stroke();
      } else {
        g.globalAlpha = (o.neutral ? T.neutralFill : T.muscleFill) * k;
        g.fillStyle = T.muscle;
        g.fill();
        g.globalAlpha = T.muscleEdge * k;
        g.strokeStyle = T.muscle;
        g.lineWidth = thin * 1.2;
        g.stroke();
      }
      g.restore();
    });

    // ojos: hacia dónde mira la persona
    g.save(); g.fillStyle = T.ink; g.globalAlpha = 0.8;
    eyes(p).forEach((e) => {
      const [x, y] = X(e);
      g.beginPath(); g.arc(x, y, Math.max(1.5 * dpr, 0.012 * s), 0, Math.PI * 2); g.fill();
    });
    g.restore();

    // banda elástica y su anclaje
    if (guide.band && ctx.band) {
      guide.band.hands.forEach((sfx) => line(p[`wr${sfx}`], ctx.band, Math.max(1.5 * dpr, 0.014 * s), T.band,
        { dash: [3 * dpr, 3 * dpr], alpha: 0.9 }));
      const [ax, ay] = X(ctx.band);
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

    g.restore();                                          // fin del recorte de la celda

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
  const PHASE = { start: t('fig.phase.start'), go: t('fig.phase.go'), go2: t('fig.phase.go'), hold: t('fig.phase.hold'),
    top: t('fig.phase.top'), back: t('fig.phase.back') };
  const phaseOf = (cap, hold) => (cap === 'go2' ? 'go' : cap === 'hold' && !(hold > 0) ? 'top' : cap);

  function chipText(phase, hold) {
    const order = ['start', 'go', phase === 'top' ? 'top' : 'hold', 'back'];
    const n = order.indexOf(phase) + 1;
    const label = phase === 'hold' ? `${PHASE.hold} ${hold} s` : PHASE[phase];
    return `${n} · ${label}`;
  }

  // Cuándo se anima, como los videos de una red social (TD-59, pedido del owner):
  // - 'hover' (tarjetas de la galería y del plan): quieta, con inicio y final; se anima solo la que tiene el mouse encima
  //   o la que se toca, y una sola a la vez para no confundir.
  // - 'auto' (dentro del ejercicio: guías, "Cómo se hace", vista guiada, sobre el video): siempre animada, aunque el
  //   sistema pida reducir movimiento, porque muestra cómo se hace; el botón la pausa solo a ella.
  const playMode = (variant, play) => play || (variant === 'card' ? 'hover' : 'auto');
  let playing = null;                                       // la tarjeta que se está animando (una por página)

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
   * play ('hover' | 'auto'; por defecto 'hover' en tarjetas y 'auto' en lo demás, ver playMode) y caption (false = sin
   * texto). Quieta, muestra inicio y final lado a lado. Devuelve { el, stop() }.
   */
  function render(container, exerciseId, opts = {}) {
    const guide = GUIDES[exerciseId];
    if (!guide || !container || typeof document === 'undefined') return { stop() {} };
    const ctx = prepare(guide);
    const hold = opts.hold || 0;
    const variant = opts.variant || 'card';
    const mode = playMode(variant, opts.play);
    const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };
    container.replaceChildren();
    const fig = el('figure', `fig fig--${variant}`);
    fig.dataset.phase = 'start';
    fig.dataset.play = mode;
    const stage = el('div', 'fig-stage');
    const canvas = el('canvas', 'fig-canvas');
    const name = (typeof self !== 'undefined' && self.AxonCatalog && self.AxonCatalog.get(exerciseId)) ? self.AxonCatalog.get(exerciseId).name : exerciseId;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t('fig.aria', { name }));
    const chip = el('span', 'fig-chip');
    const view = el('span', 'fig-view', viewLabel(guide));
    const btn = el('button', 'fig-play');
    btn.type = 'button';
    stage.append(canvas, chip, view);
    fig.append(stage, btn);                                  // fuera del dibujo: no tapa las etiquetas de inicio y final
    const cap = opts.caption === false ? null : el('figcaption', 'fig-cap');
    if (cap) fig.appendChild(cap);
    container.appendChild(fig);

    const g = canvas.getContext('2d');
    const tl = timeline(guide, hold);
    const steps = plan(guide, ctx, tl.steps);
    const muscles = musclesFor(exerciseId);                 // los mismos que pinta el mapa muscular
    const eligible = limbsFor(guide);
    let pinned = mode === 'auto';                             // animada por elección o, dentro del ejercicio, siempre
    let hovering = false;                                     // el mouse está encima (solo tarjetas)
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
        ghost: end, arrow: first.arrow, label: t('fig.label.start'), labelH: lay.labelH, clip: true });
      drawCell(g, guide, ctx, lay.cells[1], lay.s, end, T, { phase: hold > 0 ? 'hold' : 'top', level: 1, muscles, eligible,
        label: t('fig.label.end'), labelH: lay.labelH, clip: true });
      const cues = cuesOf(guide);
      setText('go', t('fig.still.chip'), `${cues.start}. ${cues.go}${hold > 0 ? t('fig.still.hold', { s: hold }) : ''}.`);
    }
    function tick(ts) {
      if (typeof canvas.isConnected === 'boolean' && !canvas.isConnected) { raf = 0; release(); return; }
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
    const on = () => pinned || hovering;
    function play() { if (!raf && on() && visible) { t0 = 0; raf = requestAnimationFrame(tick); } }
    function pause() { cancelAnimationFrame(raf); raf = 0; }
    const me = { quiet() { pinned = false; hovering = false; apply(); } };
    /** Botón y lienzo: animación en bucle, o inicio y final quietos. Entre tarjetas, solo una se anima. */
    function apply() {
      const active = on();
      if (mode === 'hover') {
        if (active && playing !== me) { const prev = playing; playing = me; if (prev) prev.quiet(); }
        if (!active && playing === me) playing = null;
      }
      fig.dataset.motion = active ? 'on' : 'off';
      btn.setAttribute('aria-pressed', String(active));
      btn.textContent = active ? t('fig.btn.pause') : t('fig.btn.play');
      btn.setAttribute('aria-label', active ? t('fig.aria.pause', { name }) : t('fig.aria.play', { name }));
      if (active) play();
      else { pause(); still(); }
    }
    function toggle() {
      if (on()) { pinned = false; hovering = false; } else pinned = true;
      apply();
    }
    function release() {
      if (observer) observer.disconnect();
      if (resizer) resizer.disconnect();
      if (playing === me) playing = null;
    }
    btn.addEventListener('click', toggle);
    if (mode === 'hover') {
      // Mouse encima: se anima mientras está ahí. Tocar o hacer clic en el dibujo: se anima o se pausa (celular).
      fig.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') { hovering = true; apply(); } });
      fig.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && hovering) { hovering = false; apply(); } });
      stage.addEventListener('click', toggle);
    }
    if (typeof ResizeObserver !== 'undefined') {
      resizer = new ResizeObserver(() => { if (!raf) still(); });
      resizer.observe(canvas);
    }
    if (opts.autoplay === 'visible' && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) play(); else pause();
      });
      observer.observe(canvas);
    } else visible = true;
    apply();
    return {
      el: fig,
      stop() { pause(); release(); },
    };
  }

  /** Textos de cada fase para guiar en vivo (seguimiento.js). */
  function cuesFor(exerciseId) {
    const guide = GUIDES[exerciseId];
    return guide ? Object.assign({ view: viewLabel(guide) }, cuesOf(guide)) : null;
  }

  return { GUIDES, VIEW_LABEL, FOCUS, SEGMENTS, FRAME, SHAPES, L, skeleton, camera, solvePose, prepare, frameAt, endPose,
    timeline, focusOf, motion, layout, outlines, lowestY, musclesFor, render, cuesFor, playMode };
});
