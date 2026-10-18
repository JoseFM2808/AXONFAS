/* AXONFAS · mapa corporal 2D: músculos (frente y espalda) y estimación educativa de carga (ADR-013).
 *
 * Usa los polígonos de body-map-data.js (MIT, react-body-highlighter). Los colores salen de los tokens del design
 * system (--tape, --alert, --muted), así que funciona en cualquier página que cargue tokens.css.
 * La carga muscular es una ESTIMACIÓN a partir de los ángulos articulares, para enseñar qué trabaja cada ejercicio:
 * no es una medición (no hay electromiografía) ni un diagnóstico. Navegador y Node (solo las funciones puras).
 */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const data = node ? require('./body-map-data.js') : root.AxonBodyMapData;
  const I18N = (root && root.AxonI18n) || (node ? require('./i18n.js') : null);
  const api = factory(data, I18N);
  if (node) module.exports = api;
  else root.AxonBodyMap = api;
})(typeof self !== 'undefined' ? self : this, function (DATA, I18N) {
  'use strict';

  // Textos visibles en el idioma de la página (ADR-030); los ids de los músculos (claves de DATA) no cambian.
  const t = I18N ? I18N.t : (k) => k;
  const NAMES = {
    quadriceps: t('bodymap.muscle.quadriceps'), hamstring: t('bodymap.muscle.hamstring'), gluteal: t('bodymap.muscle.gluteal'),
    calves: t('bodymap.muscle.calves'), 'left-soleus': t('bodymap.muscle.soleus'), 'right-soleus': t('bodymap.muscle.soleus'),
    abductors: t('bodymap.muscle.abductors'), adductor: t('bodymap.muscle.adductor'), abs: t('bodymap.muscle.abs'),
    obliques: t('bodymap.muscle.obliques'), 'lower-back': t('bodymap.muscle.lower-back'), 'upper-back': t('bodymap.muscle.upper-back'),
    trapezius: t('bodymap.muscle.trapezius'), 'front-deltoids': t('bodymap.muscle.front-deltoids'),
    'back-deltoids': t('bodymap.muscle.back-deltoids'), chest: t('bodymap.muscle.chest'), biceps: t('bodymap.muscle.biceps'),
    triceps: t('bodymap.muscle.triceps'), forearm: t('bodymap.muscle.forearm'), neck: t('bodymap.muscle.neck'),
    head: t('bodymap.muscle.head'), knees: t('bodymap.muscle.knees'),
  };
  const NEUTRAL = new Set(['head', 'knees']);               // se dibujan como referencia, nunca se encienden
  const VIEWS = { anterior: t('bodymap.view.anterior'), posterior: t('bodymap.view.posterior') };

  // Segmentos óseos del esqueleto en vivo (índices de MediaPipe Pose) con el hueso que representan (nombre visible).
  const BONES = [
    { a: 23, b: 25, name: t('bodymap.bone.femur') }, { a: 24, b: 26, name: t('bodymap.bone.femur') },
    { a: 25, b: 27, name: t('bodymap.bone.tibia') }, { a: 26, b: 28, name: t('bodymap.bone.tibia') },
    { a: 23, b: 24, name: t('bodymap.bone.pelvis') }, { a: 11, b: 12, name: t('bodymap.bone.shoulders') },
    { a: 'hipMid', b: 'shoulderMid', name: t('bodymap.bone.spine') }, { a: 'shoulderMid', b: 0, name: t('bodymap.bone.cervical') },
    { a: 11, b: 13, name: t('bodymap.bone.humerus') }, { a: 12, b: 14, name: t('bodymap.bone.humerus') },
    { a: 13, b: 15, name: t('bodymap.bone.forearm') }, { a: 14, b: 16, name: t('bodymap.bone.forearm') },
  ];
  const lower = (s) => s.toLowerCase();

  const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

  /** Carga fija por ejercicio: los músculos que el catálogo marca, todos al mismo nivel (modo enseñanza). */
  function staticLoad(exercise, level = 0.75) {
    const out = {};
    (exercise && exercise.muscles || []).forEach((m) => { out[m] = level; });
    return out;
  }

  /**
   * Estimación educativa en vivo. Para sentarse y pararse, la flexión de rodilla carga cuádriceps y glúteos y la
   * inclinación del tronco carga isquiotibiales y zona lumbar; el valgo pone en foco a los abductores (glúteo medio),
   * que son los que la evitan. En los demás ejercicios, con `progress` (avance del movimiento de 0 a 1 que mide
   * tracker.js, ADR-014) los músculos del catálogo se encienden a medida que la persona llega al recorrido pedido; sin
   * él, devuelve la carga fija del catálogo.
   */
  function estimateLoad(exercise, angles, progress) {
    if (!exercise || exercise.id !== 'sit-to-stand' || !angles) {
      return Number.isFinite(progress) ? staticLoad(exercise, 0.2 + 0.75 * clamp01(progress)) : staticLoad(exercise);
    }
    const k = clamp01(angles.knee / 95);
    const t = clamp01(angles.trunk / 45);
    const v = clamp01(Math.max(angles.valgusL || 0, angles.valgusR || 0) / 15);
    return {
      quadriceps: clamp01(0.25 + 0.75 * k), gluteal: clamp01(0.2 + 0.5 * k + 0.3 * t),
      hamstring: clamp01(0.15 + 0.45 * t), 'lower-back': clamp01(0.15 + 0.6 * t),
      calves: clamp01(0.2 + 0.3 * k), abs: 0.3, abductors: clamp01(0.2 + 0.6 * v),
    };
  }

  /** Músculos que se pintan en rojo ante una compensación (educativo: dónde mirar). */
  function alertMuscles(type) {
    if (type === 'trunk_flexion') return ['lower-back', 'gluteal'];
    if (type === 'knee_valgus') return ['abductors', 'gluteal'];
    return [];
  }

  // ------------------------------------------------------------------ DOM (solo navegador)
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function buildView(view, onClick) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1000 2200');
    svg.setAttribute('class', 'bodymap-svg');
    // Con clic (fisioterapeuta): un grupo de botones, uno por músculo, que se usan también con Tab y Enter.
    // Sin clic: una sola imagen con su nombre.
    svg.setAttribute('role', onClick ? 'group' : 'img');
    svg.setAttribute('aria-label', t(onClick ? 'bodymap.aria.pick' : 'bodymap.aria', { view: lower(VIEWS[view]) }));
    Object.entries(DATA[view]).forEach(([muscle, polys]) => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.dataset.muscle = muscle;
      g.setAttribute('class', `bodymap-muscle${NEUTRAL.has(muscle) ? ' neutral' : ''}`);
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = NAMES[muscle] || muscle;
      g.appendChild(title);
      polys.forEach((points) => {
        const p = document.createElementNS(SVG_NS, 'polygon');
        p.setAttribute('points', points);
        g.appendChild(p);
      });
      if (onClick && !NEUTRAL.has(muscle)) {
        g.style.cursor = 'pointer';
        g.setAttribute('role', 'button');
        g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', t('bodymap.point', { name: NAMES[muscle] || muscle }));
        g.addEventListener('click', () => onClick(muscle));
        g.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick(muscle); }
        });
      } else if (onClick) {
        g.setAttribute('aria-hidden', 'true');
      }
      svg.appendChild(g);
    });
    return svg;
  }

  /** Dibuja frente y espalda en `container`. Devuelve un objeto con update({ intensities, alerts }). */
  function render(container, options = {}) {
    const { views = ['anterior', 'posterior'], onMuscleClick = null, caption = null } = options;
    container.replaceChildren();
    container.classList.add('bodymap');
    const row = document.createElement('div');
    row.className = 'bodymap-row';
    views.forEach((view) => {
      const fig = document.createElement('figure');
      fig.className = 'bodymap-view';
      fig.appendChild(buildView(view, onMuscleClick));
      const cap = document.createElement('figcaption');
      cap.textContent = VIEWS[view];
      fig.appendChild(cap);
      row.appendChild(fig);
    });
    container.appendChild(row);
    if (caption) {
      const note = document.createElement('p');
      note.className = 'bodymap-note';
      note.textContent = caption;
      container.appendChild(note);
    }
    const handle = {
      update({ intensities = {}, alerts = [], focus = null } = {}) {
        const alertSet = new Set(alerts);
        container.querySelectorAll('.bodymap-muscle').forEach((g) => {
          const m = g.dataset.muscle;
          if (NEUTRAL.has(m)) return;
          const level = clamp01(intensities[m] || 0);
          g.classList.toggle('active', level > 0);
          g.classList.toggle('alert', alertSet.has(m));
          g.classList.toggle('focus', focus === m);
          g.style.setProperty('--level', level.toFixed(2));
        });
      },
    };
    handle.update(options);
    return handle;
  }

  /** Nombres legibles y únicos de una lista de músculos (el sóleo izquierdo y el derecho son el mismo nombre). */
  function muscleNames(muscles) {
    return [...new Set((muscles || []).map((m) => NAMES[m] || m))];
  }

  return { NAMES, BONES, staticLoad, estimateLoad, alertMuscles, muscleNames, render };
});
