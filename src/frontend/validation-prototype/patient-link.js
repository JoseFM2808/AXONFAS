/* AXONFAS · prototipo en modo paciente (ADR-012, ADR-013).
 * Se activa solo con index.html?plan=<ejercicio> y una cuenta de paciente en este navegador. Aplica el sobre de
 * seguridad que fijó el fisioterapeuta (el paciente no lo puede cambiar, ADR-005), manda al fisioterapeuta los
 * ángulos y 9 puntos del cuerpo unas 5 veces por segundo (nunca video, ADR-003) y guarda la sesión al terminar.
 */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const exerciseId = params.get('plan');
  const account = window.AxonApi && AxonApi.load('patient');
  if (!exerciseId || !account) return;

  const KEY_POINTS = [0, 11, 12, 23, 24, 25, 26, 27, 28];
  const $ = (id) => document.getElementById(id);
  const { t, tn } = window.AxonI18n;                        // idioma de la página (ADR-030)
  let item = null;
  let startedAt = null;
  let source = null;
  let lastSent = 0;
  let inFlight = false;
  let saved = false;
  let symptomIds = [];

  const banner = document.createElement('section');
  banner.className = 'panel-card';
  banner.style.marginBottom = '16px';
  const el = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text) node.textContent = text;
    return node;
  };
  const eva = el('div', { id: 'eva-index', class: 'eva-card' });
  eva.hidden = true;
  banner.append(el('h2', {}, t('link.title')), el('p', { id: 'pl-text', class: 'muted' }, t('link.loading')), eva,
    el('div', { id: 'symptom-index' }));
  document.querySelector('.wrap').prepend(banner);
  const text = (msg) => { $('pl-text').textContent = msg; };

  function setLocked(id, value) {
    const el = $(id);
    if (!el || value === undefined) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.disabled = true;
    el.title = t('link.locked');
  }

  function post(path, body) {
    return AxonApi.call('patient', 'POST', path, body);
  }

  window.addEventListener('axon:session-start', (e) => {
    startedAt = e.detail.startedAt;
    source = e.detail.source;
    saved = false;
    symptomIds = [];
  });

  window.addEventListener('axon:frame', (e) => {
    if (!item || inFlight) return;
    const now = performance.now();
    if (now - lastSent < 200) return;                        // ~5 por segundo
    lastSent = now;
    const { out, image, mirror, view } = e.detail;
    const points = {};
    if (image) KEY_POINTS.forEach((i) => { if (image[i]) points[String(i)] = [image[i].x, image[i].y]; });
    inFlight = true;
    post('/api/live', {
      exercise_id: exerciseId, source, phase: out.phase, posture: out.posture, reps_done: out.repsDone,
      reps_total: item.safety_envelope.max_reps, angles: out.angles || undefined, points, mirror, view: view || undefined,
    }).catch(() => {}).finally(() => { inFlight = false; });
  });

  window.addEventListener('axon:event', (e) => {
    e.detail.events.forEach((event) => post('/api/live', { exercise_id: exerciseId, source, event }).catch(() => {}));
  });

  window.addEventListener('axon:session-end', async (e) => {
    if (!item || saved) return;
    saved = true;
    const d = e.detail;
    post('/api/live', { exercise_id: exerciseId, source, ended: d.endReason }).catch(() => {});
    try {
      const res = await post('/api/sessions', {
        exercise_id: exerciseId, mode: 'monitored', source: d.source === 'camera' ? 'camera' : 'demo',
        started_at: startedAt || d.endedAt, ended_at: d.endedAt, end_reason: d.endReason, reps_done: d.reps.length,
        baseline: d.baseline || undefined, reps: d.reps, events: d.events, symptom_report_ids: symptomIds,
      });
      text(tn('link.saved', d.reps.length));
      // Dolor al terminar (EVA 0-10, ADR-025): opcional, le llega al fisioterapeuta.
      const exercise = window.AxonCatalog && AxonCatalog.get(exerciseId);
      if (window.AxonPainScale && res && res.session_id) {
        AxonPainScale.render($('eva-index'), { sessionId: res.session_id, exerciseName: exercise ? exercise.name : null });
      }
    } catch (err) {
      text(t('link.saveError', { error: err.message }));   // el motivo llega escrito por el servidor
    }
  });

  (async () => {
    try {
      const me = await AxonApi.call('patient', 'GET', '/api/me');
      item = me.plan.find((p) => p.exercise_id === exerciseId);
      const exercise = window.AxonCatalog && AxonCatalog.get(exerciseId);
      if (!item || !exercise || exercise.monitoring !== 'auto') {
        text(t('link.notInPlan'));
        item = null;
        return;
      }
      const env = item.safety_envelope;
      setLocked('trunk-margin', env.trunk_margin);
      setLocked('valgus-margin', env.valgus_margin);
      setLocked('max-reps', env.max_reps);
      $('pl-text').replaceChildren();
      const p = document.createElement('p');
      p.textContent = t('link.hello', { alias: me.patient.alias, therapist: me.therapist.name, exercise: exercise.name, reps: env.max_reps });
      const back = document.createElement('a');
      back.href = 'paciente.html';
      back.className = 'link';
      back.textContent = t('link.back');
      $('pl-text').append(p, back);
      // Molestia en plena sesión (ADR-021): el servidor decide con reglas; aquí se aplica la baja o se detiene (I-7).
      if (window.AxonSymptom) {
        AxonSymptom.render($('symptom-index'), { exerciseId, inSession: () => Boolean(window.AxonApp && AxonApp.current()),
          current: () => (window.AxonApp ? AxonApp.current() : null),
          onResult: (res) => {
            symptomIds.push(res.report.id);
            if (res.stop && window.AxonApp) AxonApp.stop();
            else if (res.action === 'demand_lowered' && window.AxonApp) AxonApp.adjust(res.adjustment);
          } });
      }
      AxonApi.stream('patient', '/api/me/stream', (msg) => {
        if (msg.kind === 'highlight' && window.AxonTeach) AxonTeach.show(msg);
      });
    } catch (err) {
      text(err.status === 401 ? t('link.expired') : err.message);
    }
  })();
})();
