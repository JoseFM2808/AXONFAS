/* AXONFAS · preparar la cámara antes de cada sesión (ADR-015).
 *
 * Pide una posición para que el movimiento se vea completo: ofrece alternativas (en diagonal, de frente, de lado) con
 * la calidad esperada de cada medida, recomienda la mejor para el ejercicio y, ya con la cámara encendida, revisa en
 * vivo el encuadre (que se vea lo necesario), la distancia y el ángulo real. La sesión empieza cuando todo se mantiene
 * bien un momento. La calidad depende de la posición: un movimiento hacia adelante (plano sagital) se mide bien de lado
 * y mal de frente, porque de frente es profundidad y la cámara la estima peor; uno hacia el costado (plano frontal), al
 * revés. Lo que queda "poco confiable" desde la posición real no dispara alertas (engine.js, config.disabled).
 * Funciones puras en Node y navegador; el dibujo de las tarjetas y del chequeo, solo en el navegador (con DOM, sin
 * innerHTML). Los textos salen del diccionario (i18n/session.js, claves camera.*) en el idioma actual: `label`, `short`
 * y `how` de VIEWS, el `label` de las medidas y el `text` de la calidad se leen en el momento (ADR-030).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonCameraSetup = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const I18N = (typeof self !== 'undefined' && self.AxonI18n) || require('./i18n.js');
  const t = I18N.t;

  /** Vista con sus textos en el idioma actual (getters: valen también si el idioma cambia en los tests). */
  const viewOf = (id, yaw) => ({
    yaw,
    get label() { return t(`camera.view.${id}.label`); },
    get short() { return t(`camera.view.${id}.short`); },
    get how() { return t(`camera.view.${id}.how`); },
  });
  const VIEWS = {
    diagonal: viewOf('diagonal', 45),
    front: viewOf('front', 0),
    side: viewOf('side', 90),
  };
  const ORDER = ['diagonal', 'front', 'side'];
  // Qué tan bien se mide cada plano de movimiento desde cada vista (0 a 1). Valores de partida para validar (TD-57).
  const PLANE = {
    sagittal: { side: 1, diagonal: 0.8, front: 0.5 },     // hacia adelante y atrás: de frente es profundidad (estimada)
    frontal: { front: 1, diagonal: 0.6, side: 0.15 },     // hacia los costados: valgo, abducción, inclinación lateral
    transverse: { front: 0.6, diagonal: 0.65, side: 0.2 },// giros: rotación del tronco o del antebrazo
    vertical: { side: 0.9, diagonal: 0.9, front: 0.6 },   // subir y bajar: pararse, talones, pie en el aire
  };
  const LEVEL = (x) => (x >= 0.8 ? 'good' : x >= 0.5 ? 'fair' : 'poor');
  const levelText = (level) => t(`camera.level.${level}`);   // buena | regular | poco confiable

  // Sentarse y pararse con alertas (engine.js): lo que vigila el motor. `key` y `plane` no cambian con el idioma.
  const measure = (key, plane) => ({ key, get label() { return t(`camera.measure.${key}`); }, plane });
  const ENGINE = {
    measures: [measure('knee', 'sagittal'), measure('trunk', 'sagittal'), measure('valgus', 'frontal'), measure('stand', 'vertical')],
    need: [11, 12, 23, 24, 25, 26, 27, 28],
  };

  // Partes del cuerpo que el chequeo pide ver; `name` en el idioma actual ("los pies", "your feet").
  const part = (key, ids) => ({ key, ids, get name() { return t(`camera.part.${key}`); } });
  const PARTS = [
    part('head', [0, 7, 8]), part('shoulders', [11, 12]), part('elbows', [13, 14]), part('hands', [15, 16]),
    part('hips', [23, 24]), part('knees', [25, 26]), part('feet', [27, 28, 29, 30, 31, 32]),
  ];

  /**
   * Qué hay que ver: las medidas del motor (mode 'engine') o la del seguimiento de ese ejercicio. El nombre de la medida
   * del seguimiento sale de su clave `tracker.metric.<id>` si existe (tracker.js deja el literal en español para el servidor).
   */
  function measuresFor(exerciseId, mode, tracker) {
    if (mode === 'engine') return ENGINE;
    const T = tracker || root.AxonTracker;
    const spec = T && T.SPECS[exerciseId];
    const m = spec && T.METRICS[spec.metric];
    if (!m) return ENGINE;
    const labelKey = 'tracker.metric.' + spec.metric;
    return { measures: [{ key: spec.metric, get label() { return I18N.has(labelKey, I18N.BASE) ? I18N.t(labelKey) : m.label; }, plane: m.plane }],
      need: m.need };
  }

  /** Calidad de cada medida desde una vista. */
  function qualityOf(measures, view) {
    return measures.map((m) => {
      const value = (PLANE[m.plane] || PLANE.sagittal)[view];
      return Object.assign({}, m, { value, level: LEVEL(value), text: levelText(LEVEL(value)) });
    });
  }

  /** Las tres alternativas con su calidad; la recomendada es la de mejor puntaje (en empate, el orden de ORDER). */
  function options(measures) {
    const list = ORDER.map((view) => {
      const qualities = qualityOf(measures, view);
      return Object.assign({ view }, VIEWS[view], { qualities, score: qualities.reduce((s, q) => s + q.value, 0) });
    });
    const best = list.reduce((a, b) => (b.score > a.score + 1e-9 ? b : a), list[0]);
    list.forEach((o) => { o.recommended = o === best; });
    return list;
  }
  const recommend = (measures) => options(measures).find((o) => o.recommended).view;

  /** Medidas del motor que no se evalúan desde una vista (quedan "poco confiables"). */
  function disabledFor(view, measures = ENGINE.measures) {
    const out = {};
    qualityOf(measures, view).forEach((q) => { if (q.level === 'poor') out[q.key] = true; });
    return out;
  }

  // ------------------------------------------------------------------ lo que ve la cámara
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  /**
   * Ángulo de la cámara respecto de la persona, con los puntos 2D (normalizados) de MediaPipe: de frente se ven los
   * hombros y la cadera a todo su ancho; de lado se superponen. `aspect` = ancho / alto del video.
   */
  function detectView(image, aspect = 16 / 9) {
    const P = (i) => (image && image[i] ? { x: image[i].x * aspect, y: image[i].y } : null);
    const ls = P(11), rs = P(12), lh = P(23), rh = P(24);
    if (!ls || !rs || !lh || !rh) return null;
    const shMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
    const torso = dist(shMid, hipMid);
    if (torso < 1e-3) return null;
    const k = Math.max(0, Math.min(1, ((dist(ls, rs) / torso) / 0.76 + (dist(lh, rh) / torso) / 0.45) / 2));
    const yaw = (Math.acos(k) * 180) / Math.PI;
    return { yaw: Math.round(yaw), view: yaw < 28 ? 'front' : yaw < 62 ? 'diagonal' : 'side' };
  }

  /** ¿Se ve todo lo necesario, dentro de la imagen, y a una distancia en que los puntos son confiables? */
  function checkFrame(image, need, opts = {}) {
    const margin = opts.margin == null ? 0.02 : opts.margin;
    const minVis = opts.minVisibility == null ? 0.6 : opts.minVisibility;
    const seen = (i) => image && image[i] && image[i].visibility >= minVis
      && image[i].x >= margin && image[i].x <= 1 - margin && image[i].y >= margin && image[i].y <= 1 - margin;
    const missingIds = need.filter((i) => !seen(i));
    const missing = PARTS.filter((part) => part.ids.some((i) => missingIds.includes(i))).map((part) => part.name);
    const pts = [0, 11, 12, 23, 24, 25, 26, 27, 28].map((i) => image && image[i]).filter((p) => p && p.visibility >= 0.5);
    let extent = 0;
    if (pts.length >= 2) {
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      extent = Math.max(Math.max(...ys) - Math.min(...ys), Math.max(...xs) - Math.min(...xs));
    }
    const distance = extent < (opts.minExtent || 0.35) ? 'far' : 'ok';
    return { ok: missingIds.length === 0 && distance === 'ok', missing, distance, extent: Math.round(extent * 100) / 100 };
  }

  /**
   * Chequeo en vivo: update(image, t, aspect) → { frame, det, view, quality, matches, progress, ready }. Está listo
   * cuando el encuadre se mantiene bien `stableMs` seguidos.
   */
  function createCheck({ measures, need, chosen, stableMs = 1500 }) {
    let okSince = null;
    let last = null;
    return {
      update(image, t, aspect) {
        const frame = image ? checkFrame(image, need) : { ok: false, missing: [t('camera.part.all')], distance: 'ok', extent: 0 };
        const det = image ? detectView(image, aspect) : null;
        const view = det ? det.view : null;
        const good = frame.ok && Boolean(view);
        if (good) { if (okSince == null) okSince = t; } else okSince = null;
        const progress = good ? Math.min(1, (t - okSince) / stableMs) : 0;
        last = { frame, det, view, quality: view ? qualityOf(measures, view) : [], matches: view === chosen,
          progress, ready: good && progress >= 1 };
        return last;
      },
      get last() { return last; },
    };
  }

  /** "la cadera, las rodillas y los pies" / "your hips, your knees and your feet" (lista del idioma actual). */
  function listOf(items) {
    try { return new Intl.ListFormat(I18N.locale(), { style: 'long', type: 'conjunction' }).format(items); } catch { return items.join(', '); }
  }

  // ------------------------------------------------------------------ dibujo (solo navegador, con DOM)
  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** Elemento con atributos y, si hace falta, texto o hijos. */
  function make(doc, tag, attrs = {}, ...children) {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v);
    }
    el.append(...children.filter(Boolean));
    return el;
  }
  function svgEl(doc, tag, attrs = {}) {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  /** Vista desde arriba: la persona mira a la derecha; la cámara donde corresponde a la opción. */
  function diagram(doc, view) {
    const ang = { front: 0, diagonal: -45, side: -90 }[view];
    const r = 34;
    const cx = 50 + r * Math.cos((ang * Math.PI) / 180);
    const cy = 38 + r * Math.sin((ang * Math.PI) / 180);
    const rot = ang + 180;
    const svg = svgEl(doc, 'svg', { viewBox: '0 0 100 76', 'aria-hidden': 'true' });
    const cam = svgEl(doc, 'g', { transform: `translate(${cx} ${cy}) rotate(${rot})` });
    cam.append(svgEl(doc, 'rect', { x: -6, y: -5, width: 12, height: 10, rx: 2, class: 'cam-body' }),
      svgEl(doc, 'path', { d: 'M6 -3 L11 -6 L11 6 L6 3 Z', class: 'cam-body' }));
    svg.append(svgEl(doc, 'line', { x1: cx, y1: cy, x2: 50, y2: 38, class: 'cam-sight' }),
      svgEl(doc, 'circle', { cx: 50, cy: 38, r: 11, class: 'cam-person' }),
      svgEl(doc, 'path', { d: 'M61 38 L56 33 L56 43 Z', class: 'cam-nose' }), cam);
    return svg;
  }

  /** Etiquetas de calidad: "Valgo: regular". */
  const chips = (doc, qualities) => make(doc, 'span', { class: 'cam-q' },
    ...qualities.map((q) => make(doc, 'span', { class: q.level, text: t('camera.chip', { label: q.label, level: q.text }) })));

  /**
   * Tarjetas para elegir dónde va la cámara. opts: selected, hint (distancia y altura del ejercicio), onChange(view).
   * Devuelve { get selected }.
   */
  function renderOptions(container, measures, opts = {}) {
    const doc = container.ownerDocument;
    const list = options(measures);
    let selected = opts.selected && VIEWS[opts.selected] ? opts.selected : list.find((o) => o.recommended).view;
    const box = make(doc, 'div', { class: 'cam-options', role: 'radiogroup', 'aria-label': t('camera.options.aria') });
    container.replaceChildren(
      make(doc, 'div', { class: 'row-between' }, make(doc, 'h2', { text: t('camera.options.h2') }),
        make(doc, 'span', { class: 'muted cam-hint', text: opts.hint || '' })),
      make(doc, 'p', { class: 'muted', text: t('camera.options.intro') }),
      box);
    list.forEach((o) => {
      const b = make(doc, 'button', { type: 'button', class: 'cam-option', role: 'radio' });
      b.dataset.view = o.view;
      const title = make(doc, 'strong', { text: o.label });
      if (o.recommended) title.append(' ', make(doc, 'em', { text: t('camera.options.recommended') }));
      b.append(diagram(doc, o.view), title, make(doc, 'span', { class: 'muted', text: o.how }), chips(doc, o.qualities));
      b.addEventListener('click', () => { selected = o.view; paint(); if (opts.onChange) opts.onChange(o.view); });
      box.appendChild(b);
    });
    function paint() { box.querySelectorAll('.cam-option').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.view === selected))); }
    paint();
    return { get selected() { return selected; } };
  }

  /** Lista del chequeo en vivo, sobre el video. */
  function renderCheck(el, state, chosen) {
    if (!state) return;
    const doc = el.ownerDocument;
    const f = state.frame;
    const row = (ok, text) => make(doc, 'li', { class: ok === true ? 'ok' : ok === false ? 'bad' : 'warn', text });
    const angle = state.det ? t('camera.check.angle', { view: VIEWS[state.view].label, yaw: state.det.yaw }) : t('camera.check.noView');
    const angleText = state.view == null ? t('camera.check.angleNone')
      : state.matches ? t('camera.check.angleMatch', { angle }) : t('camera.check.angleOther', { angle, chosen: VIEWS[chosen].short });
    const bar = make(doc, 'span');
    bar.style.width = `${Math.round(state.progress * 100)}%`;
    el.replaceChildren(
      make(doc, 'strong', { text: t('camera.check.title') }),
      make(doc, 'ul', {},
        row(f.missing.length === 0, f.missing.length ? t('camera.check.missing', { parts: listOf(f.missing) }) : t('camera.check.allSeen')),
        row(f.distance === 'ok', f.distance === 'ok' ? t('camera.check.distanceOk') : t('camera.check.far')),
        row(state.view == null ? false : state.matches ? true : null, angleText)),
      state.quality.length ? chips(doc, state.quality) : null,
      make(doc, 'div', { class: 'meter' }, bar),
      make(doc, 'small', { text: state.progress > 0 ? t('camera.check.hold') : t('camera.check.adjust') }),
    );
  }

  /** Resumen corto para quien mira en vivo (fisioterapeuta): "cámara en diagonal (valgo regular)". */
  function summary(view, measures) {
    if (!VIEWS[view]) return '';
    const weak = qualityOf(measures, view).filter((q) => q.level !== 'good')
      .map((q) => `${q.label.toLocaleLowerCase(I18N.locale())} ${q.text}`);
    return t('camera.summary', { view: VIEWS[view].short, weak: weak.length ? ` (${weak.join(', ')})` : '' });
  }

  return { VIEWS, ORDER, PLANE, ENGINE, PARTS, measuresFor, qualityOf, options, recommend, disabledFor, detectView, checkFrame,
    createCheck, renderOptions, renderCheck, summary };
});
