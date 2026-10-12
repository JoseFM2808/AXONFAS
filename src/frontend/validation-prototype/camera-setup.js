/* AXONFAS · preparar la cámara antes de cada sesión (ADR-015).
 *
 * Pide una posición para que el movimiento se vea completo: ofrece alternativas (en diagonal, de frente, de lado) con
 * la calidad esperada de cada medida, recomienda la mejor para el ejercicio y, ya con la cámara encendida, revisa en
 * vivo el encuadre (que se vea lo necesario), la distancia y el ángulo real. La sesión empieza cuando todo se mantiene
 * bien un momento. La calidad depende de la posición: un movimiento hacia adelante (plano sagital) se mide bien de lado
 * y mal de frente, porque de frente es profundidad y la cámara la estima peor; uno hacia el costado (plano frontal), al
 * revés. Lo que queda "poco confiable" desde la posición real no dispara alertas (engine.js, config.disabled).
 * Funciones puras en Node y navegador; el dibujo de las tarjetas y del chequeo, solo en el navegador.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonCameraSetup = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const VIEWS = {
    diagonal: { label: 'En diagonal', short: 'en diagonal', yaw: 45, how: 'Entre tu frente y tu costado, a unos 45°' },
    front: { label: 'De frente', short: 'de frente', yaw: 0, how: 'Frente a ti, mirándote' },
    side: { label: 'De lado', short: 'de lado', yaw: 90, how: 'A tu costado, de perfil' },
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
  const LEVEL_TEXT = { good: 'buena', fair: 'regular', poor: 'poco confiable' };

  // Sentarse y pararse con alertas (engine.js): lo que vigila el motor.
  const ENGINE = {
    measures: [
      { key: 'knee', label: 'Rodilla', plane: 'sagittal' },
      { key: 'trunk', label: 'Tronco', plane: 'sagittal' },
      { key: 'valgus', label: 'Valgo', plane: 'frontal' },
      { key: 'stand', label: 'De pie', plane: 'vertical' },
    ],
    need: [11, 12, 23, 24, 25, 26, 27, 28],
  };

  const PARTS = [
    { name: 'la cabeza', ids: [0, 7, 8] }, { name: 'los hombros', ids: [11, 12] }, { name: 'los codos', ids: [13, 14] },
    { name: 'las manos', ids: [15, 16] }, { name: 'la cadera', ids: [23, 24] }, { name: 'las rodillas', ids: [25, 26] },
    { name: 'los pies', ids: [27, 28, 29, 30, 31, 32] },
  ];

  /** Qué hay que ver: las medidas del motor (mode 'engine') o la del seguimiento de ese ejercicio. */
  function measuresFor(exerciseId, mode, tracker) {
    if (mode === 'engine') return ENGINE;
    const T = tracker || root.AxonTracker;
    const spec = T && T.SPECS[exerciseId];
    const m = spec && T.METRICS[spec.metric];
    if (!m) return ENGINE;
    return { measures: [{ key: spec.metric, label: m.label, plane: m.plane }], need: m.need };
  }

  /** Calidad de cada medida desde una vista. */
  function qualityOf(measures, view) {
    return measures.map((m) => {
      const value = (PLANE[m.plane] || PLANE.sagittal)[view];
      return Object.assign({}, m, { value, level: LEVEL(value), text: LEVEL_TEXT[LEVEL(value)] });
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
        const frame = image ? checkFrame(image, need) : { ok: false, missing: ['todo el cuerpo'], distance: 'ok', extent: 0 };
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

  // ------------------------------------------------------------------ dibujo (solo navegador)
  /** Vista desde arriba: la persona mira a la derecha; la cámara donde corresponde a la opción. */
  function diagram(view) {
    const ang = { front: 0, diagonal: -45, side: -90 }[view];
    const r = 34;
    const cx = 50 + r * Math.cos((ang * Math.PI) / 180);
    const cy = 38 + r * Math.sin((ang * Math.PI) / 180);
    const rot = ang + 180;
    return `<svg viewBox="0 0 100 76" aria-hidden="true">
      <line x1="${cx}" y1="${cy}" x2="50" y2="38" class="cam-sight"/>
      <circle cx="50" cy="38" r="11" class="cam-person"/>
      <path d="M61 38 L56 33 L56 43 Z" class="cam-nose"/>
      <g transform="translate(${cx} ${cy}) rotate(${rot})"><rect x="-6" y="-5" width="12" height="10" rx="2" class="cam-body"/>
      <path d="M6 -3 L11 -6 L11 6 L6 3 Z" class="cam-body"/></g>
    </svg>`;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const chips = (qualities) => qualities.map((q) => `<span class="${q.level}">${esc(q.label)}: ${q.text}</span>`).join('');

  /**
   * Tarjetas para elegir dónde va la cámara. opts: selected, hint (distancia y altura del ejercicio), onChange(view).
   * Devuelve { get selected }.
   */
  function renderOptions(container, measures, opts = {}) {
    const list = options(measures);
    let selected = opts.selected && VIEWS[opts.selected] ? opts.selected : list.find((o) => o.recommended).view;
    container.innerHTML = `<div class="row-between"><h2>1 · ¿Dónde pones la cámara?</h2>
      <span class="muted cam-hint"></span></div>
      <p class="muted">Elige una posición. Cambia qué tan bien se ve cada medida; al encender la cámara revisamos que se vea
        todo y el ángulo real.</p>
      <div class="cam-options" role="radiogroup" aria-label="Posición de la cámara"></div>`;
    container.querySelector('.cam-hint').textContent = opts.hint || '';
    const box = container.querySelector('.cam-options');
    list.forEach((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cam-option';
      b.setAttribute('role', 'radio');
      b.dataset.view = o.view;
      b.innerHTML = `${diagram(o.view)}<strong>${esc(o.label)}${o.recommended ? ' <em>Recomendada</em>' : ''}</strong>
        <span class="muted">${esc(o.how)}</span><span class="cam-q">${chips(o.qualities)}</span>`;
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
    const f = state.frame;
    const row = (ok, text) => `<li class="${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}">${esc(text)}</li>`;
    const angle = state.det ? `${VIEWS[state.view].label} (≈${state.det.yaw}°)` : 'sin detectar';
    const angleText = state.view == null ? 'Ángulo: todavía no te veo bien'
      : state.matches ? `Ángulo: ${angle}, como elegiste` : `Ángulo: ${angle}; elegiste ${VIEWS[chosen].short}`;
    el.innerHTML = `<strong>Prepara la posición</strong><ul>
      ${row(f.missing.length === 0, f.missing.length ? `No veo ${f.missing.join(', ')}` : 'Se ve todo lo necesario')}
      ${row(f.distance === 'ok', f.distance === 'ok' ? 'Distancia correcta' : 'Estás lejos: acércate o acerca la cámara')}
      ${row(state.view == null ? false : state.matches ? true : null, angleText)}
      </ul>${state.quality.length ? `<span class="cam-q">${chips(state.quality)}</span>` : ''}
      <div class="meter"><span style="width:${Math.round(state.progress * 100)}%"></span></div>
      <small>${state.progress > 0 ? 'Quédate así un momento…' : 'Ajusta la cámara hasta que todo esté en verde.'}</small>`;
  }

  /** Resumen corto para quien mira en vivo (fisioterapeuta): "en diagonal · valgo regular". */
  function summary(view, measures) {
    if (!VIEWS[view]) return '';
    const weak = qualityOf(measures, view).filter((q) => q.level !== 'good').map((q) => `${q.label.toLowerCase()} ${q.text}`);
    return `cámara ${VIEWS[view].short}${weak.length ? ` (${weak.join(', ')})` : ''}`;
  }

  return { VIEWS, ORDER, PLANE, ENGINE, measuresFor, qualityOf, options, recommend, disabledFor, detectView, checkFrame,
    createCheck, renderOptions, renderCheck, summary };
});
