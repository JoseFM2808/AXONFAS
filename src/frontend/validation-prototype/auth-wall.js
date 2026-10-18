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
  const TEXT = {
    bar: 'Estás como invitado: puedes mirar todo con datos de muestra. Para hacer tu rutina completa, guardar tu progreso o '
      + 'ver tu historial, crea tu cuenta.',
    title: 'Crea tu cuenta para seguir',
    body: 'Como invitado puedes explorar. Para {motivo} hace falta una cuenta: así tu fisioterapeuta te acompaña y tus datos '
      + 'quedan protegidos.',
    fallback: 'esto',
  };

  const has = (role) => {
    try { return !!(root.AxonApi ? root.AxonApi.load(role) : root.localStorage.getItem(`axonfas.${role}`)); } catch { return false; }
  };
  /** ¿Hay una cuenta de verdad en este equipo? (un invitado no cuenta). */
  const hasAccount = () => ACCOUNT_ROLES.some(has);
  const isGuest = () => has('guest') && !hasAccount();
  const loginUrl = () => `login.html?next=${encodeURIComponent((root.location && root.location.pathname.split('/').pop()) || 'index.html')}`;
  const bodyText = (reason) => TEXT.body.replace('{motivo}', reason || TEXT.fallback);

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
    go.textContent = 'Crear cuenta o entrar';
    const stay = doc.createElement('button');
    stay.type = 'button';
    stay.className = 'btn';
    stay.textContent = 'Seguir explorando';
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
    go.textContent = 'Crear cuenta o entrar';
    const out = doc.createElement('button');
    out.type = 'button';
    out.className = 'btn';
    out.textContent = 'Salir del modo invitado';
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
