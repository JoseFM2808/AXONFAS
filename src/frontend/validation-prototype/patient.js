/* AXONFAS · página del paciente (ADR-012, ADR-013): afiliación con consentimiento, plan con mapa muscular,
 * ejercicios guiados (series, sostén con temporizador) y avisos de enseñanza del fisioterapeuta.
 * El ejercicio con alertas (sentarse y pararse) se hace en index.html?plan=sit-to-stand (patient-link.js); los demás
 * también se pueden hacer con la cámara en seguimiento.html?ex=<id>&plan=1, que cuenta repeticiones (ADR-014).
 */
(() => {
  'use strict';
  const C = window.AxonCatalog;
  const B = window.AxonBodyMap;
  const A = window.AxonApi;
  const S = window.AxonSuggest;
  const $ = (id) => document.getElementById(id);
  const state = { me: null, guided: null, stream: null, holdTimer: 0, guide: null, rest: null };

  function show(view) {
    $('join').hidden = view !== 'join';
    $('plan').hidden = view !== 'plan';
    $('guided').hidden = view !== 'guided';
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-PE';
      window.speechSynthesis.speak(u);
    } catch { /* sin voz */ }
  }

  async function boot() {
    const code = new URLSearchParams(location.search).get('code');
    if (code) $('join-code').value = code.toUpperCase();
    if (!A.load('patient')) { show('join'); return; }
    try {
      state.me = await A.call('patient', 'GET', '/api/me');
      renderPlan();
      show('plan');
      if (!state.stream) {
        state.stream = A.stream('patient', '/api/me/stream', (msg) => {
          if (msg.kind === 'highlight' && window.AxonTeach) AxonTeach.show(msg);
          if ((msg.kind === 'plan_updated' || msg.kind === 'profile_updated') && !state.guided) boot();
        });
      }
    } catch (err) {
      if (err.status === 401) A.save('patient', null);
      $('join-error').textContent = err.message;
      show('join');
    }
  }

  $('join-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('join-error').textContent = '';
    try {
      const res = await A.call(null, 'POST', '/api/join', { code: $('join-code').value, consent: $('join-consent').checked });
      A.save('patient', { token: res.token, alias: res.patient.alias });
      history.replaceState(null, '', 'paciente.html');
      boot();
    } catch (err) { $('join-error').textContent = err.message; }
  });

  $('btn-forget').addEventListener('click', () => {
    A.save('patient', null);
    if (state.stream) { state.stream.stop(); state.stream = null; }
    show('join');
  });

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function restShort(rest) {
    if (!rest) return '60 s (sugerido)';
    return `${rest.min === rest.max ? `${rest.min} s` : `${rest.min}–${rest.max} s`}${rest.default ? ' (sugerido)' : ''}`;
  }

  function doseText(item) {
    return `${plural(item.sets, 'serie', 'series')} de ${item.reps}${item.hold_seconds ? ` · sostener ${item.hold_seconds} s` : ''} · `
      + `descanso ${restShort(item.rest)} · `
      + `${plural(item.per_week, 'vez', 'veces')} por semana · esta semana: ${item.done_7d} de ${item.per_week}`;
  }

  /** Descanso recomendado (ADR-019): cuenta regresiva que se puede saltar o alargar; nunca bloquea nada. */
  function startRest() {
    const g = state.guided;
    if (!g || !window.AxonRest) return;
    stopRest();
    state.rest = AxonRest.mount($('g-rest'), { rest: g.item.rest, speak });
  }

  function stopRest() {
    if (state.rest) { state.rest.stop(); state.rest = null; }
    if ($('g-rest')) $('g-rest').replaceChildren();
  }

  /** Rol usuario (ADR-017): consejos de uso y el perfil que el fisioterapeuta usa para adaptar el plan. */
  function renderHelp() {
    const me = state.me;
    const profile = me.patient.profile;
    if (!S) return;
    S.renderList($('tips'), S.forUser({ page: 'patient', profile, plan: me.plan }), {
      title: 'Sugerencias para ti',
      note: 'Consejos de uso calculados con reglas a partir de tu plan y tu perfil. Lo que sea de salud, consúltalo con tu fisioterapeuta.' });
    $('profile-card').open = S.profileEmpty(profile);
    S.renderProfileForm($('profile-form'), profile, async (next) => {
      const res = await A.call('patient', 'PUT', '/api/me/profile', next);
      state.me.patient.profile = res.profile;
      renderPlan(true);
    }, { who: 'patient' });
  }

  function renderPlan(keepForm = false) {
    const me = state.me;
    $('hello').textContent = `Hola, ${me.patient.alias}`;
    $('therapist').textContent = `Tu fisioterapeuta: ${me.therapist.name}. Toca "Cómo se hace" para ver los pasos.`;
    if (window.AxonSymptom) AxonSymptom.render($('symptom-plan'), { inSession: false });      // fuera de sesión: solo se registra
    if (!keepForm) renderHelp();
    else if (S) S.renderList($('tips'), S.forUser({ page: 'patient', profile: me.patient.profile, plan: me.plan }), {
      title: 'Sugerencias para ti',
      note: 'Consejos de uso calculados con reglas a partir de tu plan y tu perfil. Lo que sea de salud, consúltalo con tu fisioterapeuta.' });
    const grid = $('plan-grid');
    grid.innerHTML = '';
    if (!me.plan.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Tu fisioterapeuta todavía no te asignó ejercicios. Esta página se actualiza sola cuando lo haga.';
      grid.appendChild(p);
      return;
    }
    me.plan.forEach((item) => {
      const ex = C.get(item.exercise_id);
      if (!ex) return;
      const actions = document.createElement('div');
      actions.className = 'stack';
      if (item.notes) {
        const note = document.createElement('p');
        note.className = 'notice';
        note.textContent = `Nota de tu fisioterapeuta: ${item.notes}`;
        actions.appendChild(note);
      }
      const start = document.createElement('a');
      start.className = 'btn primary';
      start.textContent = 'Empezar con la cámara';
      start.href = ex.monitoring === 'auto' ? `index.html?plan=${encodeURIComponent(ex.id)}`      // con alertas
        : `seguimiento.html?ex=${encodeURIComponent(ex.id)}&plan=1`;                                  // con conteo
      actions.appendChild(start);
      if (ex.monitoring !== 'auto') {
        const guided = document.createElement('button');
        guided.type = 'button';
        guided.className = 'btn';
        guided.textContent = 'Sin cámara (guiado)';
        guided.addEventListener('click', () => startGuided(item, ex));
        actions.appendChild(guided);
      }
      grid.appendChild(window.AxonGallery.exerciseCard(ex, { extra: actions, doseText: doseText(item), hold: item.hold_seconds,
        profile: me.patient.profile, forPlan: true }));
    });
  }

  // ------------------------------------------------------------------ guiado
  function publish(extra) {
    const g = state.guided;
    if (!g) return;
    A.call('patient', 'POST', '/api/live', { exercise_id: g.ex.id, source: 'guided', phase: 'guided', reps_done: g.setsDone,
      reps_total: g.item.sets, ...extra }).catch(() => {});
  }

  function startGuided(item, ex) {
    state.guided = { item, ex, setsDone: 0, startedAt: new Date().toISOString(), symptomIds: [] };
    $('g-title').textContent = ex.name;
    B.render($('g-map'), { intensities: B.staticLoad(ex), caption: `Trabajas: ${B.muscleNames(ex.muscles).join(', ')}. Huesos: ${ex.bones.join(', ')}.` });
    if (state.guide) state.guide.stop();
    if (window.AxonGuide && $('g-guide')) {
      state.guide = AxonGuide.render($('g-guide'), ex.id, { hold: item.hold_seconds, variant: 'large', autoplay: 'visible' });
    }
    const steps = $('g-steps');
    steps.innerHTML = '';
    ex.steps.forEach((s) => { const li = document.createElement('li'); li.textContent = s; steps.appendChild(li); });
    $('g-dose').textContent = doseText(item);
    $('g-hold').hidden = !item.hold_seconds;
    $('g-status').textContent = '';
    stopRest();
    if (window.AxonSymptom) {
      AxonSymptom.render($('g-symptom'), { exerciseId: ex.id, inSession: true, current: () => null, onResult: onSymptom });
    }
    renderGuided();
    show('guided');
    speak(`${ex.name}. ${item.sets} series de ${item.reps}.`);
    publish();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Respuesta del formulario de molestia en la vista guiada: se une a la sesión por id; una alarma la detiene (I-7). */
  function onSymptom(res) {
    const g = state.guided;
    if (!g) return;
    g.symptomIds.push(res.report.id);
    if (res.stop) { endGuided('pain_stop'); return; }
    speak(res.message);
    if (res.action === 'paused') startRest();             // tras una molestia, el descanso recomendado
  }

  function renderGuided() {
    const g = state.guided;
    $('g-big').textContent = `${Math.min(g.setsDone + 1, g.item.sets)} / ${g.item.sets}`;
    $('g-sub').textContent = g.setsDone >= g.item.sets ? 'Series completas' : `Serie en curso: ${g.item.reps} repeticiones`;
  }

  async function endGuided(reason) {
    const g = state.guided;
    if (!g) return;
    clearInterval(state.holdTimer);
    stopRest();
    if (state.guide) { state.guide.stop(); state.guide = null; }
    publish({ ended: reason });
    state.guided = null;
    try {
      await A.call('patient', 'POST', '/api/sessions', { exercise_id: g.ex.id, mode: 'guided', source: 'guided',
        started_at: g.startedAt, ended_at: new Date().toISOString(), end_reason: reason, reps_done: g.setsDone * g.item.reps,
        symptom_report_ids: g.symptomIds });
      if (reason === 'pain_stop') speak('Sesión detenida. Si el dolor sigue, contacta a tu fisioterapeuta.');
      else if (reason === 'completed') speak('Listo. Ejercicio completado.');
    } catch (err) {
      $('g-status').textContent = `No se pudo guardar: ${err.message}`;
    }
    await boot();
  }

  $('g-set').addEventListener('click', () => {
    const g = state.guided;
    if (!g) return;
    stopRest();                                           // "Terminé la serie" siempre está disponible y corta el descanso
    g.setsDone += 1;
    publish();
    if (g.setsDone >= g.item.sets) { endGuided('completed'); return; }
    renderGuided();
    startRest();
  });
  $('g-pain').addEventListener('click', () => endGuided('pain_stop'));
  $('g-quit').addEventListener('click', () => endGuided('user_quit'));
  $('g-hold').addEventListener('click', () => {
    const g = state.guided;
    if (!g || !g.item.hold_seconds) return;
    clearInterval(state.holdTimer);
    let left = g.item.hold_seconds;
    $('g-big').textContent = `${left} s`;
    speak('Sostén');
    state.holdTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(state.holdTimer);
        speak('Suelta');
        renderGuided();
        return;
      }
      $('g-big').textContent = `${left} s`;
    }, 1000);
  });

  boot();
})();
