/* AXONFAS · resultados anónimos de la demo pública del Prototipo (TD-108, ADR-028).
 *
 * La demo de sentarse y pararse (index.html sin plan de paciente) queda abierta para cualquiera. Al terminar, si la
 * casilla "Compartir resultados anónimos" sigue marcada, manda a POST /api/demo/runs solo números: fuente (demo o
 * cámara), repeticiones, cuántas de calibración, alertas por tipo, repeticiones mal vistas, duración y motivo de fin.
 * Nunca video, puntos del cuerpo ni datos personales (ADR-003). Quien hizo la demo no los ve después; solo el
 * Administrador. `summary` es pura (Node y navegador).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonDemoTelemetry = api;
}(typeof self !== 'undefined' ? self : this, (root) => {
  'use strict';

  const PREF_KEY = 'axonfas.demoShare';
  // Aviso en el idioma actual (i18n/session.js, demo.note): en los dos dice que es anónimo y que nunca va el video.
  const I18N = (typeof self !== 'undefined' && self.AxonI18n) || require('./i18n.js');
  const t = I18N.t;

  /** Lo único que sale: números de la sesión (detalle del evento axon:session-end de app.js). */
  function summary(detail, startedAt) {
    const reps = Array.isArray(detail.reps) ? detail.reps : [];
    const events = Array.isArray(detail.events) ? detail.events : [];
    const start = Date.parse(startedAt || ''), end = Date.parse(detail.endedAt || '');
    const duration = Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.min(7200, Math.round((end - start) / 1000)) : 0;
    return {
      source: detail.source === 'camera' ? 'camera' : 'demo',
      exercise_id: 'sit-to-stand',
      end_reason: ['completed', 'pain_stop', 'envelope_breach', 'user_quit'].includes(detail.endReason) ? detail.endReason : 'user_quit',
      reps_done: Math.min(50, reps.length),
      calibration_reps: Math.min(10, reps.filter((r) => r && r.calibration).length),
      duration_s: duration,
      trunk_events: Math.min(50, events.filter((e) => e && e.type === 'trunk_flexion').length),
      valgus_events: Math.min(100, events.filter((e) => e && e.type === 'knee_valgus').length),
      low_confidence_reps: Math.min(50, reps.filter((r) => r && r.lowConfidenceRatio > 0.2).length),
    };
  }

  const sharing = () => { try { return root.localStorage.getItem(PREF_KEY) !== 'off'; } catch { return true; } };

  function mountNote(doc) {
    const anchor = doc.getElementById('source-status');
    if (!anchor || doc.getElementById('demo-share')) return;
    const box = doc.createElement('div');
    box.className = 'demo-share';
    const label = doc.createElement('label');
    label.className = 'check';
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.id = 'demo-share';
    input.checked = sharing();
    input.addEventListener('change', () => {
      try { root.localStorage.setItem(PREF_KEY, input.checked ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
    });
    const text = doc.createElement('span');
    text.textContent = t('demo.share');
    label.append(input, text);
    const note = doc.createElement('p');
    note.className = 'muted';
    note.textContent = t('demo.note');
    box.append(label, note);
    anchor.closest('.pilot-dock') ? anchor.closest('.pilot-dock').after(box) : anchor.after(box);
  }

  if (root.document && root.addEventListener) {
    const params = new URLSearchParams(root.location ? root.location.search : '');
    const patientMode = params.get('plan') && root.AxonApi && root.AxonApi.load('patient');
    if (!patientMode) {                                   // con el plan de un paciente la sesión ya se guarda en su cuenta
      let startedAt = null;
      root.addEventListener('axon:session-start', (e) => { startedAt = e.detail && e.detail.startedAt; });
      root.addEventListener('axon:session-end', (e) => {
        const box = root.document.getElementById('demo-share');
        if (!e.detail || (box ? !box.checked : !sharing()) || !root.AxonApi) return;
        root.AxonApi.call(null, 'POST', '/api/demo/runs', summary(e.detail, startedAt)).catch(() => {});
      });
      const run = () => mountNote(root.document);
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', run);
      else run();
    }
  }

  return { PREF_KEY, get NOTE() { return t('demo.note'); }, summary };
}));
