/* AXONFAS · panel de empresa del Nivel 3 (TD-102, ADR-026): plan, licencias de profesionales, pacientes por profesional
 * (solo conteos) y dirección FHIR de la historia clínica de la organización. Sin datos clínicos de pacientes (I-18).
 */
(() => {
  'use strict';
  const A = window.AxonApi;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const STATUS = { active: 'Activa', revoked: 'Liberada' };

  function kpi(k, v, s) {
    const box = el('div', 'kpi');
    box.append(el('span', 'k', k), el('span', 'v', String(v)), el('span', 's', s));
    return box;
  }

  function render(s) {
    $('org-name').textContent = s.organization.name;
    $('kpis').replaceChildren(
      kpi('Plan', s.organization.plan_label, `${s.seats.total} licencias`),
      kpi('Licencias en uso', `${s.seats.used} de ${s.seats.total}`, `${s.seats.free} libres`),
      kpi('Pacientes', s.patients.total, s.patients.over ? `por encima del cupo de ${s.patients.capacity}` : `cupo del plan: ${s.patients.capacity}`),
      kpi('Historia clínica', s.ehr.enabled ? 'Activa' : 'Sin conexión', s.ehr.fhir_base_url || 'sin dirección'));
    $('invite').querySelector('button').disabled = s.seats.free === 0;
    const body = $('pros');
    body.replaceChildren();
    if (!s.professionals.length) {
      const tr = el('tr');
      const td = el('td', 'empty', 'Todavía no invitaste a ningún profesional.');
      td.colSpan = 5;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    s.professionals.forEach((p) => {
      const tr = el('tr');
      const state = el('td');
      state.appendChild(el('span', p.status === 'active' ? 'tag ok' : 'tag', STATUS[p.status] || p.status));
      tr.append(el('td', null, p.email), state, el('td', null, p.linked ? 'Sí' : 'Todavía no'), el('td', 'num', String(p.patients)));
      const act = el('td');
      if (p.status === 'active') {
        const b = el('button', 'btn', 'Liberar');
        b.type = 'button';
        b.setAttribute('aria-label', `Liberar la licencia de ${p.email}`);
        b.addEventListener('click', () => revoke(p));
        act.appendChild(b);
      } else act.textContent = '—';
      tr.appendChild(act);
      body.appendChild(tr);
    });
    $('ehr-url').value = s.ehr.fhir_base_url || '';
    $('ehr-enabled').checked = s.ehr.enabled;
  }

  async function refresh() {
    render(await A.call('org', 'GET', '/api/org/summary'));
  }

  async function revoke(p) {
    if (!window.confirm(`¿Liberar la licencia de ${p.email}? Sus pacientes siguen con su plan; la organización deja de verlo.`)) return;
    $('invite-status').textContent = 'Liberando…';
    try {
      await A.call('org', 'POST', `/api/org/licenses/${p.license_id}/revoke`, {});
      $('invite-status').textContent = `Licencia liberada: ${p.email}.`;
      await refresh();
    } catch (err) { $('invite-status').textContent = err.message; }
  }

  $('invite').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('invite-email').value.trim();
    $('invite-status').textContent = 'Invitando…';
    try {
      await A.call('org', 'POST', '/api/org/licenses', { email });
      $('invite-status').textContent = `Invitación lista para ${email}. Que entre con Google con ese correo.`;
      $('invite-email').value = '';
      await refresh();
    } catch (err) { $('invite-status').textContent = err.message; }
  });

  $('ehr').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('ehr-status').textContent = 'Guardando…';
    try {
      await A.call('org', 'PUT', '/api/org/ehr', { fhir_base_url: $('ehr-url').value.trim() || null, enabled: $('ehr-enabled').checked });
      $('ehr-status').textContent = 'Guardado.';
      await refresh();
    } catch (err) { $('ehr-status').textContent = err.message; }
  });

  $('btn-refresh').addEventListener('click', () => refresh().catch((err) => { $('who').textContent = err.message; }));
  $('btn-logout').addEventListener('click', async () => { await A.logout('org'); location.href = 'login.html'; });

  (async () => {
    if (!A.load('org')) { $('denied').hidden = false; return; }
    try {
      const me = await A.call('org', 'GET', '/api/auth/me');
      $('who').textContent = `Sesión de ${me.user ? me.user.email : 'administración de la organización'}.`;
      $('panel').hidden = false;
      await refresh();
    } catch (err) {
      if ([401, 403].includes(err.status)) { A.save('org', null); $('denied').hidden = false; return; }
      $('who').textContent = err.message;
      $('panel').hidden = false;
    }
  })();
})();
