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
  banner.innerHTML = '<h2>Modo paciente</h2><p id="pl-text" class="muted">Cargando tu plan…</p><div id="symptom-index"></div>';
  document.querySelector('.wrap').prepend(banner);
  const text = (msg) => { $('pl-text').textContent = msg; };

  function setLocked(id, value) {
    const el = $(id);
    if (!el || value === undefined) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.disabled = true;
    el.title = 'Lo fijó tu fisioterapeuta';
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
      await post('/api/sessions', {
        exercise_id: exerciseId, mode: 'monitored', source: d.source === 'camera' ? 'camera' : 'demo',
        started_at: startedAt || d.endedAt, ended_at: d.endedAt, end_reason: d.endReason, reps_done: d.reps.length,
        baseline: d.baseline || undefined, reps: d.reps, events: d.events, symptom_report_ids: symptomIds,
      });
      text(`Sesión guardada y enviada a tu fisioterapeuta (${d.reps.length} repeticiones). Puedes volver a tu plan.`);
    } catch (err) {
      text(`No se pudo guardar la sesión: ${err.message}`);
    }
  });

  (async () => {
    try {
      const me = await AxonApi.call('patient', 'GET', '/api/me');
      item = me.plan.find((p) => p.exercise_id === exerciseId);
      const exercise = window.AxonCatalog && AxonCatalog.get(exerciseId);
      if (!item || !exercise || exercise.monitoring !== 'auto') {
        text('Este ejercicio no está en tu plan con monitoreo por cámara. Vuelve a tu plan.');
        item = null;
        return;
      }
      const env = item.safety_envelope;
      setLocked('trunk-margin', env.trunk_margin);
      setLocked('valgus-margin', env.valgus_margin);
      setLocked('max-reps', env.max_reps);
      $('pl-text').innerHTML = '';
      const p = document.createElement('p');
      p.textContent = `Hola, ${me.patient.alias}. Plan de ${me.therapist.name}: ${exercise.name}, ${env.max_reps} repeticiones `
        + `(3 de calibración). Tu fisioterapeuta ve en vivo tus ángulos y alertas, nunca el video. El sobre de seguridad lo fijó tu fisioterapeuta.`;
      const back = document.createElement('a');
      back.href = 'paciente.html';
      back.className = 'link';
      back.textContent = 'Volver a mi plan';
      $('pl-text').append(p, back);
      // Molestia en plena sesión (ADR-018): el servidor decide con reglas; aquí se aplica la baja o se detiene (I-7).
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
      text(err.status === 401 ? 'Tu cuenta de este equipo ya no es válida. Vuelve a afiliarte desde la página de paciente.' : err.message);
    }
  })();
})();
