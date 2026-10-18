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
  const I18N = window.AxonI18n;                    // idioma de la interfaz (ADR-030)
  const { t, tn } = I18N;
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
      u.lang = I18N.speechLang();                  // voz del idioma de la página (es-PE o en-US)
      const voice = I18N.voiceFor(window.speechSynthesis.getVoices());
      if (voice) u.voice = voice;
      window.speechSynthesis.speak(u);
    } catch { /* sin voz */ }
  }

  async function boot() {
    const code = new URLSearchParams(location.search).get('code');
    if (code) $('join-code').value = code.toUpperCase();
    if (!A.load('patient')) {
      show('join');
      A.config().then((cfg) => { $('join-form').hidden = !cfg.demo_accounts; $('demo-join-note').hidden = !cfg.demo_accounts; });
      return;
    }
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

  $('btn-forget').addEventListener('click', async () => {
    await A.logout('patient');
    if (state.stream) { state.stream.stop(); state.stream = null; }
    show('join');
  });

  function restShort(rest) {
    if (!rest) return t('patient.rest.suggested', { rest: '60 s' });
    const span = rest.min === rest.max ? `${rest.min} s` : `${rest.min}–${rest.max} s`;
    return rest.default ? t('patient.rest.suggested', { rest: span }) : span;
  }

  function doseText(item) {
    return t('patient.dose.text', { sets: tn('patient.dose.sets', item.sets), reps: item.reps,
      hold: item.hold_seconds ? t('patient.dose.hold', { s: item.hold_seconds }) : '', rest: restShort(item.rest),
      times: tn('patient.dose.times', item.per_week) });
  }

  /** Dolor al terminar (EVA 0-10, ADR-025): se pide después de guardar la sesión; es opcional. */
  function askPain(sessionId, ex) {
    if (!window.AxonPainScale || !sessionId) return;
    const card = $('eva-card');
    AxonPainScale.render(card, { sessionId, exerciseName: ex.name, onDone: () => { state.painFor = null; } });
    state.painFor = sessionId;
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /** Descanso recomendado (ADR-022): cuenta regresiva que se puede saltar o alargar; nunca bloquea nada. */
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
    $('profile-card').open = S.profileEmpty(profile);
    S.renderProfileForm($('profile-form'), profile, async (next) => {
      const res = await A.call('patient', 'PUT', '/api/me/profile', next);
      state.me.patient.profile = res.profile;
      renderPlan(true);
    }, { who: 'patient' });
  }

  /** Plan con lo de esta semana según la agenda (lunes a domingo) para las sugerencias de uso. */
  function planForTips(day) {
    const by = Object.fromEntries(day.all.map((x) => [x.exercise_id, x]));
    return state.me.plan.map((item) => {
      const x = by[item.exercise_id];
      return x ? Object.assign({}, item, { done_7d: x.weekDone, due: x.status === 'today' }) : item;
    });
  }

  function renderPlan(keepForm = false) {
    const me = state.me;
    const day = window.AxonCarePlan ? AxonCarePlan.agenda(me.plan) : { all: [], today: me.plan.map((item) => ({ item })), rest: [], pending: 0 };
    $('hello').textContent = t('patient.hello', { alias: me.patient.alias });
    $('therapist').textContent = t('patient.therapist', { name: me.therapist.name });
    if (window.AxonSymptom) AxonSymptom.render($('symptom-plan'), { inSession: false });      // fuera de sesión: solo se registra
    if (!keepForm) renderHelp();
    if (S) S.renderList($('tips'), S.forUser({ page: 'patient', profile: me.patient.profile, plan: planForTips(day) }), {
      title: t('patient.tips.title'),
      note: t('patient.tips.note') });
    const grid = $('plan-grid');
    const restGrid = $('rest-grid');
    grid.replaceChildren();
    restGrid.replaceChildren();
    $('rest-plan').hidden = true;
    if (!me.plan.length) {
      $('today-note').textContent = t('patient.today.empty');
      return;
    }
    // Plan de Cuidados del día (ADR-025): primero lo que toca hoy; el resto queda plegado y se puede hacer igual.
    $('today-note').textContent = day.pending ? tn('patient.today.pending', day.pending)
      : day.today.length ? t('patient.today.done')
        : t('patient.today.restDay', { next: nextText(day) });
    day.today.forEach((x) => { const card = planCard(x); if (card) grid.appendChild(card); });
    if (day.rest.length) {
      $('rest-summary').textContent = t('patient.rest.summaryCount', { n: day.rest.length });
      day.rest.forEach((x) => { const card = planCard(x); if (card) restGrid.appendChild(card); });
      $('rest-plan').hidden = false;
    }
  }

  function nextText(day) {
    const next = day.rest.filter((x) => x.status === 'rest').sort((a, b) => a.next - b.next)[0];
    if (!next) return t('patient.next.allDone');
    const ex = C.get(next.exercise_id);
    return t('patient.next.exercise', { exercise: ex ? ex.name : next.exercise_id, day: AxonCarePlan.dayName(next.next) });
  }

  function planCard(x) {
    const item = x.item;
    const ex = C.get(item.exercise_id);
    if (!ex) return null;
    const actions = document.createElement('div');
    actions.className = 'stack';
    if (x.status && window.AxonCarePlan) {
      const tag = document.createElement('p');
      tag.className = `today-status${x.status === 'done_today' || x.status === 'week_done' ? ' done' : ''}`;
      tag.textContent = AxonCarePlan.statusText(x);
      actions.appendChild(tag);
    }
    if (item.notes) {
      const note = document.createElement('p');
      note.className = 'notice';
      note.textContent = t('patient.card.note', { note: item.notes });         // la nota la escribió el fisioterapeuta: tal cual
      actions.appendChild(note);
    }
    const start = document.createElement('a');
    start.className = 'btn primary';
    start.textContent = t('patient.card.camera');
    start.href = ex.monitoring === 'auto' ? `index.html?plan=${encodeURIComponent(ex.id)}`      // con alertas
      : `seguimiento.html?ex=${encodeURIComponent(ex.id)}&plan=1`;                                  // con conteo
    actions.appendChild(start);
    if (ex.monitoring !== 'auto') {
      const guided = document.createElement('button');
      guided.type = 'button';
      guided.className = 'btn';
      guided.textContent = t('patient.card.guided');
      guided.addEventListener('click', () => startGuided(item, ex));
      actions.appendChild(guided);
    }
    return window.AxonGallery.exerciseCard(ex, { extra: actions, doseText: doseText(item), hold: item.hold_seconds,
      profile: state.me.patient.profile, forPlan: true });
  }

  // ------------------------------------------------------------------ guiado
  function publish(extra) {
    const g = state.guided;
    if (!g) return;
    A.call('patient', 'POST', '/api/live', { exercise_id: g.ex.id, source: 'guided', phase: 'guided', reps_done: g.setsDone,
      reps_total: g.item.sets, ...extra }).catch(() => {});
  }

  function startGuided(item, ex) {
    state.guided = { item, ex, setsDone: 0, startedAt: new Date().toISOString(), symptomIds: [], turnIds: [] };
    $('g-title').textContent = ex.name;
    B.render($('g-map'), { intensities: B.staticLoad(ex),
      caption: t('patient.guided.caption', { muscles: B.muscleNames(ex.muscles).join(', '), bones: ex.bones.join(', ') }) });
    if (state.guide) state.guide.stop();
    if (window.AxonGuide && $('g-guide')) {
      state.guide = AxonGuide.render($('g-guide'), ex.id, { hold: item.hold_seconds, variant: 'large', autoplay: 'visible' });
    }
    const steps = $('g-steps');
    steps.replaceChildren();
    ex.steps.forEach((s) => { const li = document.createElement('li'); li.textContent = s; steps.appendChild(li); });
    $('g-dose').textContent = doseText(item);
    $('g-hold').hidden = !item.hold_seconds;
    $('g-status').textContent = '';
    stopRest();
    if (window.AxonSymptom) {
      AxonSymptom.render($('g-symptom'), { exerciseId: ex.id, inSession: true, current: () => null, turn: true, assistant: state.me && state.me.assistant, onResult: onSymptom });
    }
    renderGuided();
    show('guided');
    speak(tn('patient.speak.start', item.sets, { exercise: ex.name, reps: item.reps }));
    publish();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Respuesta del formulario de molestia en la vista guiada: se une a la sesión por id; una alarma la detiene (I-7). */
  function onSymptom(res) {
    const g = state.guided;
    if (!g) return;
    if (res.report) g.symptomIds.push(res.report.id);
    if (res.turn) g.turnIds.push(res.turn.id);
    if (res.stop) { endGuided('pain_stop'); return; }
    speak(res.message);                                   // texto del servidor, en el idioma de la página (TD-116)
    if (res.action === 'paused') startRest();             // tras una molestia, el descanso recomendado
  }

  function renderGuided() {
    const g = state.guided;
    $('g-big').textContent = `${Math.min(g.setsDone + 1, g.item.sets)} / ${g.item.sets}`;
    $('g-sub').textContent = g.setsDone >= g.item.sets ? t('patient.guided.allSets') : t('patient.guided.current', { reps: g.item.reps });
  }

  async function endGuided(reason) {
    const g = state.guided;
    if (!g) return;
    clearInterval(state.holdTimer);
    stopRest();
    if (state.guide) { state.guide.stop(); state.guide = null; }
    publish({ ended: reason });
    state.guided = null;
    let saved = null;
    try {
      saved = await A.call('patient', 'POST', '/api/sessions', { exercise_id: g.ex.id, mode: 'guided', source: 'guided',
        started_at: g.startedAt, ended_at: new Date().toISOString(), end_reason: reason, reps_done: g.setsDone * g.item.reps,
        symptom_report_ids: g.symptomIds, voice_turn_ids: g.turnIds });
      if (reason === 'pain_stop') speak(t('patient.speak.painStop'));
      else if (reason === 'completed') speak(t('patient.speak.done'));
    } catch (err) {
      $('g-status').textContent = t('patient.saveError', { error: err.message });
    }
    await boot();
    if (saved) askPain(saved.session_id, g.ex);
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
    speak(t('patient.speak.hold'));
    state.holdTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(state.holdTimer);
        speak(t('patient.speak.release'));
        renderGuided();
        return;
      }
      $('g-big').textContent = `${left} s`;
    }, 1000);
  });

  boot();
})();
