/* AXONFAS · panel del fisioterapeuta (ADR-012, ADR-013).
 * Cuenta de demostración, afiliación con código y QR, plan desde el catálogo con sobre de seguridad, indicadores de
 * cumplimiento y efectividad, vista en vivo (mapa muscular estimado, esqueleto rotulado, ángulos, alertas) y enseñanza.
 */
(() => {
  'use strict';
  const C = window.AxonCatalog;
  const B = window.AxonBodyMap;
  const A = window.AxonApi;
  const $ = (id) => document.getElementById(id);
  const END = { completed: 'Completada', pain_stop: 'Detenida por dolor', user_quit: 'Terminada a mano', envelope_breach: 'Fuera del sobre' };
  const SOURCE = { camera: 'Cámara', demo: 'Demo sintético', guided: 'Guiado' };
  const EVENT = { trunk_flexion: 'Flexión de tronco', knee_valgus: 'Valgo de rodilla' };
  const SIDE = { left: 'izquierda', right: 'derecha' };
  const state = { selected: null, detail: null, stream: null, liveMap: null, teachMap: null, lastFrame: 0, alertUntil: 0,
    alertMuscles: [], feed: [], refreshTimer: 0, livenessTimer: 0 };

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
      if (m.pain_stops_30d) card.appendChild(el('span', 'tag bad', `${m.pain_stops_30d} detención(es) por dolor en 30 días`));
      card.addEventListener('click', () => selectPatient(p.id));
      grid.appendChild(card);
    });
  }

  async function selectPatient(id) {
    if (state.stream) { state.stream.stop(); state.stream = null; }
    state.selected = id;
    state.feed = [];
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

  function renderDetail(d) {
    const p = d.patient;
    $('p-title').textContent = p.alias + (p.birth_year ? ` · ${p.birth_year}` : '');
    $('p-status').textContent = p.joined_at ? `Afiliado el ${fmtDate(p.joined_at)} · consentimiento aceptado` : 'Esperando afiliación';
    renderInvite(p);
    const m = d.metrics;
    const trend = m.quality_trend == null ? 'con 4 sesiones o más' : `${m.quality_trend >= 0 ? '+' : ''}${Math.round(m.quality_trend * 100)} puntos`;
    $('p-kpis').replaceChildren(
      kpi('Cumplimiento 7 días', pct(m.adherence), 'sesiones completadas / indicadas'),
      kpi('Calidad', pct(m.quality), 'reps sin compensación (última)'),
      kpi('Tendencia calidad', m.quality_trend == null ? '—' : trend, 'últimas 3 vs primeras 3'),
      kpi('Rodilla (ROM)', m.rom_last == null ? '—' : `${m.rom_last}°`, m.rom_first == null ? 'sin sesiones monitoreadas' : `primera sesión: ${m.rom_first}°`),
      kpi('Detenciones por dolor', String(m.pain_stops_30d), 'en 30 días'),
      kpi('Sesiones', String(m.sessions_total), `última: ${fmtDate(m.last_session_at)}`));

    const perEx = Object.fromEntries(m.per_exercise.map((x) => [x.exercise_id, x]));
    const body = $('p-plan');
    body.innerHTML = '';
    if (!d.plan.length) {
      const tr = el('tr');
      const td = el('td', 'empty', 'Sin ejercicios. Usa "Editar plan".');
      td.colSpan = 4;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    d.plan.forEach((item) => {
      const ex = C.get(item.exercise_id);
      const tr = el('tr');
      const env = item.safety_envelope;
      const dose = `${item.sets} × ${item.reps}${item.hold_seconds ? ` · ${item.hold_seconds} s` : ''}`;
      const week = perEx[item.exercise_id] ? `${perEx[item.exercise_id].done_7d} de ${item.per_week}` : `0 de ${item.per_week}`;
      const envText = env && env.trunk_margin ? `tronco +${env.trunk_margin}° · valgo +${env.valgus_margin}° · ${env.max_reps} reps`
        : 'sin alertas: conteo con cámara o guiado';
      [ex ? ex.name : item.exercise_id, dose, week, envText].forEach((t) => tr.appendChild(el('td', null, t)));
      body.appendChild(tr);
    });

    const eventsBySession = {};
    d.events.forEach((e) => { eventsBySession[e.session_id] = (eventsBySession[e.session_id] || 0) + 1; });
    const sBody = $('p-sessions');
    sBody.innerHTML = '';
    if (!d.sessions.length) {
      const tr = el('tr');
      const td = el('td', 'empty', 'Todavía no hay sesiones.');
      td.colSpan = 6;
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
      sBody.appendChild(tr);
    });

    const evBox = $('p-events');
    evBox.innerHTML = '';
    if (!d.events.length) evBox.appendChild(el('p', 'muted', 'Sin compensaciones registradas.'));
    d.events.slice(0, 12).forEach((e) => {
      evBox.appendChild(el('div', null, `Rep ${e.rep} · ${EVENT[e.type]}${e.side ? ` ${SIDE[e.side]}` : ''} · pico ${e.peak}° `
        + `(umbral ${e.threshold}°) · severidad ${e.severity}${e.alert_latency_ms != null ? ` · ${e.alert_latency_ms} ms` : ''}`));
    });
    renderTeach(d.plan);
  }

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
    fields.append(el('p', 'muted', `Referencia: ${ex.dose.text}`), row);
    if (ex.monitoring === 'auto') {
      const env = v.safety_envelope || {};
      const envRow = el('div', 'field-row');
      envRow.append(input('trunk_margin', 'Margen tronco (°)', env.trunk_margin ?? 15, 5, 35),
        input('valgus_margin', 'Margen valgo (°)', env.valgus_margin ?? 10, 3, 25),
        input('max_reps', 'Reps por sesión (incl. 3 de calibración)', env.max_reps ?? 10, 4, 20));
      fields.append(el('p', 'muted', 'Sobre de seguridad: márgenes sobre la línea base del paciente.'), envRow);
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

  $('btn-plan').addEventListener('click', () => {
    const current = Object.fromEntries((state.detail ? state.detail.plan : []).map((p) => [p.exercise_id, p]));
    const list = $('plan-list');
    list.innerHTML = '';
    C.THEMES.forEach((t) => {
      list.appendChild(el('h3', 'muted', t.name));
      C.EXERCISES.filter((e) => e.theme === t.id).forEach((e) => list.appendChild(planRow(e, current[e.id])));
    });
    $('plan-error').textContent = '';
    $('plan-dialog').showModal();
  });
  $('plan-close').addEventListener('click', () => $('plan-dialog').close());
  $('plan-save').addEventListener('click', async () => {
    const exercises = [];
    document.querySelectorAll('#plan-list .plan-ex[data-on="true"]').forEach((box) => {
      const val = (name) => { const i = box.querySelector(`[data-name="${name}"]`); return i ? i.value : null; };
      const num = (name) => Number(val(name));
      const item = { exercise_id: box.dataset.id, sets: num('sets'), reps: num('reps'), hold_seconds: num('hold_seconds'),
        per_week: num('per_week'), notes: val('notes') || null };
      if (box.querySelector('[data-name="trunk_margin"]')) {
        item.safety_envelope = { trunk_margin: num('trunk_margin'), valgus_margin: num('valgus_margin'), max_reps: num('max_reps') };
      }
      exercises.push(item);
    });
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
    $('live-info').textContent = `${SOURCE[msg.source] || ''} · ${phase || ''} · repeticiones ${msg.reps_done ?? 0}`
      + `${msg.reps_total ? ` de ${msg.reps_total}` : ''}`;
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
