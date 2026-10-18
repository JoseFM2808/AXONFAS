/* AXONFAS · invitado y muro de autenticación diferido (TD-106, TD-107, ADR-028).
 *
 * El invitado (login.html → "Ingresar como invitado") mira sin registrarse: la galería, la demo y una interfaz clínica de
 * muestra con datos sintéticos. Crear una cuenta se pide solo al intentar algo permanente o clínico: la rutina completa,
 * guardar el progreso, ver un historial propio o cambiar datos. El servidor responde `code: 'auth_required'`
 * (api-client.js emite `axon:auth-required`) y las páginas también pueden pedirlo antes con `AxonWall.require(motivo)`.
 * El diálogo nunca bloquea "Dolor: detener" ni el resto de la página: se cierra con Escape o "Seguir explorando".
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonWall = api;
}(typeof self !== 'undefined' ? self : this, (root) => {
  'use strict';

  const ACCOUNT_ROLES = ['therapist', 'patient', 'admin', 'org', 'user'];
  // Textos en i18n/common.js (ADR-030): se leen al usarlos, en el idioma de la página.
  // Ojo: este módulo define su propia función require() (el muro), que tapa la de Node: se usa module.require.
  const I18N = (typeof self !== 'undefined' && self.AxonI18n) || module.require('./i18n.js');
  const t = I18N.t;
  const TEXT = {
    get bar() { return t('guest.bar'); },
    get title() { return t('wall.title'); },
    get body() { return t('wall.body'); },
    get fallback() { return t('wall.fallback'); },
  };

  const has = (role) => {
    try { return !!(root.AxonApi ? root.AxonApi.load(role) : root.localStorage.getItem(`axonfas.${role}`)); } catch { return false; }
  };
  /** ¿Hay una cuenta de verdad en este equipo? (un invitado no cuenta). */
  const hasAccount = () => ACCOUNT_ROLES.some(has);
  const isGuest = () => has('guest') && !hasAccount();
  const loginUrl = () => `login.html?next=${encodeURIComponent((root.location && root.location.pathname.split('/').pop()) || 'index.html')}`;
  // El motivo puede ser texto ya traducido o una clave del diccionario (p. ej. 'tracking.wall.reason').
  const reasonText = (reason) => (reason && (I18N.has(reason) || I18N.has(reason, I18N.BASE)) ? t(reason) : reason);
  const bodyText = (reason) => t('wall.body', { reason: reasonText(reason) || TEXT.fallback });

  let dialog = null;
  function build(doc) {
    const d = doc.createElement('dialog');
    d.className = 'wall-dialog';
    d.id = 'auth-wall';
    d.setAttribute('aria-labelledby', 'auth-wall-title');
    d.setAttribute('aria-describedby', 'auth-wall-body');
    const h = doc.createElement('h2');
    h.id = 'auth-wall-title';
    h.textContent = TEXT.title;
    const p = doc.createElement('p');
    p.id = 'auth-wall-body';
    const row = doc.createElement('div');
    row.className = 'wall-actions';
    const go = doc.createElement('a');
    go.className = 'btn primary';
    go.textContent = t('wall.go');
    const stay = doc.createElement('button');
    stay.type = 'button';
    stay.className = 'btn';
    stay.textContent = t('wall.stay');
    stay.addEventListener('click', () => d.close());
    row.append(go, stay);
    d.append(h, p, row);
    doc.body.appendChild(d);
    return d;
  }

  /** Abre el muro con el motivo ("guardar tu progreso", ...). */
  function open(reason, doc = root.document) {
    if (!doc) return;
    dialog = dialog || build(doc);
    dialog.querySelector('#auth-wall-body').textContent = bodyText(reason);
    dialog.querySelector('a').href = loginUrl();
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    dialog.querySelector('a').focus();
  }

  /** true si puede seguir (hay cuenta); si no, abre el muro y devuelve false. */
  function require(reason) {
    if (hasAccount()) return true;
    open(reason);
    return false;
  }

  /** Barra fija del invitado arriba del contenido, con la salida del modo invitado. */
  function guestBar(doc = root.document) {
    if (!doc || !isGuest() || doc.getElementById('guest-bar')) return;
    const wrap = doc.querySelector('.wrap');
    if (!wrap) return;
    const bar = doc.createElement('div');
    bar.id = 'guest-bar';
    bar.className = 'notice guest-bar';
    bar.setAttribute('role', 'note');
    const text = doc.createElement('span');
    text.textContent = TEXT.bar;
    const go = doc.createElement('a');
    go.className = 'btn primary';
    go.href = loginUrl();
    go.textContent = t('wall.go');
    const out = doc.createElement('button');
    out.type = 'button';
    out.className = 'btn';
    out.textContent = t('guest.exit');
    out.addEventListener('click', async () => {
      if (root.AxonApi) await root.AxonApi.logout('guest');
      root.location.href = 'login.html';
    });
    bar.append(text, go, out);
    wrap.prepend(bar);
  }

  if (root.document && root.addEventListener) {
    root.addEventListener('axon:auth-required', (ev) => open(ev.detail && ev.detail.reason));
    const run = () => guestBar(root.document);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  return { TEXT, ACCOUNT_ROLES, hasAccount, isGuest, require, open, bodyText };
}));
