/* AXONFAS · panel del fisioterapeuta (ADR-012, ADR-013).
 * Cuenta de demostración, afiliación con código y QR, plan desde el catálogo con sobre de seguridad, indicadores de
 * cumplimiento y efectividad, vista en vivo (mapa muscular estimado, esqueleto rotulado, ángulos, alertas) y enseñanza.
 */
(() => {
  'use strict';
  const C = window.AxonCatalog;
  const B = window.AxonBodyMap;
  const A = window.AxonApi;
  const S = window.AxonSuggest;
  const $ = (id) => document.getElementById(id);
  const END = { completed: 'Completada', pain_stop: 'Detenida por dolor', user_quit: 'Terminada a mano', envelope_breach: 'Fuera del sobre' };
  const SOURCE = { camera: 'Cámara', demo: 'Demo sintético', guided: 'Guiado' };
  const REPORT_ACTION = { none: 'Crear borrador', draft: 'Ver borrador', final: 'Ver nota firmada' };
  const EVENT = { trunk_flexion: 'Flexión de tronco', knee_valgus: 'Valgo de rodilla' };
  const SIDE = { left: 'izquierda', right: 'derecha' };
  const state = { selected: null, detail: null, stream: null, liveMap: null, teachMap: null, teachGuide: null, lastFrame: 0, alertUntil: 0,
    alertMuscles: [], feed: [], refreshTimer: 0, livenessTimer: 0, suggestions: [], ai: null };

  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // ------------------------------------------------------------------ cuenta
  function show(view) {
    $('login').hidden = view !== 'login';
    $('dashboard').hidden = view !== 'dashboard';
  }

  async function boot() {
    if (!A.load('therapist')) { show('login'); return; }
    try {
      await refreshPatients();
      show('dashboard');
      clearInterval(state.refreshTimer);
      state.refreshTimer = setInterval(() => refreshPatients().catch(() => {}), 15000);
    } catch (err) {
      if (err.status === 401) A.save('therapist', null);
      $('login-error').textContent = err.message;
      show('login');
    }
  }

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('login-error').textContent = '';
    try {
      const res = await A.call(null, 'POST', '/api/therapists', { name: $('login-name').value });
      A.save('therapist', { token: res.token, name: res.therapist.name });
      boot();
    } catch (err) { $('login-error').textContent = err.message; }
  });

  $('btn-logout').addEventListener('click', () => {
    A.save('therapist', null);
    selectPatient(null);
    clearInterval(state.refreshTimer);
    show('login');
  });

  // ------------------------------------------------------------------ pacientes
  async function refreshPatients() {
    const data = await A.call('therapist', 'GET', '/api/therapists/me');
    $('doctor-name').textContent = data.therapist.name;
    renderPatients(data.patients);
    return data;
  }

  function renderPatients(list) {
    const grid = $('patients');
    grid.innerHTML = '';
    if (!list.length) {
      grid.appendChild(el('p', 'muted', 'Todavía no tienes pacientes. Usa "Afiliar paciente" para crear un código.'));
      return;
    }
    list.forEach((p) => {
      const card = el('button', 'ex-card patient-card');
      card.type = 'button';
      card.setAttribute('aria-current', String(p.id === state.selected));
      const head = el('div', 'row-between');
      head.append(el('h3', null, p.alias));
      const live = el('span', `live-dot${p.live ? ' on' : ''}`);
      live.title = p.live ? 'En sesión ahora' : 'Sin sesión en curso';
      head.appendChild(live);
      const m = p.metrics;
      const status = p.joined_at ? `Afiliado · ${p.plan_size} ejercicio(s) en el plan` : `Esperando afiliación · código ${p.invite_code}`;
      const meter = el('div', `meter${m.adherence == null ? '' : m.adherence < 0.5 ? ' bad' : m.adherence < 0.8 ? ' warn' : ''}`);
      const bar = el('span');
      bar.style.width = `${Math.round((m.adherence || 0) * 100)}%`;
      meter.appendChild(bar);
      const facts = el('div', 'facts');
      facts.append(el('span', null, `Cumplimiento 7 días: ${pct(m.adherence)}`), el('span', null, `Calidad última sesión: ${pct(m.quality)}`),
        el('span', null, `Última sesión: ${fmtDate(m.last_session_at)}`));
      card.append(head, el('p', 'muted', status), meter, facts);
      if (m.discomfort_30d) card.appendChild(el('span', 'tag warn', `${m.discomfort_30d} molestia(s) (30 días)`));
      if (!p.consent_given) card.appendChild(el('span', 'tag warn', 'Sin consentimiento'));
      if (m.pain_stops_30d) card.appendChild(el('span', 'tag bad', `${m.pain_stops_30d} detención(es) por dolor en 30 días`));
      card.addEventListener('click', () => selectPatient(p.id));
      grid.appendChild(card);
    });
  }

  async function selectPatient(id) {
    if (state.stream) { state.stream.stop(); state.stream = null; }
    state.selected = id;
    state.feed = [];
    resetSoap();                                   // la nota abierta era de otro paciente: no se firma por error
    $('p-reinvite-status').textContent = '';
    document.querySelectorAll('.patient-card').forEach((c) => c.setAttribute('aria-current', 'false'));
    if (!id) { $('patient').hidden = true; return; }
    await loadDetail();
    $('patient').hidden = false;
    startLive();
    $('patient').scrollIntoView({ behavior: 'smooth', block: 'start' });
    refreshPatients().catch(() => {});
  }

  async function loadDetail() {
    const d = await A.call('therapist', 'GET', `/api/patients/${state.selected}`);
    state.detail = d;
    renderDetail(d);
  }

  function kpi(k, v, s) {
    const box = el('div', 'kpi');
    box.append(el('span', 'k', k), el('span', 'v', v), el('span', 's', s));
    return box;
  }

  async function renderInvite(p) {
    const box = $('p-invite');
    box.hidden = !p.invite_code;
    if (!p.invite_code) return;
    const url = await A.shareUrl(`paciente.html?code=${p.invite_code}`);
    box.innerHTML = '';
    box.appendChild(el('h2', null, 'Código de afiliación'));
    const grid = el('div', 'invite');
    const qr = el('div', 'share-qr');
    qr.innerHTML = A.qrSvg(url);
    const info = el('div', 'stack');
    info.append(el('div', 'code-big', p.invite_code), el('p', 'muted',
      'El paciente escanea el QR con su celular (misma red wifi) o abre la página de Paciente y escribe el código. '
      + 'Al afiliarse acepta el consentimiento y el código deja de servir.'));
    const link = el('code', 'share-url', url);
    info.appendChild(link);
    grid.append(qr, info);
    box.appendChild(grid);
  }

  /** Efectividad con la cámara (TD-49): recorrido medio por repetición y, si la dosis lo pide, sostén medio. */
  function cameraText(x, item) {
    const last = x && x.camera_last;
    if (!last) return '—';
    const spec = window.AxonTracker && AxonTracker.SPECS[x.exercise_id];
    const unit = spec ? AxonTracker.METRICS[spec.metric].unit : '';
    const v = (n) => `${n}${unit === '°' ? '°' : unit ? ` ${unit}` : ''}`;
    const first = x.camera_first;
    const parts = [];
    if (last.peak != null) parts.push(`recorrido ${v(last.peak)}${x.camera_sessions > 1 && first.peak != null ? ` (1.ª: ${v(first.peak)})` : ''}`);
    const holds = item.hold_seconds > 0 || (spec && spec.mode !== 'reps');      // sin sostén en la dosis, no se muestra
    if (last.hold != null && holds) parts.push(`sostén ${last.hold} s`);
    return parts.length ? parts.join(' · ') : '—';
  }

  function renderDetail(d) {
    const p = d.patient;
    $('p-title').textContent = p.alias + (p.birth_year ? ` · ${p.birth_year}` : '');
    $('p-status').textContent = p.joined_at ? `Afiliado el ${fmtDate(p.joined_at)} · consentimiento aceptado`
      : 'Esperando afiliación: el consentimiento se vuelve a pedir con el código nuevo.';
    renderInvite(p);
    const m = d.metrics;
    const trend = m.quality_trend == null ? 'con 4 sesiones o más' : `${m.quality_trend >= 0 ? '+' : ''}${Math.round(m.quality_trend * 100)} puntos`;
    $('p-kpis').replaceChildren(
      kpi('Cumplimiento 7 días', pct(m.adherence), 'sesiones completadas / indicadas'),
      kpi('Calidad', pct(m.quality), 'reps sin compensación (última)'),
      kpi('Tendencia calidad', m.quality_trend == null ? '—' : trend, 'últimas 3 vs primeras 3'),
      kpi('Rodilla (ROM)', m.rom_last == null ? '—' : `${m.rom_last}°`, m.rom_first == null ? 'sin sesiones monitoreadas' : `primera sesión: ${m.rom_first}°`),
      kpi('Detenciones por dolor', String(m.pain_stops_30d), 'en 30 días'),
      kpi('Molestias 30 días', String(m.discomfort_30d ?? 0), m.red_flags_30d ? `${m.red_flags_30d} con señal de alarma` : 'reportadas por el paciente'),
      kpi('Sesiones', String(m.sessions_total), `última: ${fmtDate(m.last_session_at)}`));

    const perEx = Object.fromEntries(m.per_exercise.map((x) => [x.exercise_id, x]));
    const body = $('p-plan');
    body.innerHTML = '';
    if (!d.plan.length) {
      const tr = el('tr');
      const td = el('td', 'empty', 'Sin ejercicios. Usa "Editar plan".');
      td.colSpan = 6;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    d.plan.forEach((item) => {
      const ex = C.get(item.exercise_id);
      const tr = el('tr');
      const env = item.safety_envelope;
      const dose = `${item.sets} × ${item.reps}${item.hold_seconds ? ` · ${item.hold_seconds} s` : ''}`;
      const week = perEx[item.exercise_id] ? `${perEx[item.exercise_id].done_7d} de ${item.per_week}` : `0 de ${item.per_week}`;
      const romText = env && env.rom_min != null && env.rom_max != null ? ` · rodilla ${env.rom_min}–${env.rom_max}°` : '';
      const envText = env && env.trunk_margin ? `tronco +${env.trunk_margin}° · valgo +${env.valgus_margin}° · ${env.max_reps} reps${romText}`
        : 'sin alertas: conteo con cámara o guiado';
      const r = item.rest;
      const restText = !r || r.default ? `${r ? r.min : 60} s (por defecto)` : r.min === r.max ? `${r.min} s` : `${r.min}–${r.max} s`;
      [ex ? ex.name : item.exercise_id, dose, week, cameraText(perEx[item.exercise_id], item), envText, restText]
        .forEach((t) => tr.appendChild(el('td', null, t)));
      body.appendChild(tr);
    });

    const eventsBySession = {};
    d.events.forEach((e) => { eventsBySession[e.session_id] = (eventsBySession[e.session_id] || 0) + 1; });
    const sBody = $('p-sessions');
    sBody.innerHTML = '';
    if (!d.sessions.length) {
      const tr = el('tr');
      const td = el('td', 'empty', 'Todavía no hay sesiones.');
      td.colSpan = 7;
      tr.appendChild(td);
      sBody.appendChild(tr);
    }
    d.sessions.forEach((s) => {
      const ex = C.get(s.exercise_id);
      const tr = el('tr');
      [fmtDate(s.ended_at), ex ? ex.name : s.exercise_id,
        s.mode === 'guided' && s.source === 'camera' ? 'Cámara (conteo)' : SOURCE[s.source] || s.source, String(s.reps_done)]
        .forEach((t) => tr.appendChild(el('td', null, t)));
      const end = el('td');
      end.appendChild(el('span', `tag ${s.end_reason === 'completed' ? 'ok' : s.end_reason === 'pain_stop' ? 'bad' : 'warn'}`, END[s.end_reason] || s.end_reason));
      tr.appendChild(end);
      tr.appendChild(el('td', 'num', String(eventsBySession[s.id] || 0)));
      const note = el('td');
      const label = REPORT_ACTION[s.report_status || 'none'];
      const btn = el('button', 'btn', label);
      btn.type = 'button';
      btn.dataset.session = String(s.id);
      btn.setAttribute('aria-label', `${label} de la sesión del ${fmtDate(s.ended_at)} (${ex ? ex.name : s.exercise_id})`);
      btn.addEventListener('click', () => openReport(s, btn));
      note.appendChild(btn);
      tr.appendChild(note);
      sBody.appendChild(tr);
    });

    const evBox = $('p-events');
    evBox.innerHTML = '';
    if (!d.events.length) evBox.appendChild(el('p', 'muted', 'Sin compensaciones registradas.'));
    d.events.slice(0, 12).forEach((e) => {
      evBox.appendChild(el('div', null, `Rep ${e.rep} · ${EVENT[e.type]}${e.side ? ` ${SIDE[e.side]}` : ''} · pico ${e.peak}° `
        + `(umbral ${e.threshold}°) · severidad ${e.severity}${e.alert_latency_ms != null ? ` · ${e.alert_latency_ms} ms` : ''}`));
    });
    renderSymptoms(d);
    renderTeach(d.plan);
    renderProfile(d);
    renderSuggestions(d);
  }

  // ------------------------------------------------------------------ molestias del paciente (ADR-021)
  const SYMPTOM_CATEGORY = { pain: 'dolor o molestia', cramp: 'calambre', fatigue: 'cansancio', stiffness: 'rigidez', other: 'otra molestia',
    red_flag: 'señal de alarma' };
  const PARAM_NAME = { rom_target: 'el rango', reps: 'las repeticiones', rest_seconds: 'el descanso' };
  const PARAM_UNIT = { rom_target: '°', reps: '', rest_seconds: ' s' };
  function symptomAction(s) {
    if (s.action === 'demand_lowered' && s.adjustment) {
      const a = s.adjustment;
      return `se bajó ${PARAM_NAME[a.param] || a.param} de ${a.old}${PARAM_UNIT[a.param] || ''} a ${a.new}${PARAM_UNIT[a.param] || ''}`;
    }
    return { session_stopped: 'se detuvo la sesión', paused: 'pausa', logged: 'registrada', demand_lowered: 'se bajó la exigencia' }[s.action] || s.action;
  }

  function renderSymptoms(d) {
    const box = $('p-symptoms');
    box.innerHTML = '';
    const list = d.symptoms || [];
    if (!list.length) box.appendChild(el('p', 'muted', 'Sin molestias reportadas.'));
    list.slice(0, 12).forEach((s) => {
      const ex = C.get(s.exercise_id);
      const row = el('div', 'row-between');
      const text = `${fmtDate(s.reported_at)} · ${ex ? ex.name : 'sin ejercicio'} · ${SYMPTOM_CATEGORY[s.category] || s.category}`
        + `${s.text ? ` · «${s.text}»` : ''} · ${symptomAction(s)}`;
      row.append(el('span', null, text), el('span', `tag ${s.kind === 'red_flag' ? 'bad' : 'warn'}`, s.kind === 'red_flag' ? 'Alarma' : 'Molestia'));
      box.appendChild(row);
    });
  }

  /** Aviso en vivo de una molestia: se anuncia con role=status; una alarma interrumpe con role=alert. */
  function announceSymptom(msg) {
    const ex = C.get(msg.exercise_id);
    const what = `${SYMPTOM_CATEGORY[msg.category] || 'molestia'}${ex ? ` en ${ex.name}` : ''}`;
    const text = msg.symptom_kind === 'red_flag' ? `Señal de alarma${ex ? ` en ${ex.name}` : ''}. Se detuvo la sesión.`
      : `Molestia reportada: ${what}. ${msg.action === 'demand_lowered' ? 'Se bajó la exigencia.' : msg.action === 'paused' ? 'Se hizo una pausa.' : 'Quedó registrada.'}`;
    $('p-symptom-alert').textContent = msg.symptom_kind === 'red_flag' ? '' : text;      // la alarma se anuncia solo con role=alert
    const old = document.getElementById('p-symptom-urgent');
    if (old) old.remove();
    if (msg.symptom_kind === 'red_flag') {
      const urgent = el('p', 'status-line', text);
      urgent.id = 'p-symptom-urgent';
      urgent.setAttribute('role', 'alert');
      $('p-symptom-alert').after(urgent);
    }
    pushFeed(text, true);
  }

  // ------------------------------------------------------------------ nota SOAP (TD-09, I-8)
  // El borrador sale de los datos guardados de la sesión; S y O no se editan. Hasta que el fisioterapeuta la firma,
  // no es un registro clínico. Lo que dice la IA solo se muestra si la nota la redactó el LLM (source === 'llm').
  function soapStatus(text) { $('soap-status').textContent = text; }

  // Vacía y oculta la nota: así nunca queda a la vista (ni se puede firmar) el texto de otra sesión u otro paciente.
  function resetSoap() {
    state.soap = null;
    $('soap-card').hidden = true;
    ['soap-when', 'soap-source', 'soap-fhir-note'].forEach((id) => { $(id).textContent = ''; });
    $('soap-state').replaceChildren();
    $('soap-body').replaceChildren();
    $('soap-approve').hidden = true;
    $('soap-fhir').hidden = true;
    soapStatus('');
  }

  function renderSoap(r) {
    const final = r.status === 'final';
    const session = state.soap.session;
    const ex = C.get(session.exercise_id);
    $('soap-when').textContent = `${fmtDate(session.ended_at)} · ${ex ? ex.name : session.exercise_id}`;
    const stateBox = $('soap-state');
    stateBox.replaceChildren();
    if (final) {
      stateBox.append(el('span', 'tag ok', 'Firmada'), ` Firmada por ${r.reviewed_by_name || 'el fisioterapeuta'} el ${fmtDate(r.reviewed_at)}.`);
    } else {
      stateBox.append(el('span', 'tag warn', 'Borrador'), ' ', el('strong', null, 'Borrador sin firmar.'),
        ' No es un registro clínico hasta que lo firmes. S y O salen de los datos guardados de la sesión.');
    }
    if (final) $('soap-source').textContent = '';
    else if (r.source === 'llm') $('soap-source').textContent = 'La valoración y el plan los propuso la IA en la GPU AMD; las cifras se comprobaron contra los datos. Revísalos antes de firmar.';
    else $('soap-source').textContent = 'Redactado con una plantilla a partir de los datos de la sesión (sin IA).';
    const body = $('soap-body');
    body.replaceChildren();
    const readOnly = (title, text) => { body.append(el('dt', null, title), el('dd', null, text)); };
    readOnly('Subjetivo (S)', r.soap.S);
    readOnly('Objetivo (O)', r.soap.O);
    [['A', 'Valoración (A), la completas tú'], ['P', 'Plan (P)']].forEach(([key, title]) => {
      if (final) { readOnly(title.replace(', la completas tú', ''), r.soap[key]); return; }
      const label = el('label', null, title);
      label.htmlFor = `soap-edit-${key}`;
      const area = document.createElement('textarea');
      Object.assign(area, { id: `soap-edit-${key}`, maxLength: 1000, value: r.soap[key] });
      const dt = el('dt');
      dt.appendChild(label);
      const dd = el('dd');
      dd.appendChild(area);
      body.append(dt, dd);
    });
    $('soap-fhir').hidden = false;
    $('soap-fhir-note').textContent = final ? '' : 'Sale como preliminary hasta que firmes la nota.';
    $('soap-approve').hidden = final;
    $('soap-approve').disabled = false;
    $('soap-card').hidden = false;
  }

  async function openReport(session, trigger) {
    resetSoap();
    state.soap = { session, report: null };
    state.soapTrigger = trigger.dataset.session;
    trigger.disabled = true;
    try {
      const path = `/api/sessions/${session.id}/report`;
      const res = await A.call('therapist', session.report_status ? 'GET' : 'POST', path, session.report_status ? undefined : {});
      state.soap.report = res.report;
      renderSoap(res.report);
      $('soap-title').focus();
      soapStatus(res.report.status === 'final' ? 'Nota firmada: solo lectura.' : 'Borrador listo: revísalo y fírmalo.');
      if (!session.report_status) loadDetail().catch(() => {});
    } catch (err) {
      state.soap = null;                           // sin nota cargada no hay nada que firmar ni descargar
      $('soap-card').hidden = false;
      soapStatus(err.message);
    } finally { trigger.disabled = false; }
  }

  $('soap-approve').addEventListener('click', async () => {
    const btn = $('soap-approve');
    if (!state.soap) return;
    btn.disabled = true;
    soapStatus('Firmando la nota…');
    try {
      const res = await A.call('therapist', 'POST', `/api/sessions/${state.soap.session.id}/report/approve`,
        { A: $('soap-edit-A').value, P: $('soap-edit-P').value });
      state.soap.report = res.report;
      renderSoap(res.report);
      $('soap-title').focus();
      soapStatus('Nota firmada.');
      loadDetail().catch(() => {});
    } catch (err) {
      soapStatus(err.message);
      btn.disabled = false;
    }
  });

  // El token viaja en la cabecera, así que no sirve un enlace directo: se pide el JSON y se descarga como archivo.
  $('soap-fhir').addEventListener('click', async () => {
    if (!state.soap) return;
    const id = state.soap.session.id;
    try {
      const obs = await A.call('therapist', 'GET', `/api/sessions/${id}/fhir`);
      const blob = new Blob([JSON.stringify(obs, null, 2)], { type: 'application/fhir+json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `axonfas-observation-sesion-${id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      soapStatus(obs.status === 'final' ? 'Observation descargada (final).'
        : 'Observation descargada (preliminary: la nota todavía es borrador).');
    } catch (err) { soapStatus(err.message); }
  });

  $('soap-close').addEventListener('click', () => {
    const back = document.querySelector(`#p-sessions button[data-session="${state.soapTrigger}"]`);
    resetSoap();
    if (back) back.focus();
  });

  // ------------------------------------------------------------------ perfil y sugerencias (ADR-017)
  function renderProfile(d) {
    const p = d.patient.profile;
    const box = $('p-profile');
    box.innerHTML = '';
    if (!S || S.profileEmpty(p)) {
      box.appendChild(el('p', 'muted', 'Sin perfil todavía: el paciente puede completarlo en su página, o tú aquí abajo.'));
    } else {
      (p.limitations || []).forEach((id) => box.appendChild(el('span', 'tag warn', (S.LIMITS.find((x) => x.id === id) || {}).other || id)));
      (p.pain_areas || []).forEach((id) => box.appendChild(el('span', 'tag bad', `Dolor: ${(S.PAIN_AREAS.find((x) => x.id === id) || {}).label || id}`)));
      if (p.note) box.appendChild(el('span', 'tag cal', `Nota: ${p.note}`));
    }
    if (S) {
      S.renderProfileForm($('p-profile-form'), p, async (next) => {
        await A.call('therapist', 'PUT', `/api/patients/${state.selected}/profile`, next);
        await loadDetail();
      }, { who: 'therapist' });
    }
  }

  function renderSuggestions(d) {
    if (!S) return;
    state.suggestions = S.forTherapist({ profile: d.patient.profile, plan: d.plan, metrics: d.metrics, sessions: d.sessions, events: d.events,
      symptoms: d.symptoms });
    S.renderList($('p-suggest'), state.suggestions, {
      title: 'Sugerencias para ti, fisioterapeuta',
      note: 'Calculadas con reglas a partir del perfil y los datos del paciente. Son propuestas: nada cambia hasta que revisas y guardas el plan.',
      empty: 'Nada que sugerir por ahora: el plan encaja con su perfil y sus datos.',
      actionLabel: 'Revisar en el plan',
      onAction: (s) => openPlanEditor(s.action),
    });
    $('p-ai-text').textContent = 'Resumen con IA: disponible cuando la GPU AMD esté conectada. Las sugerencias de arriba salen de reglas y de los datos del paciente.';
    checkAi();
  }

  async function checkAi() {
    if (state.ai == null) {
      try { state.ai = (await A.call('therapist', 'GET', '/api/ai/status')).available; } catch { state.ai = false; }
    }
    $('p-ai-btn').hidden = !state.ai || !state.suggestions.length;
  }

  $('p-ai-btn').addEventListener('click', async () => {
    const btn = $('p-ai-btn');
    btn.disabled = true;
    $('p-ai-text').textContent = 'Pidiendo el resumen al modelo en la GPU…';
    try {
      const out = await A.call('therapist', 'POST', `/api/patients/${state.selected}/advice`, { suggestions: state.suggestions });
      $('p-ai-text').textContent = out.text
        ? `Resumen generado por IA (revísalo: no reemplaza tu criterio): ${out.text}`
        : `La IA no dio un resumen válido (${out.reason}). Usa las sugerencias de arriba.`;
    } catch (err) {
      $('p-ai-text').textContent = `Sin resumen: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------------ afiliar
  $('btn-invite').addEventListener('click', () => {
    $('invite-error').textContent = '';
    $('invite-form').reset();
    $('invite-dialog').showModal();
  });
  $('invite-close').addEventListener('click', () => $('invite-dialog').close());
  $('invite-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const year = $('invite-year').value;
      const res = await A.call('therapist', 'POST', '/api/patients', { alias: $('invite-alias').value, birth_year: year ? Number(year) : null });
      $('invite-dialog').close();
      await refreshPatients();
      selectPatient(res.patient.id);
    } catch (err) { $('invite-error').textContent = err.message; }
  });

  // ------------------------------------------------------------------ plan
  function planRow(ex, current) {
    const on = Boolean(current);
    const box = el('div', 'plan-ex');
    box.dataset.id = ex.id;
    box.dataset.on = String(on);
    const label = el('label', 'check');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = on;
    cb.addEventListener('change', () => { box.dataset.on = String(cb.checked); });
    label.append(cb, document.createTextNode(` ${ex.name}`));
    const tag = el('span', `tag ${ex.monitoring === 'auto' ? 'ok' : 'warn'}`, ex.monitoring === 'auto' ? 'Monitoreo automático' : 'Guiado');
    const head = el('div', 'row-between');
    head.append(label, tag);
    const fields = el('div', 'plan-fields');
    const v = current || { sets: ex.dose.sets, reps: ex.dose.reps, hold_seconds: ex.dose.hold, per_week: ex.dose.perWeek,
      safety_envelope: { trunk_margin: 15, valgus_margin: 10, max_reps: 10 }, notes: '' };
    const input = (name, labelText, value, min, max) => {
      const f = el('div', 'field');
      const id = `pf-${ex.id}-${name}`;
      const l = el('label', null, labelText);
      l.htmlFor = id;
      const i = document.createElement('input');
      Object.assign(i, { type: 'number', id, min, max, value });
      i.dataset.name = name;
      f.append(l, i);
      return f;
    };
    const row = el('div', 'field-row');
    row.append(input('sets', 'Series', v.sets, 1, 10), input('reps', 'Repeticiones', v.reps, 1, 50),
      input('hold_seconds', 'Sostener (s)', v.hold_seconds, 0, 120), input('per_week', 'Veces por semana', v.per_week, 1, 7));
    const rest = v.rest && !v.rest.default ? v.rest : {};
    const restRow = el('div', 'field-row');
    restRow.append(input('rest_min_seconds', 'Descanso entre series, mínimo (s)', rest.min ?? '', 10, 180),
      input('rest_max_seconds', 'Descanso entre series, máximo (s)', rest.max ?? '', 10, 180));
    fields.append(el('p', 'muted', `Referencia: ${ex.dose.text}`), row, restRow,
      el('p', 'muted', 'Recomendación para el paciente, no un límite: puede saltarlo o alargarlo. Vacío = 60 s (valor de partida, no clínico).'));
    if (ex.monitoring === 'auto') {
      const env = v.safety_envelope || {};
      const envRow = el('div', 'field-row');
      envRow.append(input('trunk_margin', 'Margen tronco (°)', env.trunk_margin ?? 15, 5, 35),
        input('valgus_margin', 'Margen valgo (°)', env.valgus_margin ?? 10, 3, 25),
        input('max_reps', 'Reps por sesión (incl. 3 de calibración)', env.max_reps ?? 10, 4, 20));
      const romRow = el('div', 'field-row');
      romRow.append(input('rom_min', 'Rango mínimo de rodilla (°), opcional', env.rom_min ?? '', 10, 140),
        input('rom_max', 'Rango máximo de rodilla (°), opcional', env.rom_max ?? '', 10, 140));
      fields.append(el('p', 'muted', 'Sobre de seguridad: márgenes sobre la línea base del paciente.'), envRow, romRow,
        el('p', 'muted', 'Límites para los ajustes del agente clínico; sin ellos, el agente no puede cambiar el rango.'));
    }
    const notes = el('div', 'field');
    const nl = el('label', null, 'Nota para el paciente (opcional)');
    nl.htmlFor = `pf-${ex.id}-notes`;
    const ni = document.createElement('input');
    Object.assign(ni, { type: 'text', id: `pf-${ex.id}-notes`, maxLength: 300, value: v.notes || '' });
    ni.dataset.name = 'notes';
    notes.append(nl, ni);
    fields.appendChild(notes);
    box.append(head, fields);
    return box;
  }

  /** Abre el editor del plan; con una sugerencia, deja el cambio hecho y marcado para que el fisioterapeuta lo revise. */
  function openPlanEditor(action) {
    const current = Object.fromEntries((state.detail ? state.detail.plan : []).map((p) => [p.exercise_id, p]));
    const list = $('plan-list');
    list.innerHTML = '';
    C.THEMES.forEach((t) => {
      list.appendChild(el('h3', 'muted', t.name));
      C.EXERCISES.filter((e) => e.theme === t.id).forEach((e) => list.appendChild(planRow(e, current[e.id])));
    });
    const marked = [];
    const box = (id) => list.querySelector(`.plan-ex[data-id="${id}"]`);
    const toggle = (id, on) => {
      const b = box(id);
      if (!b) return;
      b.querySelector('input[type="checkbox"]').checked = on;
      b.dataset.on = String(on);
      b.classList.add('suggested');
      marked.push(b);
    };
    if (action) {
      if (action.type === 'swap') { toggle(action.from, false); toggle(action.to, true); }
      if (action.type === 'remove') toggle(action.exercise_id, false);
      if (action.type === 'add') (action.exercise_ids || []).forEach((id) => toggle(id, true));
      if (action.type === 'dose') {
        const b = box(action.exercise_id);
        const input = b && b.querySelector(`[data-name="${action.field}"]`);
        if (input) { input.value = action.value; b.classList.add('suggested'); marked.push(b); }
      }
    }
    $('plan-error').textContent = marked.length ? 'Marcado en amarillo: el cambio sugerido. Revísalo y guarda solo si estás de acuerdo.' : '';
    $('plan-dialog').showModal();
    if (marked[0]) {
      marked[0].scrollIntoView({ block: 'center' });
      const focusable = marked[0].querySelector('input');
      if (focusable) focusable.focus();
    }
  }

  // Un código nuevo corta los dispositivos anteriores del paciente (TD-41): se avisa cuántos.
  $('p-reinvite').addEventListener('click', async () => {
    const status = $('p-reinvite-status');
    if (!window.confirm('Se generará un código nuevo y se cerrará la sesión del paciente en sus dispositivos. ¿Continuar?')) return;
    status.textContent = '';
    try {
      const res = await A.call('therapist', 'POST', `/api/patients/${state.selected}/invite`, {});
      await loadDetail();
      status.textContent = res.revoked_devices > 0
        ? `Se cerró la sesión en ${res.revoked_devices} dispositivo(s) del paciente: tendrá que entrar con el código nuevo. `
          + 'Hasta que se vuelva a afiliar no se registran sesiones.'
        : 'Código nuevo generado.';
    } catch (err) { status.textContent = err.message; }
  });

  $('btn-plan').addEventListener('click', () => openPlanEditor(null));
  $('plan-close').addEventListener('click', () => $('plan-dialog').close());
  $('plan-save').addEventListener('click', async () => {
    const exercises = [];
    let incompleteRange = false;
    document.querySelectorAll('#plan-list .plan-ex[data-on="true"]').forEach((box) => {
      const val = (name) => { const i = box.querySelector(`[data-name="${name}"]`); return i ? i.value : null; };
      const num = (name) => Number(val(name));
      const item = { exercise_id: box.dataset.id, sets: num('sets'), reps: num('reps'), hold_seconds: num('hold_seconds'),
        per_week: num('per_week'), notes: val('notes') || null };
      // El descanso es opcional: Number('') da 0, así que solo viaja lo que tiene valor.
      ['rest_min_seconds', 'rest_max_seconds'].forEach((name) => { const t = (val(name) || '').trim(); if (t) item[name] = Number(t); });
      if (box.querySelector('[data-name="trunk_margin"]')) {
        item.safety_envelope = { trunk_margin: num('trunk_margin'), valgus_margin: num('valgus_margin'), max_reps: num('max_reps') };
        // Number('') da 0: el rango opcional solo viaja si los dos campos tienen valor.
        const romMin = (val('rom_min') || '').trim();
        const romMax = (val('rom_max') || '').trim();
        if (romMin && romMax) Object.assign(item.safety_envelope, { rom_min: Number(romMin), rom_max: Number(romMax) });
        else if (romMin || romMax) incompleteRange = true;
      }
      exercises.push(item);
    });
    if (incompleteRange) {
      $('plan-error').textContent = 'Completa el rango mínimo y el máximo, o deja los dos vacíos.';
      return;
    }
    try {
      await A.call('therapist', 'PUT', `/api/patients/${state.selected}/plan`, { exercises });
      $('plan-dialog').close();
      await loadDetail();
    } catch (err) { $('plan-error').textContent = err.message; }
  });

  // ------------------------------------------------------------------ en vivo
  function setLiveStatus(on, text) {
    $('live-dot').className = `live-dot${on ? ' on' : ''}`;
    $('live-status').lastChild.textContent = ` ${text}`;
  }

  function startLive() {
    state.liveMap = B.render($('live-map'), { onMuscleClick: (m) => highlight({ muscle: m }) });
    drawSkeleton(null);
    $('live-angles').innerHTML = '';
    $('live-feed').innerHTML = '';
    $('live-info').textContent = 'Cuando el paciente empiece un ejercicio de su plan, aquí verás su sesión en tiempo real.';
    setLiveStatus(false, 'Sin datos');
    state.stream = A.stream('therapist', `/api/patients/${state.selected}/live`, onLive, (s) => {
      if (s === 'error') setLiveStatus(false, 'Sin conexión con el servidor');
    });
    clearInterval(state.livenessTimer);
    state.ended = false;
    state.livenessTimer = setInterval(() => {
      if (!state.ended && state.lastFrame && Date.now() - state.lastFrame > 6000) setLiveStatus(false, 'Sin datos en vivo');
    }, 2000);
  }

  function onLive(msg) {
    if (msg.kind === 'hello') { if (msg.last) onLive(msg.last); return; }
    if (msg.kind === 'profile_updated') { loadDetail().catch(() => {}); return; }
    if (msg.kind === 'symptom_reported') {
      announceSymptom(msg);
      loadDetail().catch(() => {});
      refreshPatients().catch(() => {});
      return;
    }
    if (msg.kind === 'session_saved') {
      loadDetail().catch(() => {});
      refreshPatients().catch(() => {});
      pushFeed(`Sesión guardada: ${END[msg.end_reason] || msg.end_reason}.`);
      return;
    }
    if (msg.kind !== 'frame') return;
    state.lastFrame = Date.now();
    const ex = C.get(msg.exercise_id);
    state.ended = Boolean(msg.ended);
    if (msg.ended) {
      setLiveStatus(false, `Sesión terminada · ${END[msg.ended] || msg.ended}`);
      pushFeed(`Fin de la sesión: ${END[msg.ended] || msg.ended}.`);
      return;
    }
    if (msg.event) {
      const e = msg.event;
      state.alertMuscles = B.alertMuscles(e.type);
      state.alertUntil = Date.now() + 3000;
      pushFeed(`Alerta · rep ${e.rep} · ${EVENT[e.type]}${e.side ? ` ${SIDE[e.side]}` : ''} · ${Math.round(e.value)}° > ${Math.round(e.threshold)}°`, true);
      return;
    }
    setLiveStatus(true, `En sesión · ${ex ? ex.name : 'ejercicio'}`);
    const phase = { calibrating: 'calibrando', exercising: 'con alertas', setup: 'tomando la posición inicial',
      tracking: 'seguimiento y conteo (sin alertas)', guided: 'guiado' }[msg.phase] || msg.phase;
    // Desde dónde mira la cámara y qué queda poco confiable desde ahí (ADR-015)
    const CSx = window.AxonCameraSetup;
    const cam = msg.view && CSx && ex
      ? ` · ${CSx.summary(msg.view, (msg.metric ? CSx.measuresFor(ex.id, 'track') : CSx.ENGINE).measures)}` : '';
    $('live-info').textContent = `${SOURCE[msg.source] || ''} · ${phase || ''} · repeticiones ${msg.reps_done ?? 0}`
      + `${msg.reps_total ? ` de ${msg.reps_total}` : ''}${cam}`;
    const alerts = Date.now() < state.alertUntil ? state.alertMuscles : [];
    state.liveMap.update({ intensities: B.estimateLoad(ex, msg.angles, msg.progress), alerts });
    if (msg.metric) {                                 // seguimiento de la galería (ADR-014): la medida de ese ejercicio
      const m = msg.metric;
      const unit = m.unit === '°' ? '°' : ` ${m.unit}`;
      $('live-angles').replaceChildren(kpi(m.label, `${m.unit === 'cm' ? m.value.toFixed(1) : Math.round(m.value)}${unit}`,
        msg.progress != null ? `${Math.round(msg.progress * 100)} % del recorrido pedido` : ''));
    } else if (msg.angles) {
      const a = msg.angles;
      const items = [['Rodilla', a.knee], ['Tronco', a.trunk], ['Valgo izq.', a.valgusL], ['Valgo der.', a.valgusR]];
      $('live-angles').replaceChildren(...items.map(([k, v]) => kpi(k, v == null ? '—' : `${Math.round(v)}°`, '')));
    }
    drawSkeleton(msg.points, msg.mirror);
  }

  function pushFeed(text, alert = false) {
    state.feed.unshift({ text, alert, at: new Date() });
    state.feed = state.feed.slice(0, 10);
    $('live-feed').replaceChildren(...state.feed.map((f) => el('span', f.alert ? 'tag bad' : 'muted',
      `${f.at.toLocaleTimeString('es-PE')} · ${f.text}`)));
  }

  /** Esqueleto en vivo con los huesos rotulados (puntos 2D normalizados que manda el paciente; nunca video). */
  function drawSkeleton(points, mirror) {
    const canvas = $('live-skeleton');
    const g = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    if (!points || !points['23']) {
      g.fillStyle = css.getPropertyValue('--muted');
      g.font = `16px ${css.getPropertyValue('--font-body')}`;
      g.textAlign = 'center';
      g.fillText('Esperando datos del paciente', w / 2, h / 2);
      return;
    }
    const pts = Object.fromEntries(Object.entries(points).map(([k, [x, y]]) => [k, { x: mirror ? 1 - x : x, y }]));
    const mid = (a, b) => (pts[a] && pts[b] ? { x: (pts[a].x + pts[b].x) / 2, y: (pts[a].y + pts[b].y) / 2 } : null);
    pts.hipMid = mid('23', '24');
    pts.shoulderMid = mid('11', '12');
    const xs = Object.values(pts).filter(Boolean).map((p) => p.x);
    const ys = Object.values(pts).filter(Boolean).map((p) => p.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const scale = Math.min((w * 0.7) / Math.max(maxX - minX, 0.05), (h * 0.8) / Math.max(maxY - minY, 0.05));
    const P = (p) => [w / 2 + (p.x - (minX + maxX) / 2) * scale, h / 2 + (p.y - (minY + maxY) / 2) * scale];
    g.lineCap = 'round';
    g.lineWidth = 6;
    g.font = `600 13px ${css.getPropertyValue('--font-mono')}`;
    g.textAlign = 'left';
    const labeled = new Set();
    B.BONES.forEach((bone) => {
      const a = pts[String(bone.a)];
      const b = pts[String(bone.b)];
      if (!a || !b) return;
      const [x1, y1] = P(a);
      const [x2, y2] = P(b);
      g.strokeStyle = css.getPropertyValue('--tape');
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      if (!labeled.has(bone.name)) {
        labeled.add(bone.name);
        g.fillStyle = css.getPropertyValue('--ink-secondary');
        g.fillText(bone.name, (x1 + x2) / 2 + 10, (y1 + y2) / 2);
      }
    });
    if (pts['0'] && pts.shoulderMid) {
      const [x, y] = P(pts['0']);
      g.fillStyle = css.getPropertyValue('--tape');
      g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#FFFFFF';
    ['23', '24', '25', '26', '27', '28', '11', '12'].forEach((k) => {
      if (!pts[k]) return;
      const [x, y] = P(pts[k]);
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    });
  }

  // ------------------------------------------------------------------ enseñar
  function renderTeach(plan) {
    const select = $('teach-select');
    const prev = select.value;
    select.innerHTML = '';
    const items = plan.length ? plan.map((p) => C.get(p.exercise_id)).filter(Boolean) : C.EXERCISES;
    items.forEach((ex) => {
      const o = document.createElement('option');
      o.value = ex.id;
      o.textContent = ex.name;
      select.appendChild(o);
    });
    if (items.some((ex) => ex.id === prev)) select.value = prev;
    renderTeachExercise();
  }

  function renderTeachExercise() {
    const ex = C.get($('teach-select').value);
    if (!ex) return;
    // Figura de referencia del design system con la dosis del plan de este paciente (lo que el paciente va a ver).
    if (state.teachGuide) state.teachGuide.stop();
    const item = state.detail && state.detail.plan ? state.detail.plan.find((p) => p.exercise_id === ex.id) : null;
    state.teachGuide = window.AxonGuide
      ? AxonGuide.render($('teach-guide'), ex.id, { hold: item ? item.hold_seconds : ex.dose.hold, variant: 'card', autoplay: 'visible', play: 'auto' })
      : null;
    state.teachMap = B.render($('teach-map'), { intensities: B.staticLoad(ex), onMuscleClick: (m) => highlight({ muscle: m, note: $('teach-note').value }) });
    const facts = $('teach-facts');
    facts.innerHTML = '';
    [['Músculos', B.muscleNames(ex.muscles).join(', ')], ['Huesos', ex.bones.join(', ')], ['Articulaciones', ex.joints.join(', ')]]
      .forEach(([k, v]) => {
        const line = el('span');
        line.append(el('strong', null, `${k}: `), document.createTextNode(v));
        facts.appendChild(line);
      });
  }

  async function highlight(body) {
    if (!state.selected) return;
    try {
      const res = await A.call('therapist', 'POST', `/api/patients/${state.selected}/highlight`, body);
      const what = body.muscle ? B.NAMES[body.muscle] : (C.get(body.exercise_id) || {}).name;
      $('teach-status').textContent = res.delivered_to
        ? `Enviado: ${what}.` : `Enviado: ${what}. El paciente lo verá cuando tenga abierta su página.`;
    } catch (err) { $('teach-status').textContent = err.message; }
  }

  $('teach-select').addEventListener('change', renderTeachExercise);
  $('teach-send').addEventListener('click', () => highlight({ exercise_id: $('teach-select').value, note: $('teach-note').value || undefined }));

  boot();
})();
