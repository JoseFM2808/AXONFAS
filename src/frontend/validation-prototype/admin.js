/* AXONFAS · vista del Administrador maestro (ADR-019): configuración, IA de AMD Token Factory (estado, catálogo, uso y
 * prueba) y cuentas de Google (rol y desactivación). Sin datos clínicos de pacientes: solo conteos.
 * Textos en i18n/common.js (ADR-030). Los errores y el motivo sin IA llegan en el idioma de la
 * página (Accept-Language, TD-116); el nombre del plan y la respuesta del modelo, tal como los guarda o escribe el servidor.
 */
(() => {
  'use strict';
  const A = window.AxonApi;
  const { t, tn } = AxonI18n;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ROLE = { admin: t('admin.role.admin'), therapist: t('admin.role.therapist'), patient: t('admin.role.patient'),
    pending: t('admin.role.pending'), org_admin: t('admin.role.org_admin') };
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString(AxonI18n.locale(), { dateStyle: 'short', timeStyle: 'short' }) : '—');

  function kpi(k, v, s) {
    const box = el('div', 'kpi');
    box.append(el('span', 'k', k), el('span', 'v', String(v)), el('span', 's', s));
    return box;
  }

  function check(ok, text, hint) {
    const li = el('li', ok ? 'ok' : 'bad');
    li.append(el('strong', null, ok ? t('admin.check.ok') : t('admin.check.missing')), document.createTextNode(` ${text}`));
    if (!ok && hint) li.append(el('span', 'muted', ` ${hint}`));
    return li;
  }

  async function loadOverview() {
    const o = await A.call('admin', 'GET', '/api/admin/overview');
    const u = o.users || {};
    $('kpis').replaceChildren(
      kpi(t('admin.users.h2'), o.users_total, t('admin.kpi.users.sub',
        { admin: u.admin || 0, therapist: u.therapist || 0, patient: u.patient || 0, pending: u.pending || 0 })),
      kpi(t('admin.kpi.therapists'), o.therapists, t('admin.kpi.therapists.sub')),
      kpi(t('common.patients'), o.patients, tn('admin.kpi.joined', o.patients_joined)),
      kpi(t('admin.kpi.sessions'), o.sessions_total, t('common.in7d', { n: o.sessions_7d })),
      kpi(t('admin.kpi.painStops'), o.pain_stops_30d, t('admin.kpi.painStops.sub')),
      kpi(t('admin.kpi.aiCalls'), o.ai_usage.calls, t('admin.kpi.aiErrors', { n: o.ai_usage.errors })));
    const c = o.config;
    $('config').replaceChildren(
      check(c.google_login, t('admin.cfg.google'), t('admin.cfg.google.hint')),
      check(c.admins_configured > 0, tn('admin.cfg.admins', c.admins_configured), t('admin.cfg.admins.hint')),
      check(Boolean(c.ai_provider), c.ai_provider ? t('admin.cfg.aiOn', { provider: c.ai_provider }) : t('admin.cfg.aiOff'), t('admin.cfg.ai.hint')),
      check(true, c.demo_accounts ? t('admin.cfg.demoOn') : t('admin.cfg.demoOff')),
      check(true, c.cors_origins.length ? t('admin.cfg.cors', { origins: c.cors_origins.join(', ') }) : t('admin.cfg.sameServer')));
  }

  async function loadAi() {
    $('ai-status').textContent = t('admin.ai.loading');
    const ai = await A.call('admin', 'GET', '/api/admin/ai');
    const s = ai.status;
    $('ai-status').textContent = s.available ? t('admin.ai.connected', { provider: s.provider, model: s.model })
      : t('admin.ai.none', { reason: s.reason });
    const us = ai.usage;
    const avg = us.calls - us.errors > 0 ? Math.round(us.ms_total / (us.calls - us.errors)) : null;
    $('ai-usage').replaceChildren(
      el('span', null, t('admin.ai.calls', { calls: us.calls, errors: us.errors })),
      el('span', null, t('admin.ai.tokens', { input: us.prompt_tokens, output: us.completion_tokens })),
      el('span', null, t('admin.ai.avg', { avg: avg == null ? '—' : `${avg} ms` })),
      el('span', null, t('admin.ai.byPurpose', { list: Object.entries(us.by_purpose).map(([k, v]) => `${k} ${v}`).join(' · ') || '—' })));
    if (us.last_error) $('ai-usage').appendChild(el('span', 'fit-note', t('admin.ai.lastError', { error: us.last_error })));
    $('ai-models').replaceChildren(...(s.models.length ? s.models.map((m) => el('li', null, m === s.model ? t('admin.ai.inUse', { model: m }) : m))
      : [el('li', 'muted', t('admin.ai.noCatalog'))]));
  }

  async function loadUsers() {
    const { users } = await A.call('admin', 'GET', '/api/admin/users');
    const body = $('users');
    body.replaceChildren();
    if (!users.length) {
      const tr = el('tr');
      const td = el('td', 'empty', t('admin.users.empty'));
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
        sel.setAttribute('aria-label', t('admin.users.roleOf', { email: u.email }));
        ['pending', 'therapist'].forEach((v) => {
          const o = el('option', null, ROLE[v]);
          o.value = v;
          o.selected = u.role === v;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => update(u, { role: sel.value }));
        roleTd.appendChild(sel);
      }
      tr.append(roleTd, el('td', 'num', fmt(u.last_login_at)));
      const stateTd = el('td');
      if (u.role === 'admin') stateTd.textContent = t('common.active');
      else {
        const b = el('button', 'btn', u.disabled ? t('admin.users.reactivate') : t('admin.users.deactivate'));
        b.type = 'button';
        b.setAttribute('aria-label', u.disabled ? t('admin.users.reactivateOf', { email: u.email }) : t('admin.users.deactivateOf', { email: u.email }));
        b.addEventListener('click', () => update(u, { disabled: !u.disabled }));
        stateTd.append(el('span', u.disabled ? 'tag bad' : 'tag ok', u.disabled ? t('admin.users.disabled') : t('common.active')), document.createTextNode(' '), b);
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
      const td = el('td', 'empty', t('admin.orgs.empty'));
      td.colSpan = 5;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    organizations.forEach((o) => {
      const tr = el('tr');
      tr.append(el('td', null, o.organization.name), el('td', null, o.organization.plan_label), el('td', null, o.admin_email),
        el('td', 'num', t('common.ofTotal', { used: o.seats.used, total: o.seats.total })), el('td', 'num', String(o.patients.total)));
      body.appendChild(tr);
    });
  }

  $('org-new').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('orgs-status').textContent = t('admin.orgs.creating');
    try {
      const r = await A.call('admin', 'POST', '/api/admin/orgs', {
        name: $('org-name').value.trim(), plan: $('org-plan').value, admin_email: $('org-admin').value.trim() });
      $('orgs-status').textContent = t('admin.orgs.created', { name: r.organization.name, email: r.admin_email });
      $('org-name').value = '';
      $('org-admin').value = '';
      await Promise.all([loadOrgs(), loadUsers()]);
    } catch (err) { $('orgs-status').textContent = err.message; }
  });

  /** Demo pública (TD-108): solo números anónimos, que solo ve el Administrador. */
  const SRC = { demo: t('admin.demo.src.demo'), camera: t('admin.demo.src.camera') };
  const END = { completed: t('admin.demo.end.completed'), pain_stop: t('admin.demo.end.pain_stop'),
    user_quit: t('admin.demo.end.user_quit'), envelope_breach: t('admin.demo.end.envelope_breach') };
  async function loadDemoRuns() {
    const d = await A.call('admin', 'GET', '/api/admin/demo-runs');
    $('demo-kpis').replaceChildren(
      kpi(t('admin.demo.kpi.total'), d.total, t('common.in7d', { n: d.last_7d })),
      kpi(t('admin.demo.kpi.camera'), d.by_source.camera || 0, t('admin.demo.kpi.synthetic', { n: d.by_source.demo || 0 })),
      kpi(t('admin.demo.kpi.avgReps'), d.avg_reps ?? '—', t('admin.demo.kpi.perDemo')),
      kpi(t('admin.demo.kpi.alerts'), `${d.with_trunk_events} / ${d.with_valgus_events}`, t('admin.demo.kpi.alertsSub')),
      kpi(t('admin.demo.kpi.guests'), d.guests, t('admin.demo.kpi.guestsSub')));
    const body = $('demo-runs');
    body.replaceChildren();
    if (!d.recent.length) {
      const tr = el('tr');
      const td = el('td', 'empty', t('admin.demo.empty'));
      td.colSpan = 7;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    d.recent.forEach((r) => {
      const tr = el('tr');
      [fmt(r.created_at), SRC[r.source] || r.source, END[r.end_reason] || r.end_reason,
        t('admin.demo.reps', { reps: r.reps_done, cal: r.calibration_reps }),
        `${r.trunk_events} / ${r.valgus_events}`, String(r.low_confidence_reps), r.duration_s ? `${r.duration_s} s` : '—']
        .forEach((text, i) => tr.appendChild(el('td', i >= 3 ? 'num' : null, text)));
      body.appendChild(tr);
    });
  }

  async function update(user, change) {
    $('users-status').textContent = t('common.saving');
    try {
      await A.call('admin', 'PUT', `/api/admin/users/${user.id}`, change);
      $('users-status').textContent = t('admin.users.saved', { email: user.email });
      await Promise.all([loadUsers(), loadOverview()]);
    } catch (err) { $('users-status').textContent = err.message; }
  }

  $('ai-test').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('ai-answer').textContent = t('admin.ai.asking');
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
      $('who').textContent = t('common.who', { who: me.user ? me.user.email : t('admin.who.default') });
      $('panel').hidden = false;
      await refresh();
    } catch (err) {
      if ([401, 403].includes(err.status)) { A.save('admin', null); $('denied').hidden = false; return; }
      $('who').textContent = err.message;
      $('panel').hidden = false;
    }
  })();
})();
