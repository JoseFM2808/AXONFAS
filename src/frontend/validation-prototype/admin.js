/* AXONFAS · vista del Administrador maestro (ADR-019): configuración, IA de AMD Token Factory (estado, catálogo, uso y
 * prueba) y cuentas de Google (rol y desactivación). Sin datos clínicos de pacientes: solo conteos.
 */
(() => {
  'use strict';
  const A = window.AxonApi;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ROLE = { admin: 'Administrador', therapist: 'Fisioterapeuta', patient: 'Paciente', pending: 'Pendiente', org_admin: 'Empresa' };
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  function kpi(k, v, s) {
    const box = el('div', 'kpi');
    box.append(el('span', 'k', k), el('span', 'v', String(v)), el('span', 's', s));
    return box;
  }

  function check(ok, text, hint) {
    const li = el('li', ok ? 'ok' : 'bad');
    li.append(el('strong', null, ok ? 'Listo: ' : 'Falta: '), document.createTextNode(text));
    if (!ok && hint) li.append(el('span', 'muted', ` ${hint}`));
    return li;
  }

  async function loadOverview() {
    const o = await A.call('admin', 'GET', '/api/admin/overview');
    const u = o.users || {};
    $('kpis').replaceChildren(
      kpi('Cuentas de Google', o.users_total, `${u.admin || 0} admin · ${u.therapist || 0} fisio · ${u.patient || 0} pac. · ${u.pending || 0} pend.`),
      kpi('Fisioterapeutas', o.therapists, 'incluye los de demostración'),
      kpi('Pacientes', o.patients, `${o.patients_joined} afiliados`),
      kpi('Sesiones', o.sessions_total, `${o.sessions_7d} en 7 días`),
      kpi('Detenciones por dolor', o.pain_stops_30d, 'en 30 días'),
      kpi('Llamadas a la IA', o.ai_usage.calls, `${o.ai_usage.errors} con error`));
    const c = o.config;
    $('config').replaceChildren(
      check(c.google_login, 'inicio de sesión con Google', 'Define GOOGLE_CLIENT_ID en el servidor.'),
      check(c.admins_configured > 0, `${c.admins_configured} correo(s) de Administrador`, 'Define AXONFAS_ADMIN_EMAILS.'),
      check(Boolean(c.ai_provider), c.ai_provider ? `IA: ${c.ai_provider}` : 'proveedor de IA de AMD', 'Define AMD_TOKENFACTORY_BASE_URL y AMD_TOKENFACTORY_API_KEY.'),
      check(true, c.demo_accounts ? 'cuentas de demostración encendidas (apágalas en público con AXONFAS_DEMO_ACCOUNTS=0)' : 'cuentas de demostración apagadas'),
      check(true, c.cors_origins.length ? `web en otro dominio permitida: ${c.cors_origins.join(', ')}` : 'web y API en el mismo servidor'));
  }

  async function loadAi() {
    $('ai-status').textContent = 'Consultando el catálogo de AMD…';
    const ai = await A.call('admin', 'GET', '/api/admin/ai');
    const s = ai.status;
    $('ai-status').textContent = s.available ? `Conectado a ${s.provider}. Modelo en uso: ${s.model}.`
      : `Sin IA: ${s.reason}.`;
    const us = ai.usage;
    const avg = us.calls - us.errors > 0 ? Math.round(us.ms_total / (us.calls - us.errors)) : null;
    $('ai-usage').replaceChildren(
      el('span', null, `Llamadas desde que arrancó el servidor: ${us.calls} (${us.errors} con error)`),
      el('span', null, `Tokens: ${us.prompt_tokens} de entrada · ${us.completion_tokens} de salida`),
      el('span', null, `Tiempo medio por respuesta: ${avg == null ? '—' : `${avg} ms`}`),
      el('span', null, `Por uso: ${Object.entries(us.by_purpose).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`));
    if (us.last_error) $('ai-usage').appendChild(el('span', 'fit-note', `Último error: ${us.last_error}`));
    $('ai-models').replaceChildren(...(s.models.length ? s.models.map((m) => el('li', null, m === s.model ? `${m} (en uso)` : m)) : [el('li', 'muted', 'Sin catálogo.')]));
  }

  async function loadUsers() {
    const { users } = await A.call('admin', 'GET', '/api/admin/users');
    const body = $('users');
    body.innerHTML = '';
    if (!users.length) {
      const tr = el('tr');
      const td = el('td', 'empty', 'Todavía nadie entró con Google.');
      td.colSpan = 5;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    users.forEach((u) => {
      const tr = el('tr');
      tr.append(el('td', null, u.email), el('td', null, u.name || '—'));
      const roleTd = el('td');
      if (u.role === 'admin' || u.role === 'patient' || u.role === 'org_admin') roleTd.textContent = ROLE[u.role];
      else {
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', `Rol de ${u.email}`);
        [['pending', 'Pendiente'], ['therapist', 'Fisioterapeuta']].forEach(([v, t]) => {
          const o = el('option', null, t);
          o.value = v;
          o.selected = u.role === v;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => update(u, { role: sel.value }));
        roleTd.appendChild(sel);
      }
      tr.append(roleTd, el('td', 'num', fmt(u.last_login_at)));
      const stateTd = el('td');
      if (u.role === 'admin') stateTd.textContent = 'Activa';
      else {
        const b = el('button', 'btn', u.disabled ? 'Reactivar' : 'Desactivar');
        b.type = 'button';
        b.setAttribute('aria-label', `${u.disabled ? 'Reactivar' : 'Desactivar'} la cuenta de ${u.email}`);
        b.addEventListener('click', () => update(u, { disabled: !u.disabled }));
        stateTd.append(el('span', u.disabled ? 'tag bad' : 'tag ok', u.disabled ? 'Desactivada' : 'Activa'), document.createTextNode(' '), b);
      }
      tr.appendChild(stateTd);
      body.appendChild(tr);
    });
  }

  /** Organizaciones del Nivel 3 (ADR-026): solo plan, licencias y conteos. */
  async function loadOrgs() {
    const { organizations } = await A.call('admin', 'GET', '/api/admin/orgs');
    const body = $('orgs');
    body.replaceChildren();
    if (!organizations.length) {
      const tr = el('tr');
      const td = el('td', 'empty', 'Todavía no hay organizaciones.');
      td.colSpan = 5;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    organizations.forEach((o) => {
      const tr = el('tr');
      tr.append(el('td', null, o.organization.name), el('td', null, o.organization.plan_label), el('td', null, o.admin_email),
        el('td', 'num', `${o.seats.used} de ${o.seats.total}`), el('td', 'num', String(o.patients.total)));
      body.appendChild(tr);
    });
  }

  $('org-new').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('orgs-status').textContent = 'Creando…';
    try {
      const r = await A.call('admin', 'POST', '/api/admin/orgs', {
        name: $('org-name').value.trim(), plan: $('org-plan').value, admin_email: $('org-admin').value.trim() });
      $('orgs-status').textContent = `Creada: ${r.organization.name}. Su administración entra con Google con ${r.admin_email}.`;
      $('org-name').value = '';
      $('org-admin').value = '';
      await Promise.all([loadOrgs(), loadUsers()]);
    } catch (err) { $('orgs-status').textContent = err.message; }
  });

  /** Demo pública (TD-108): solo números anónimos, que solo ve el Administrador. */
  const SRC = { demo: 'Demo sintético', camera: 'Cámara' };
  const END = { completed: 'Completada', pain_stop: 'Dolor', user_quit: 'A mano', envelope_breach: 'Fuera del sobre' };
  async function loadDemoRuns() {
    const d = await A.call('admin', 'GET', '/api/admin/demo-runs');
    $('demo-kpis').replaceChildren(
      kpi('Demos', d.total, `${d.last_7d} en 7 días`),
      kpi('Con cámara', d.by_source.camera || 0, `${d.by_source.demo || 0} con el demo sintético`),
      kpi('Repeticiones medias', d.avg_reps ?? '—', 'por demo'),
      kpi('Con alertas', `${d.with_trunk_events} / ${d.with_valgus_events}`, 'tronco / valgo'),
      kpi('Invitados', d.guests, 'entradas sin registro'));
    const body = $('demo-runs');
    body.replaceChildren();
    if (!d.recent.length) {
      const tr = el('tr');
      const td = el('td', 'empty', 'Todavía nadie terminó la demo.');
      td.colSpan = 7;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    d.recent.forEach((r) => {
      const tr = el('tr');
      [fmt(r.created_at), SRC[r.source] || r.source, END[r.end_reason] || r.end_reason, `${r.reps_done} (${r.calibration_reps} de calibración)`,
        `${r.trunk_events} / ${r.valgus_events}`, String(r.low_confidence_reps), r.duration_s ? `${r.duration_s} s` : '—']
        .forEach((t, i) => tr.appendChild(el('td', i >= 3 ? 'num' : null, t)));
      body.appendChild(tr);
    });
  }

  async function update(user, change) {
    $('users-status').textContent = 'Guardando…';
    try {
      await A.call('admin', 'PUT', `/api/admin/users/${user.id}`, change);
      $('users-status').textContent = `Guardado: ${user.email}.`;
      await Promise.all([loadUsers(), loadOverview()]);
    } catch (err) { $('users-status').textContent = err.message; }
  }

  $('ai-test').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('ai-answer').textContent = 'Preguntando al modelo…';
    try {
      const r = await A.call('admin', 'POST', '/api/admin/ai/test', { prompt: $('ai-prompt').value.trim() || undefined });
      $('ai-answer').textContent = `${r.model} (${r.ms} ms): ${r.text}`;
      loadAi();
    } catch (err) { $('ai-answer').textContent = err.message; }
  });

  $('btn-refresh').addEventListener('click', () => refresh());
  $('btn-logout').addEventListener('click', async () => { await A.logout('admin'); location.href = 'login.html'; });

  async function refresh() {
    await Promise.all([loadOverview(), loadUsers(), loadOrgs().catch((err) => { $('orgs-status').textContent = err.message; }),
      loadDemoRuns().catch(() => {}),
      loadAi().catch((err) => { $('ai-status').textContent = err.message; })]);
  }

  (async () => {
    if (!A.load('admin')) { $('denied').hidden = false; return; }
    try {
      const me = await A.call('admin', 'GET', '/api/auth/me');
      $('who').textContent = `Sesión de ${me.user ? me.user.email : 'administración'}.`;
      $('panel').hidden = false;
      await refresh();
    } catch (err) {
      if ([401, 403].includes(err.status)) { A.save('admin', null); $('denied').hidden = false; return; }
      $('who').textContent = err.message;
      $('panel').hidden = false;
    }
  })();
})();
