/* AXONFAS · gemelo digital del Prototipo: espejo inteligente sobre el video (TD-101).
 *
 * Dibuja en el canvas el esqueleto de la persona con los puntos 2D de MediaPipe. Con la cámara, el video y el canvas se
 * ven en espejo (clase .mirror de pose-camera.js), así que la persona se ve como frente a un espejo. Mientras dura una
 * alerta del motor, pinta los segmentos que compensan en el color de alerta y agrega una guía de corrección: la
 * alineación objetivo punteada (cadera-tobillo en el valgo, tronco vertical en la flexión) y una flecha desde donde está
 * el segmento hacia donde debería ir. Solo dibuja: las alertas siguen saliendo del motor de reglas (I-1). Sin texto en
 * el canvas, porque el espejo lo invertiría. Colores de los tokens (--tape, --alert, --safe, --muted, --ink).
 * `guides` es pura (Node y navegador); `draw`, solo en el navegador.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonTwin = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BONES = [[11, 12], [23, 24], [11, 23], [12, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
  const JOINTS = [11, 12, 23, 24, 25, 26, 27, 28];
  const LEGS = { knee_valgus_left: [23, 25, 27], knee_valgus_right: [24, 26, 28] };
  // Segmentos que compensan en cada alerta (se pintan en el color de alerta).
  const ALERT_BONES = {
    trunk_flexion: [[11, 23], [12, 24], [11, 12]],
    knee_valgus_left: [[23, 25], [25, 27]],
    knee_valgus_right: [[24, 26], [26, 28]],
  };

  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const seen = (...ps) => ps.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));

  /** ¿El segmento a-b es parte de la compensación `alertKey`? */
  function isAlertBone(alertKey, a, b) {
    return (ALERT_BONES[alertKey] || []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  }

  /**
   * Guía de corrección para una alerta, en coordenadas normalizadas de imagen (y hacia abajo):
   * [{ kind: 'target', from, to }, { kind: 'arrow', from, to }]. Vacía sin alerta o si faltan puntos.
   */
  function guides(image, alertKey) {
    if (!image || !alertKey) return [];
    if (LEGS[alertKey]) {
      const [hip, knee, ankle] = LEGS[alertKey].map((i) => image[i]);
      if (!seen(hip, knee, ankle)) return [];
      const dy = ankle.y - hip.y;
      const t = Math.abs(dy) < 1e-6 ? 0.5 : Math.min(1, Math.max(0, (knee.y - hip.y) / dy));
      const onLine = { x: hip.x + (ankle.x - hip.x) * t, y: knee.y };   // donde iría la rodilla alineada
      return [
        { kind: 'target', from: { x: hip.x, y: hip.y }, to: { x: ankle.x, y: ankle.y } },
        { kind: 'arrow', from: { x: knee.x, y: knee.y }, to: onLine },
      ];
    }
    if (alertKey === 'trunk_flexion') {
      const [ls, rs, lh, rh] = [11, 12, 23, 24].map((i) => image[i]);
      if (!seen(ls, rs, lh, rh)) return [];
      const hip = mid(lh, rh), sh = mid(ls, rs);
      const len = Math.hypot(sh.x - hip.x, sh.y - hip.y);
      const upright = { x: hip.x, y: hip.y - len };                     // el mismo tronco, vertical
      return [
        { kind: 'target', from: hip, to: upright },
        { kind: 'arrow', from: sh, to: upright },
      ];
    }
    return [];
  }

  // ------------------------------------------------------------------ dibujo (solo navegador)
  const cssVar = (name, fallback) => {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
  };

  function arrow(ctx, from, to, w, h, size) {
    const x1 = from.x * w, y1 = from.y * h, x2 = to.x * w, y2 = to.y * h;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    if (Math.hypot(x2 - x1, y2 - y1) < size) return;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - size * Math.cos(ang - 0.5), y2 - size * Math.sin(ang - 0.5));
    ctx.lineTo(x2 - size * Math.cos(ang + 0.5), y2 - size * Math.sin(ang + 0.5));
    ctx.closePath();
    ctx.fill();
  }

  /** Dibuja el gemelo. opts: { alertKey, lowConfidence }. */
  function draw(ctx, image, opts = {}) {
    const { width: w, height: h } = ctx.canvas;
    ctx.clearRect(0, 0, w, h);
    if (!image) return;
    const ok = opts.lowConfidence ? cssVar('--muted', '#8A9BA8') : cssVar('--tape', '#00E5FF');
    const bad = cssVar('--alert', '#FF0055');
    const guide = cssVar('--safe', '#00FF9C');
    const lw = Math.max(4, w / 220);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    for (const [a, b] of BONES) {
      const p = image[a], q = image[b];
      if (!p || !q) continue;
      ctx.strokeStyle = isAlertBone(opts.alertKey, a, b) ? bad : ok;
      ctx.globalAlpha = Math.min(p.visibility, q.visibility) < 0.5 ? 0.35 : 1;
      ctx.beginPath();
      ctx.moveTo(p.x * w, p.y * h);
      ctx.lineTo(q.x * w, q.y * h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = cssVar('--ink', '#E0E9EC');
    for (const i of JOINTS) {
      const p = image[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, Math.max(5, w / 200), 0, Math.PI * 2);
      ctx.fill();
    }
    const list = guides(image, opts.alertKey);
    if (list.length) {
      ctx.strokeStyle = guide;
      ctx.fillStyle = guide;
      ctx.lineWidth = Math.max(3, lw * 0.7);
      for (const g of list) {
        if (g.kind === 'target') {
          ctx.setLineDash([lw * 3, lw * 2.5]);
          ctx.beginPath();
          ctx.moveTo(g.from.x * w, g.from.y * h);
          ctx.lineTo(g.to.x * w, g.to.y * h);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          arrow(ctx, g.from, g.to, w, h, lw * 4);
        }
      }
    }
    ctx.restore();
  }

  return { BONES, JOINTS, ALERT_BONES, isAlertBone, guides, draw };
});
