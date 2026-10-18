/* AXONFAS · aviso de entorno: Demo pública o Plataforma clínica (auditoría UI/UX, ADR-033).
 *
 * Cada página dice en qué entorno estás, con un aviso arriba del contenido y el color de la línea de la cabecera:
 * - Demo pública (ámbar): sin cuenta, o como invitado, en las páginas que se pueden explorar. El invitado ya tiene su
 *   barra (auth-wall.js): solo se le pone el color, para no repetir dos avisos.
 * - Plataforma clínica (verde): con una cuenta de verdad en sus páginas (fisioterapeuta, paciente, administración,
 *   empresa) o con el plan del paciente (`?plan=`).
 * login.html queda neutro. Solo lee localStorage; no llama a la red. `envFor` es pura (Node y navegador).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonEnv = api;
}(typeof self !== 'undefined' ? self : this, (root) => {
  'use strict';

  const ROLES = ['therapist', 'patient', 'admin', 'org', 'user'];       // el invitado no es una cuenta
  const CLINICAL_PAGES = ['doctor.html', 'paciente.html', 'admin.html', 'empresa.html'];
  // Página de la cuenta: con el rol de esa página, el aviso nombra ese rol.
  const PAGE_ROLE = { 'doctor.html': 'therapist', 'paciente.html': 'patient', 'admin.html': 'admin', 'empresa.html': 'org' };

  const t = (k, v) => (root.AxonI18n ? root.AxonI18n.t(k, v) : k);

  /**
   * { env: 'demo' | 'clinical' | null, role } según la página, la consulta y las cuentas guardadas.
   * accounts: lista de roles con cuenta en este equipo (puede incluir 'guest').
   */
  function envFor({ page = '', search = '', accounts = [] } = {}) {
    const p = page.split('/').pop() || 'index.html';
    if (p === 'login.html') return { env: null, role: null };
    const real = ROLES.filter((r) => accounts.includes(r));
    const onPlan = new URLSearchParams(search).has('plan') && accounts.includes('patient');
    const pageRole = PAGE_ROLE[p];
    if (pageRole && real.includes(pageRole)) return { env: 'clinical', role: pageRole };
    if (onPlan) return { env: 'clinical', role: 'patient' };
    if (CLINICAL_PAGES.includes(p) && real.length && !pageRole) return { env: 'clinical', role: real[0] };
    return { env: 'demo', role: null };
  }

  function accountsHere() {
    const out = [];
    for (const r of ROLES.concat('guest')) {
      try { if (root.AxonApi ? root.AxonApi.load(r) : root.localStorage.getItem(`axonfas.${r}`)) out.push(r); } catch { /* sin almacenamiento */ }
    }
    return out;
  }

  function mount(doc = root.document) {
    if (!doc || !doc.documentElement) return null;
    const accounts = accountsHere();
    const { env, role } = envFor({ page: root.location ? root.location.pathname : '', search: root.location ? root.location.search : '', accounts });
    if (!env) return null;
    doc.documentElement.dataset.env = env;
    const wrap = doc.querySelector('.wrap');
    if (!wrap || doc.getElementById('env-banner')) return null;
    if (env === 'demo' && accounts.includes('guest') && !ROLES.some((r) => accounts.includes(r))) return null;   // ya tiene su barra
    const bar = doc.createElement('div');
    bar.id = 'env-banner';
    bar.className = `env-banner env-${env}`;
    bar.setAttribute('role', 'note');
    const label = doc.createElement('span');
    label.className = 'env-label';
    label.textContent = t(`env.${env}.label`);
    const text = doc.createElement('span');
    text.className = 'env-text';
    text.textContent = env === 'demo' ? t('env.demo.text') : t('env.clinical.text', { role: t(`env.role.${role}`) });
    bar.append(label, text);
    if (env === 'demo') {
      const go = doc.createElement('a');
      go.className = 'btn';
      go.href = 'login.html';
      go.textContent = t('env.demo.cta');
      bar.append(go);
    }
    wrap.prepend(bar);
    return bar;
  }

  if (root.document && root.document.addEventListener) {
    const run = () => mount(root.document);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  return { ROLES, CLINICAL_PAGES, envFor, mount };
}));
