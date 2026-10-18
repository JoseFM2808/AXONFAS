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
  // Idioma (ADR-030): se decide al cargar la página, así que los textos fijos se leen aquí una vez.
  const I18N = window.AxonI18n;
  const { t, tn } = I18N;
  const END = { completed: t('doctor.end.completed'), pain_stop: t('doctor.end.pain_stop'), user_quit: t('doctor.end.user_quit'),
    envelope_breach: t('doctor.end.envelope_breach') };
  const SOURCE = { camera: t('doctor.source.camera'), demo: t('doctor.source.demo'), guided: t('doctor.source.guided') };
  // Texto fijo de una sesión sin cámara (TD-111) tal como lo escribe la nota SOAP (agents/soap.py, NO_CAMERA_NOTES). En
  // pantalla va 'doctor.nocam' del idioma elegido; en los dos idiomas dice lo mismo que la nota (test, TD-116).
  const NO_CAMERA_NOTE_SOAP = 'Sesión completada sin cámara. No se registraron métricas cinemáticas ni detección de fallos posturales.';
  const NO_CAMERA_NOTE = I18N.has('doctor.nocam') ? t('doctor.nocam') : NO_CAMERA_NOTE_SOAP;
  const REPORT_ACTION = { none: t('doctor.report.none'), draft: t('doctor.report.draft'), final: t('doctor.report.final') };
  const EVENT = { trunk_flexion: t('doctor.event.trunk_flexion'), knee_valgus: t('doctor.event.knee_valgus') };
  const SIDE = { left: t('doctor.side.left'), right: t('doctor.side.right') };
  const PHASE = { calibrating: t('doctor.phase.calibrating'), exercising: t('doctor.phase.exercising'), setup: t('doctor.phase.setup'),
    tracking: t('doctor.phase.tracking'), guided: t('doctor.phase.guided') };
  /** Nombre de la compensación, con el lado si lo tiene. */
  const eventText = (e) => (e.side ? t('doctor.event.withSide', { event: EVENT[e.type] || e.type, side: SIDE[e.side] || e.side }) : EVENT[e.type] || e.type);
  const state = { selected: null, detail: null, stream: null, liveMap: null, teachMap: null, teachGuide: null, lastFrame: 0, alertUntil: 0,
    alertMuscles: [], feed: [], refreshTimer: 0, livenessTimer: 0, suggestions: [], ai: null };

  const pct = (x) => (x == null ? '—' : t('doctor.pct', { n: Math.round(x * 100) }));
  const PAIN_HIGH = 7;                                       // como PAIN_HIGH de staging_api.py (ADR-025, TD-104)
  const unitText = (v, unit) => `${v}${unit === '°' ? '°' : ` ${unit}`}`;
  const signed = (n) => `${n > 0 ? '+' : ''}${n}`;
  /** Nombre de la medida de la galería en el idioma elegido (tracker.js deja el literal en español para el servidor). */
  const metricLabel = (id) => {
    const key = 'tracker.metric.' + id;
    return I18N.has(key) ? t(key) : (window.AxonTracker && AxonTracker.METRICS[id] ? AxonTracker.METRICS[id].label : id);
  };
  /** Cómo cambió el dolor al terminar: la última sesión contra la anterior. */
  function painTrend(series) {
    if (!series || series.length < 2) return t('doctor.painTrend.first');
    const d = series[series.length - 1].score - series[series.length - 2].score;
    return d === 0 ? t('doctor.painTrend.same') : t('doctor.painTrend.diff', { d: signed(d) });
  }
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(I18N.locale(), { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // ------------------------------------------------------------------ cuenta
  function show(view) {
    $('login').hidden = view !== 'login';
    $('dashboard').hidden = view !== 'dashboard';
  }

  // Invitado (TD-106): sin cuenta de fisioterapeuta, ve el consultorio de muestra con datos sintéticos, solo lectura.
  // Lo que guarda o cambia algo lo frena el servidor y abre el muro de autenticación (auth-wall.js, TD-107).
  const preview = () => !A.load('therapist') && Boolean(A.load('guest'));

  async function boot() {
    if (preview()) A.previewAs('therapist', 'guest');
    if (!A.load('therapist') && !preview()) {
      show('login');
      A.config().then((cfg) => { $('demo-login').hidden = !cfg.demo_accounts; });
      return;
    }
    try {
      await refreshPatients();
      show('dashboard');
      clearInterval(state.refreshTimer);
      state.refreshTimer = setInterval(() => refreshPatients().catch(() => {}), 15000);
    } catch (err) {
      if (err.status === 401) A.save(preview() ? 'guest' : 'therapist', null);
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

  $('btn-logout').addEventListener('click', async () => {
    await A.logout(preview() ? 'guest' : 'therapist');
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
    grid.replaceChildren();
    if (!list.length) {
      grid.appendChild(el('p', 'muted', t('doctor.patients.empty')));
      return;
    }
    list.forEach((p) => {
      const card = el('button', 'ex-card patient-card');
      card.type = 'button';
      card.setAttribute('aria-current', String(p.id === state.selected));
      const head = el('div', 'row-between');
      head.append(el('h3', null, p.alias));
      const live = el('span', `live-dot${p.live ? ' on' : ''}`);
      live.title = p.live ? t('doctor.card.live') : t('doctor.card.idle');
      head.appendChild(live);
      const m = p.metrics;
      const status = p.joined_at ? tn('doctor.card.joined', p.plan_size) : t('doctor.card.waiting', { code: p.invite_code });
      const meter = el('div', `meter${m.adherence == null ? '' : m.adherence < 0.5 ? ' bad' : m.adherence < 0.8 ? ' warn' : ''}`);
      const bar = el('span');
      bar.style.width = `${Math.round((m.adherence || 0) * 100)}%`;
      meter.appendChild(bar);
      const facts = el('div', 'facts');
      facts.append(el('span', null, t('doctor.card.adherence', { v: pct(m.adherence) })), el('span', null, t('doctor.card.quality', { v: pct(m.quality) })),
        el('span', null, t('doctor.card.last', { v: fmtDate(m.last_session_at) })));
      card.append(head, el('p', 'muted', status), meter, facts);
      if (m.discomfort_30d) card.appendChild(el('span', 'tag warn', tn('doctor.card.discomfort', m.discomfort_30d)));
      if (!p.consent_given) card.appendChild(el('span', 'tag warn', t('doctor.card.noConsent')));
      if (m.pain_stops_30d) card.appendChild(el('span', 'tag bad', tn('doctor.card.painStops', m.pain_stops_30d)));
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
    box.replaceChildren();
    box.appendChild(el('h2', null, t('doctor.invite.codeTitle')));
    const grid = el('div', 'invite');
    const qr = el('div', 'share-qr');
    qr.innerHTML = A.qrSvg(url);                     // SVG generado del enlace: sin texto traducido
    const info = el('div', 'stack');
    info.append(el('div', 'code-big', p.invite_code), el('p', 'muted', t('doctor.invite.how')));
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
    if (last.peak != null) {
      parts.push(x.camera_sessions > 1 && first.peak != null ? t('doctor.cam.peakFirst', { v: v(last.peak), first: v(first.peak) })
        : t('doctor.cam.peak', { v: v(last.peak) }));
    }
    const holds = item.hold_seconds > 0 || (spec && spec.mode !== 'reps');      // sin sostén en la dosis, no se muestra
    if (last.hold != null && holds) parts.push(t('doctor.cam.hold', { s: last.hold }));
    if (last.over_limit) parts.push(t('doctor.cam.over', { n: last.over_limit }));   // pasó la meta máxima del plan (ADR-025)
    return parts.length ? parts.join(' · ') : '—';
  }

  function renderDetail(d) {
    const p = d.patient;
    $('p-title').textContent = p.alias + (p.birth_year ? ` · ${p.birth_year}` : '');
    $('p-status').textContent = p.joined_at ? t('doctor.status.joined', { date: fmtDate(p.joined_at) }) : t('doctor.status.waiting');
    renderInvite(p);
    const m = d.metrics;
    const trend = m.quality_trend == null ? t('doctor.trend.needMore') : t('doctor.trend.points', { n: signed(Math.round(m.quality_trend * 100)) });
    $('p-kpis').replaceChildren(
      kpi(t('doctor.kpi.adherence'), pct(m.adherence), t('doctor.kpi.adherenceSub')),
      kpi(t('doctor.kpi.quality'), pct(m.quality), t('doctor.kpi.qualitySub')),
      kpi(t('doctor.kpi.trend'), m.quality_trend == null ? '—' : trend, t('doctor.kpi.trendSub')),
      kpi(t('doctor.kpi.rom'), m.rom_last == null ? '—' : `${m.rom_last}°`, m.rom_first == null ? t('doctor.kpi.romNone') : t('doctor.kpi.romFirst', { v: m.rom_first })),
      kpi(t('doctor.kpi.painStops'), String(m.pain_stops_30d), t('doctor.kpi.in30')),
      kpi(t('doctor.kpi.discomfort'), String(m.discomfort_30d ?? 0), m.red_flags_30d ? t('doctor.kpi.redFlags', { n: m.red_flags_30d }) : t('doctor.kpi.byPatient')),
      kpi(t('doctor.kpi.pain'), m.pain_last ? `${m.pain_last.score}/10` : '—', !m.pain_last ? t('doctor.kpi.painNone')
        : m.pain_high_30d ? tn('doctor.kpi.painHigh', m.pain_high_30d, { high: PAIN_HIGH }) : t('doctor.kpi.painLast', { trend: painTrend(m.pain_series) })),
      kpi(t('doctor.kpi.sessions'), String(m.sessions_total), t('doctor.kpi.sessionsSub', { date: fmtDate(m.last_session_at) })));

    const perEx = Object.fromEntries(m.per_exercise.map((x) => [x.exercise_id, x]));
    const body = $('p-plan');
    body.replaceChildren();
    if (!d.plan.length) {
      const tr = el('tr');
      const td = el('td', 'empty', t('doctor.plan.empty'));
      td.colSpan = 6;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    d.plan.forEach((item) => {
      const ex = C.get(item.exercise_id);
      const tr = el('tr');
      const env = item.safety_envelope;
      const dose = `${item.sets} × ${item.reps}${item.hold_seconds ? ` · ${item.hold_seconds} s` : ''}`;
      const week = t('doctor.plan.week', { done: perEx[item.exercise_id] ? perEx[item.exercise_id].done_7d : 0, per: item.per_week });
      const romText = env && env.rom_min != null && env.rom_max != null ? ` · ${t('doctor.env.rom', { min: env.rom_min, max: env.rom_max })}` : '';
      const goal = item.range_goal;
      const envText = env && env.trunk_margin
        ? t('doctor.env.margins', { trunk: env.trunk_margin, valgus: env.valgus_margin, reps: env.max_reps }) + romText
        : goal ? t('doctor.env.goal', { target: unitText(goal.target, goal.unit), limit: unitText(goal.limit, goal.unit) })
          : t('doctor.env.none');
      const r = item.rest;
      const restText = !r || r.default ? t('doctor.rest.default', { s: r ? r.min : 60 }) : r.min === r.max ? `${r.min} s` : `${r.min}–${r.max} s`;
      [ex ? ex.name : item.exercise_id, dose, week, cameraText(perEx[item.exercise_id], item), envText, restText]
        .forEach((text) => tr.appendChild(el('td', null, text)));
      body.appendChild(tr);
    });

    const eventsBySession = {};
    d.events.forEach((e) => { eventsBySession[e.session_id] = (eventsBySession[e.session_id] || 0) + 1; });
    const sBody = $('p-sessions');
    sBody.replaceChildren();
    if (!d.sessions.length) {
      const tr = el('tr');
      const td = el('td', 'empty', t('doctor.sessions.empty'));
      td.colSpan = 8;
      tr.appendChild(td);
      sBody.appendChild(tr);
    }
    d.sessions.forEach((s) => {
      const ex = C.get(s.exercise_id);
      const tr = el('tr');
      [fmtDate(s.ended_at), ex ? ex.name : s.exercise_id].forEach((text) => tr.appendChild(el('td', null, text)));
      const how = el('td');
      if (s.no_camera) {                                     // sin cámara: sin métricas ni detección postural (TD-111)
        const tag = el('span', 'tag warn', t('doctor.source.noCamera'));
        tag.title = NO_CAMERA_NOTE;
        how.append(tag);
      } else how.textContent = s.mode === 'guided' && s.source === 'camera' ? t('doctor.source.cameraCount') : SOURCE[s.source] || s.source;
      tr.append(how, el('td', null, String(s.reps_done)));
      const end = el('td');
      end.appendChild(el('span', `tag ${s.end_reason === 'completed' ? 'ok' : s.end_reason === 'pain_stop' ? 'bad' : 'warn'}`, END[s.end_reason] || s.end_reason));
      tr.appendChild(end);
      tr.appendChild(el('td', 'num', String(eventsBySession[s.id] || 0)));
      const eva = el('td', 'num');                            // dolor al terminar que marcó el paciente (ADR-025)
      if (s.pain_score == null) eva.textContent = '—';
      else eva.appendChild(el('span', s.pain_score >= PAIN_HIGH ? 'tag bad' : 'tag ok', `${s.pain_score}/10`));
      tr.appendChild(eva);
      const note = el('td');
      const label = REPORT_ACTION[s.report_status || 'none'];
      const btn = el('button', 'btn', label);
      btn.type = 'button';
      btn.dataset.session = String(s.id);
      btn.setAttribute('aria-label', t('doctor.report.aria', { action: label, date: fmtDate(s.ended_at), exercise: ex ? ex.name : s.exercise_id }));
      btn.addEventListener('click', () => openReport(s, btn));
      note.appendChild(btn);
      tr.appendChild(note);
      sBody.appendChild(tr);
    });

    const evBox = $('p-events');
    evBox.replaceChildren();
    if (!d.events.length) evBox.appendChild(el('p', 'muted', t('doctor.events.empty')));
    d.events.slice(0, 12).forEach((e) => {
      evBox.appendChild(el('div', null, t('doctor.events.row', { rep: e.rep, event: eventText(e), peak: e.peak, threshold: e.threshold,
        severity: e.severity }) + (e.alert_latency_ms != null ? ` · ${e.alert_latency_ms} ms` : '')));
    });
    renderSymptoms(d);
    renderTeach(d.plan);
    renderProfile(d);
    renderSuggestions(d);
  }

  // ------------------------------------------------------------------ molestias del paciente (ADR-021)
  // Categorías compartidas con suggestions.js (mismo diccionario).
  const SYMPTOM_CATEGORY = { pain: t('suggest.symptom.pain'), cramp: t('suggest.symptom.cramp'), fatigue: t('suggest.symptom.fatigue'),
    stiffness: t('suggest.symptom.stiffness'), other: t('suggest.symptom.other'), red_flag: t('suggest.symptom.red_flag') };
  const PARAM_NAME = { rom_target: t('doctor.param.rom_target'), reps: t('doctor.param.reps'), rest_seconds: t('doctor.param.rest_seconds') };
  const PARAM_UNIT = { rom_target: '°', reps: '', rest_seconds: ' s' };
  const SYMPTOM_ACTION = { session_stopped: t('doctor.symptom.action.session_stopped'), paused: t('doctor.symptom.action.paused'),
    logged: t('doctor.symptom.action.logged'), demand_lowered: t('doctor.symptom.action.demand_lowered') };
  function symptomAction(s) {
    if (s.action === 'demand_lowered' && s.adjustment) {
      const a = s.adjustment;
      return t('doctor.symptom.lowered', { param: PARAM_NAME[a.param] || a.param, old: `${a.old}${PARAM_UNIT[a.param] || ''}`,
        new: `${a.new}${PARAM_UNIT[a.param] || ''}` });
    }
    return SYMPTOM_ACTION[s.action] || s.action;
  }

  function renderSymptoms(d) {
    const box = $('p-symptoms');
    box.replaceChildren();
    const list = d.symptoms || [];
    if (!list.length) box.appendChild(el('p', 'muted', t('doctor.symptom.empty')));
    list.slice(0, 12).forEach((s) => {
      const ex = C.get(s.exercise_id);
      const row = el('div', 'row-between');
      // s.text lo escribió el paciente: se muestra tal cual, entre comillas.
      const text = `${fmtDate(s.reported_at)} · ${ex ? ex.name : t('doctor.symptom.noExercise')} · ${SYMPTOM_CATEGORY[s.category] || s.category}`
        + `${s.text ? ` · «${s.text}»` : ''} · ${symptomAction(s)}`;
      row.append(el('span', null, text), el('span', `tag ${s.kind === 'red_flag' ? 'bad' : 'warn'}`,
        s.kind === 'red_flag' ? t('doctor.symptom.tagAlarm') : t('doctor.symptom.tagDiscomfort')));
      box.appendChild(row);
    });
  }

  /** Aviso en vivo de una molestia: se anuncia con role=status; una alarma interrumpe con role=alert. */
  function announceSymptom(msg) {
    const ex = C.get(msg.exercise_id);
    const category = SYMPTOM_CATEGORY[msg.category] || t('doctor.symptom.generic');
    const what = ex ? t('doctor.symptom.inExercise', { category, exercise: ex.name }) : category;
    const next = msg.action === 'demand_lowered' ? t('doctor.symptom.next.lowered') : msg.action === 'paused' ? t('doctor.symptom.next.paused')
      : t('doctor.symptom.next.logged');
    const text = msg.symptom_kind === 'red_flag' ? (ex ? t('doctor.symptom.alarmIn', { exercise: ex.name }) : t('doctor.symptom.alarm'))
      : t('doctor.symptom.reported', { what, next });
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
    ['soap-when', 'soap-source', 'soap-fhir-note', 'soap-nocam'].forEach((id) => { $(id).textContent = ''; });
    $('soap-nocam').hidden = true;
    $('soap-state').replaceChildren();
    $('soap-body').replaceChildren();
    $('soap-approve').hidden = true;
    $('soap-fhir').hidden = true;
    $('soap-fhir-doc').hidden = true;
    soapStatus('');
  }

  function renderSoap(r) {
    const final = r.status === 'final';
    const session = state.soap.session;
    const nocam = $('soap-nocam');                         // aviso destacado de sesión sin cámara (TD-111)
    nocam.hidden = !session.no_camera;
    nocam.textContent = session.no_camera ? NO_CAMERA_NOTE : '';
    const ex = C.get(session.exercise_id);
    $('soap-when').textContent = `${fmtDate(session.ended_at)} · ${ex ? ex.name : session.exercise_id}`;
    const stateBox = $('soap-state');
    stateBox.replaceChildren();
    if (final) {
      stateBox.append(el('span', 'tag ok', t('doctor.soap.signed')), ' ',
        t('doctor.soap.signedBy', { name: r.reviewed_by_name || t('doctor.soap.theTherapist'), date: fmtDate(r.reviewed_at) }));
    } else {
      stateBox.append(el('span', 'tag warn', t('doctor.soap.draft')), ' ', el('strong', null, t('doctor.soap.unsigned')),
        ' ', t('doctor.soap.notRecord'));
    }
    // El texto de la nota (S, O, A, P) lo redacta el servidor en el idioma de la interfaz (TD-116). Lo firmado y lo que
    // redactó la IA quedan en el idioma en que se escribieron: `r.lang` lo dice y aquí se avisa si no es el de la página.
    const noteLang = r.lang || 'es';
    const source = final ? '' : (r.source === 'llm' ? t('doctor.soap.byAi') : t('doctor.soap.byTemplate'));
    const other = noteLang !== I18N.lang ? t('doctor.soap.writtenIn', { language: t(`doctor.soap.lang.${noteLang === 'en' ? 'en' : 'es'}`) }) : '';
    $('soap-source').textContent = [source, other].filter(Boolean).join(' ');
    const body = $('soap-body');
    body.replaceChildren();
    // lang de la nota: el lector de pantalla la lee con la voz de su idioma aunque la interfaz esté en otro (WCAG 3.1.2).
    const readOnly = (title, text) => { const dd = el('dd', null, text); dd.lang = noteLang; body.append(el('dt', null, title), dd); };
    readOnly(t('doctor.soap.S'), r.soap.S);
    readOnly(t('doctor.soap.O'), r.soap.O);
    [['A', t('doctor.soap.Aedit'), t('doctor.soap.A')], ['P', t('doctor.soap.P'), t('doctor.soap.P')]].forEach(([key, title, finalTitle]) => {
      if (final) { readOnly(finalTitle, r.soap[key]); return; }
      const label = el('label', null, title);
      label.htmlFor = `soap-edit-${key}`;
      const area = document.createElement('textarea');
      Object.assign(area, { id: `soap-edit-${key}`, maxLength: 1000, value: r.soap[key], lang: noteLang });
      const dt = el('dt');
      dt.appendChild(label);
      const dd = el('dd');
      dd.appendChild(area);
      body.append(dt, dd);
    });
    $('soap-fhir').hidden = false;
    $('soap-fhir-doc').hidden = false;
    $('soap-fhir-note').textContent = final ? '' : t('doctor.soap.preliminary');
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
      soapStatus(res.report.status === 'final' ? t('doctor.soap.readOnly') : t('doctor.soap.ready'));
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
    soapStatus(t('doctor.soap.signing'));
    try {
      const res = await A.call('therapist', 'POST', `/api/sessions/${state.soap.session.id}/report/approve`,
        { A: $('soap-edit-A').value, P: $('soap-edit-P').value });
      state.soap.report = res.report;
      renderSoap(res.report);
      $('soap-title').focus();
      soapStatus(t('doctor.soap.done'));
      loadDetail().catch(() => {});
    } catch (err) {
      soapStatus(err.message);
      btn.disabled = false;
    }
  });

  // El token viaja en la cabecera, así que no sirve un enlace directo: se pide el JSON y se descarga como archivo.
  function downloadJson(data, name) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/fhir+json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  $('soap-fhir').addEventListener('click', async () => {
    if (!state.soap) return;
    const id = state.soap.session.id;
    try {
      const obs = await A.call('therapist', 'GET', `/api/sessions/${id}/fhir`);
      downloadJson(obs, `axonfas-observation-sesion-${id}.json`);
      soapStatus(obs.status === 'final' ? t('doctor.soap.obsFinal') : t('doctor.soap.obsPrelim'));
    } catch (err) { soapStatus(err.message); }
  });

  // La nota SOAP como Bundle FHIR de tipo documento, para una historia clínica (TD-103). No se envía a ninguna parte.
  $('soap-fhir-doc').addEventListener('click', async () => {
    if (!state.soap) return;
    const id = state.soap.session.id;
    try {
      const doc = await A.call('therapist', 'GET', `/api/sessions/${id}/fhir/document`);
      downloadJson(doc, `axonfas-nota-soap-sesion-${id}.json`);
      const comp = doc.entry && doc.entry[0] && doc.entry[0].resource;
      soapStatus(comp && comp.status === 'final' ? t('doctor.soap.docFinal') : t('doctor.soap.docPrelim'));
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
    box.replaceChildren();
    if (!S || S.profileEmpty(p)) {
      box.appendChild(el('p', 'muted', t('doctor.profile.empty')));
    } else {
      (p.limitations || []).forEach((id) => box.appendChild(el('span', 'tag warn', (S.LIMITS.find((x) => x.id === id) || {}).other || id)));
      (p.pain_areas || []).forEach((id) => box.appendChild(el('span', 'tag bad',
        t('doctor.profile.pain', { area: (S.PAIN_AREAS.find((x) => x.id === id) || {}).label || id }))));
      if (p.note) box.appendChild(el('span', 'tag cal', t('doctor.profile.note', { note: p.note })));
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
      title: t('doctor.suggest.title'),
      note: t('doctor.suggest.note'),
      empty: t('doctor.suggest.empty'),
      actionLabel: t('doctor.suggest.action'),
      onAction: (s) => openPlanEditor(s.action),
    });
    checkAi();
  }

  async function checkAi() {
    if (state.ai == null) {
      try {
        const st = await A.call('therapist', 'GET', '/api/ai/status');
        state.ai = st.available;
        state.aiOwn = /vllm/i.test(st.provider || '');
      } catch { state.ai = false; }
    }
    // El texto dice lo que pasa de verdad: sin IA configurada no se ofrece; con IA, nombra al proveedor que resume.
    const ready = state.ai && state.suggestions.length;
    $('p-ai-text').textContent = t(!state.ai ? 'doctor.ai.off' : !ready ? 'doctor.ai.nothing' : state.aiOwn ? 'doctor.ai.idleOwn' : 'doctor.ai.idle');
    $('p-ai-btn').hidden = !ready;
  }

  $('p-ai-btn').addEventListener('click', async () => {
    const btn = $('p-ai-btn');
    btn.disabled = true;
    $('p-ai-text').textContent = t('doctor.ai.asking');
    try {
      // Las sugerencias viajan en el idioma de la pantalla; el resumen y el motivo de rechazo los escribe el servidor (en español).
      const out = await A.call('therapist', 'POST', `/api/patients/${state.selected}/advice`, { suggestions: state.suggestions });
      $('p-ai-text').textContent = out.text ? t('doctor.ai.result', { text: out.text }) : t('doctor.ai.invalid', { reason: out.reason });
    } catch (err) {
      $('p-ai-text').textContent = t('doctor.ai.error', { error: err.message });
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
    const tag = el('span', `tag ${ex.monitoring === 'auto' ? 'ok' : 'warn'}`, ex.monitoring === 'auto' ? t('doctor.plan.auto') : SOURCE.guided);
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
    row.append(input('sets', t('doctor.plan.sets'), v.sets, 1, 10), input('reps', t('doctor.plan.reps'), v.reps, 1, 50),
      input('hold_seconds', t('doctor.plan.hold'), v.hold_seconds, 0, 120), input('per_week', t('doctor.plan.perWeek'), v.per_week, 1, 7));
    const rest = v.rest && !v.rest.default ? v.rest : {};
    const restRow = el('div', 'field-row');
    restRow.append(input('rest_min_seconds', t('doctor.plan.restMin'), rest.min ?? '', 10, 180),
      input('rest_max_seconds', t('doctor.plan.restMax'), rest.max ?? '', 10, 180));
    fields.append(el('p', 'muted', t('doctor.plan.reference', { text: ex.dose.text })), row, restRow,
      el('p', 'muted', t('doctor.plan.restHint')));
    const spec = window.AxonTracker && AxonTracker.SPECS[ex.id];
    if (ex.monitoring !== 'auto' && spec && spec.mode !== 'manual') {
      // Meta de recorrido por paciente (ADR-025): reemplaza la de la galería en el seguimiento con cámara.
      const unit = AxonTracker.METRICS[spec.metric].unit;
      const gallery = spec.mode === 'reps' ? spec.delta : spec.threshold;
      const goal = v.range_goal || {};
      const what = spec.mode === 'reps' ? t('doctor.goal.reps') : spec.dir < 0 ? t('doctor.goal.holdLess') : t('doctor.goal.holdMore');
      const goalRow = el('div', 'field-row');
      const step = unit === 'cm' ? 0.5 : 1;
      const gi = input('goal_target', t('doctor.goal.target', { what, unit }), goal.target ?? '', unit === 'cm' ? 0.5 : 1, unit === '%' ? 200 : unit === 'cm' ? 50 : 180);
      const gl = input('goal_limit', t('doctor.goal.limit', { unit }), goal.limit ?? '', unit === 'cm' ? 0.5 : 1, unit === '%' ? 200 : unit === 'cm' ? 50 : 180);
      [gi, gl].forEach((f) => { f.querySelector('input').step = String(step); });
      goalRow.append(gi, gl);
      // El límite no es una alerta (I-12): la cámara solo avisa y marca la repetición.
      const hint = spec.mode === 'hold' && spec.dir < 0 ? 'doctor.goal.hintLower' : 'doctor.goal.hint';
      fields.append(goalRow, el('p', 'muted', t(hint, { metric: metricLabel(spec.metric), gallery: unitText(gallery, unit) })));
    }
    if (ex.monitoring === 'auto') {
      const env = v.safety_envelope || {};
      const envRow = el('div', 'field-row');
      envRow.append(input('trunk_margin', t('doctor.env.trunk'), env.trunk_margin ?? 15, 5, 35),
        input('valgus_margin', t('doctor.env.valgus'), env.valgus_margin ?? 10, 3, 25),
        input('max_reps', t('doctor.env.maxReps'), env.max_reps ?? 10, 4, 20));
      const romRow = el('div', 'field-row');
      romRow.append(input('rom_min', t('doctor.env.romMin'), env.rom_min ?? '', 10, 140),
        input('rom_max', t('doctor.env.romMax'), env.rom_max ?? '', 10, 140));
      fields.append(el('p', 'muted', t('doctor.env.intro')), envRow, romRow, el('p', 'muted', t('doctor.env.agent')));
    }
    const notes = el('div', 'field');
    const nl = el('label', null, t('doctor.plan.patientNote'));
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
    list.replaceChildren();
    C.THEMES.forEach((theme) => {
      list.appendChild(el('h3', 'muted', theme.name));
      C.EXERCISES.filter((e) => e.theme === theme.id).forEach((e) => list.appendChild(planRow(e, current[e.id])));
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
    $('plan-error').textContent = marked.length ? t('doctor.plan.suggested') : '';
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
    if (!window.confirm(t('doctor.reinvite.confirm'))) return;
    status.textContent = '';
    try {
      const res = await A.call('therapist', 'POST', `/api/patients/${state.selected}/invite`, {});
      await loadDetail();
      status.textContent = res.revoked_devices > 0 ? tn('doctor.reinvite.revoked', res.revoked_devices) : t('doctor.reinvite.done');
    } catch (err) { status.textContent = err.message; }
  });

  $('btn-plan').addEventListener('click', () => openPlanEditor(null));
  $('plan-close').addEventListener('click', () => $('plan-dialog').close());
  $('plan-save').addEventListener('click', async () => {
    const exercises = [];
    let incompleteRange = false;
    let incompleteGoal = false;
    document.querySelectorAll('#plan-list .plan-ex[data-on="true"]').forEach((box) => {
      const val = (name) => { const i = box.querySelector(`[data-name="${name}"]`); return i ? i.value : null; };
      const num = (name) => Number(val(name));
      const item = { exercise_id: box.dataset.id, sets: num('sets'), reps: num('reps'), hold_seconds: num('hold_seconds'),
        per_week: num('per_week'), notes: val('notes') || null };
      // El descanso es opcional: Number('') da 0, así que solo viaja lo que tiene valor.
      ['rest_min_seconds', 'rest_max_seconds'].forEach((name) => { const raw = (val(name) || '').trim(); if (raw) item[name] = Number(raw); });
      const goalTarget = (val('goal_target') || '').trim();
      const goalLimit = (val('goal_limit') || '').trim();
      if (goalTarget && goalLimit) item.range_goal = { target: Number(goalTarget), limit: Number(goalLimit) };
      else if (goalTarget || goalLimit) incompleteGoal = true;
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
      $('plan-error').textContent = t('doctor.plan.incompleteRange');
      return;
    }
    if (incompleteGoal) {
      $('plan-error').textContent = t('doctor.plan.incompleteGoal');
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
    $('live-angles').replaceChildren();
    $('live-feed').replaceChildren();
    $('live-info').textContent = t('doctor.live.waiting');
    setLiveStatus(false, t('doctor.live.none'));
    state.stream = A.stream('therapist', `/api/patients/${state.selected}/live`, onLive, (s) => {
      if (s === 'error') setLiveStatus(false, t('doctor.live.offline'));
    });
    clearInterval(state.livenessTimer);
    state.ended = false;
    state.livenessTimer = setInterval(() => {
      if (!state.ended && state.lastFrame && Date.now() - state.lastFrame > 6000) setLiveStatus(false, t('doctor.live.stale'));
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
    if (msg.kind === 'pain_scored') {
      const ex = C.get(msg.exercise_id);
      const high = msg.high ? t('doctor.live.high') : '';
      const text = ex ? t('doctor.live.painEx', { exercise: ex.name, score: msg.score, high }) : t('doctor.live.pain', { score: msg.score, high });
      $('p-symptom-alert').textContent = text;
      pushFeed(text, Boolean(msg.high));
      loadDetail().catch(() => {});
      refreshPatients().catch(() => {});
      return;
    }
    if (msg.kind === 'session_saved') {
      loadDetail().catch(() => {});
      refreshPatients().catch(() => {});
      pushFeed(t('doctor.live.saved', { end: END[msg.end_reason] || msg.end_reason }));
      return;
    }
    if (msg.kind !== 'frame') return;
    state.lastFrame = Date.now();
    const ex = C.get(msg.exercise_id);
    state.ended = Boolean(msg.ended);
    if (msg.ended) {
      setLiveStatus(false, t('doctor.live.ended', { end: END[msg.ended] || msg.ended }));
      pushFeed(t('doctor.live.endFeed', { end: END[msg.ended] || msg.ended }));
      return;
    }
    if (msg.event) {
      const e = msg.event;
      state.alertMuscles = B.alertMuscles(e.type);
      state.alertUntil = Date.now() + 3000;
      pushFeed(t('doctor.live.alert', { rep: e.rep, event: eventText(e), value: Math.round(e.value), threshold: Math.round(e.threshold) }), true);
      return;
    }
    setLiveStatus(true, t('doctor.live.inSession', { exercise: ex ? ex.name : t('doctor.live.exercise') }));
    const phase = PHASE[msg.phase] || msg.phase;
    // Desde dónde mira la cámara y qué queda poco confiable desde ahí (ADR-015)
    const CSx = window.AxonCameraSetup;
    const cam = msg.view && CSx && ex
      ? ` · ${CSx.summary(msg.view, (msg.metric ? CSx.measuresFor(ex.id, 'track') : CSx.ENGINE).measures)}` : '';
    const info = { source: SOURCE[msg.source] || '', phase: phase || '', reps: msg.reps_done ?? 0, total: msg.reps_total, cam };
    $('live-info').textContent = msg.reps_total ? t('doctor.live.infoTotal', info) : t('doctor.live.info', info);
    const alerts = Date.now() < state.alertUntil ? state.alertMuscles : [];
    state.liveMap.update({ intensities: B.estimateLoad(ex, msg.angles, msg.progress), alerts });
    if (msg.metric) {                                 // seguimiento de la galería (ADR-014): la medida de ese ejercicio
      const m = msg.metric;
      const unit = m.unit === '°' ? '°' : ` ${m.unit}`;
      // El rótulo llega en el idioma del paciente: si se conoce la medida del ejercicio, se nombra en el idioma de este panel.
      const spec = window.AxonTracker && AxonTracker.SPECS[msg.exercise_id];
      $('live-angles').replaceChildren(kpi(spec ? metricLabel(spec.metric) : m.label, `${m.unit === 'cm' ? m.value.toFixed(1) : Math.round(m.value)}${unit}`,
        msg.progress != null ? t('doctor.live.progress', { n: Math.round(msg.progress * 100) }) : ''));
    } else if (msg.angles) {
      const a = msg.angles;
      const items = [[t('doctor.angle.knee'), a.knee], [t('doctor.angle.trunk'), a.trunk], [t('doctor.angle.valgusL'), a.valgusL],
        [t('doctor.angle.valgusR'), a.valgusR]];
      $('live-angles').replaceChildren(...items.map(([k, v]) => kpi(k, v == null ? '—' : `${Math.round(v)}°`, '')));
    }
    drawSkeleton(msg.points, msg.mirror);
  }

  function pushFeed(text, alert = false) {
    state.feed.unshift({ text, alert, at: new Date() });
    state.feed = state.feed.slice(0, 10);
    $('live-feed').replaceChildren(...state.feed.map((f) => el('span', f.alert ? 'tag bad' : 'muted',
      `${f.at.toLocaleTimeString(I18N.locale())} · ${f.text}`)));
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
      g.fillText(t('doctor.live.canvasWaiting'), w / 2, h / 2);
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
    select.replaceChildren();
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
    facts.replaceChildren();
    [[t('doctor.teach.muscles'), B.muscleNames(ex.muscles).join(', ')], [t('doctor.teach.bones'), ex.bones.join(', ')],
      [t('doctor.teach.joints'), ex.joints.join(', ')]]
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
      $('teach-status').textContent = res.delivered_to ? t('doctor.teach.sent', { what }) : t('doctor.teach.sentLater', { what });
    } catch (err) { $('teach-status').textContent = err.message; }
  }

  $('teach-select').addEventListener('change', renderTeachExercise);
  $('teach-send').addEventListener('click', () => highlight({ exercise_id: $('teach-select').value, note: $('teach-note').value || undefined }));

  boot();
})();
