/* AXONFAS · panel de empresa del Nivel 3 (TD-102, ADR-026): plan, licencias de profesionales, pacientes por profesional
 * (solo conteos) y dirección FHIR de la historia clínica de la organización. Sin datos clínicos de pacientes (I-18).
 * Textos en i18n/common.js (ADR-030). El nombre del plan y los errores los escribe el servidor (en español por ahora).
 */
(() => {
  'use strict';
  const A = window.AxonApi;
  const { t, tn } = AxonI18n;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const STATUS = { active: t('common.active'), revoked: t('company.status.revoked') };

  function kpi(k, v, s) {
    const box = el('div', 'kpi');
    box.append(el('span', 'k', k), el('span', 'v', String(v)), el('span', 's', s));
    return box;
  }

  function render(s) {
    $('org-name').textContent = s.organization.name;
    $('kpis').replaceChildren(
      kpi(t('common.plan'), s.organization.plan_label, tn('company.kpi.licenses', s.seats.total)),
      kpi(t('company.kpi.inUse'), t('common.ofTotal', { used: s.seats.used, total: s.seats.total }), tn('company.kpi.free', s.seats.free)),
      kpi(t('common.patients'), s.patients.total, s.patients.over ? t('company.kpi.over', { n: s.patients.capacity })
        : t('company.kpi.quota', { n: s.patients.capacity })),
      kpi(t('company.kpi.ehr'), s.ehr.enabled ? t('common.active') : t('company.kpi.ehrOff'), s.ehr.fhir_base_url || t('company.kpi.noUrl')));
    $('invite').querySelector('button').disabled = s.seats.free === 0;
    const body = $('pros');
    body.replaceChildren();
    if (!s.professionals.length) {
      const tr = el('tr');
      const td = el('td', 'empty', t('company.pros.empty'));
      td.colSpan = 5;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    s.professionals.forEach((p) => {
      const tr = el('tr');
      const state = el('td');
      state.appendChild(el('span', p.status === 'active' ? 'tag ok' : 'tag', STATUS[p.status] || p.status));
      tr.append(el('td', null, p.email), state, el('td', null, p.linked ? t('company.linked.yes') : t('company.linked.no')),
        el('td', 'num', String(p.patients)));
      const act = el('td');
      if (p.status === 'active') {
        const b = el('button', 'btn', t('company.release'));
        b.type = 'button';
        b.setAttribute('aria-label', t('company.releaseOf', { email: p.email }));
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
    if (!window.confirm(t('company.release.confirm', { email: p.email }))) return;
    $('invite-status').textContent = t('company.releasing');
    try {
      await A.call('org', 'POST', `/api/org/licenses/${p.license_id}/revoke`, {});
      $('invite-status').textContent = t('company.released', { email: p.email });
      await refresh();
    } catch (err) { $('invite-status').textContent = err.message; }
  }

  $('invite').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('invite-email').value.trim();
    $('invite-status').textContent = t('company.inviting');
    try {
      await A.call('org', 'POST', '/api/org/licenses', { email });
      $('invite-status').textContent = t('company.invited', { email });
      $('invite-email').value = '';
      await refresh();
    } catch (err) { $('invite-status').textContent = err.message; }
  });

  $('ehr').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('ehr-status').textContent = t('common.saving');
    try {
      await A.call('org', 'PUT', '/api/org/ehr', { fhir_base_url: $('ehr-url').value.trim() || null, enabled: $('ehr-enabled').checked });
      $('ehr-status').textContent = t('common.saved');
      await refresh();
    } catch (err) { $('ehr-status').textContent = err.message; }
  });

  $('btn-refresh').addEventListener('click', () => refresh().catch((err) => { $('who').textContent = err.message; }));
  $('btn-logout').addEventListener('click', async () => { await A.logout('org'); location.href = 'login.html'; });

  (async () => {
    if (!A.load('org')) { $('denied').hidden = false; return; }
    try {
      const me = await A.call('org', 'GET', '/api/auth/me');
      $('who').textContent = t('common.who', { who: me.user ? me.user.email : t('company.who.default') });
      $('panel').hidden = false;
      await refresh();
    } catch (err) {
      if ([401, 403].includes(err.status)) { A.save('org', null); $('denied').hidden = false; return; }
      $('who').textContent = err.message;
      $('panel').hidden = false;
    }
  })();
})();
