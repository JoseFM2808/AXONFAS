/* AXONFAS · inicio de sesión con Google y elección de rol (ADR-019).
 * Google Identity Services entrega un ID token; el servidor lo verifica (src/backend/google_auth.py) y devuelve el token
 * del rol: administrador (si su correo está en AXONFAS_ADMIN_EMAILS), fisioterapeuta, paciente o "user" (cuenta nueva
 * que todavía elige rol). Sin GOOGLE_CLIENT_ID en el servidor, la página lo dice y ofrece las cuentas de demostración.
 */
(() => {
  'use strict';
  const A = window.AxonApi;
  const $ = (id) => document.getElementById(id);
  const { t } = AxonI18n;   // textos en i18n/common.js (ADR-030); los errores del servidor llegan en español
  const ROLE_TEXT = { admin: t('login.role.admin'), therapist: t('login.role.therapist'), patient: t('login.role.patient'),
    user: t('login.role.user'), org: t('login.role.org'), guest: t('login.role.guest') };

  function show(view) {
    ['signin', 'choose', 'signed'].forEach((id) => { $(id).hidden = id !== view; });
    const heading = $(view).querySelector('h2');
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }

  /** Guarda la sesión del rol y lleva a su página. */
  function enter(res) {
    const name = (res.user && res.user.name) || (res.therapist && res.therapist.name) || (res.patient && res.patient.alias) || '';
    A.save(res.role, { token: res.token, name, alias: res.patient ? res.patient.alias : undefined, email: res.user ? res.user.email : undefined });
    if (res.role !== 'user') A.save('user', null);
    if (res.role !== 'guest') A.save('guest', null);           // con una cuenta de verdad, el modo invitado termina
    if (res.role === 'user') {
      $('choose-hello').textContent = name ? t('login.hello.named', { name }) : t('login.hello.anon');
      $('t-name').value = name;
      show('choose');
      return;
    }
    // Volver a la página que pidió la cuenta (muro de autenticación, TD-107): solo un nombre de página local.
    const next = new URLSearchParams(location.search).get('next');
    location.href = res.role !== 'guest' && next && /^[a-z-]+\.html$/.test(next) && next !== 'login.html' ? next : A.HOME[res.role];
  }

  // Invitado (TD-106): sin registro ni datos personales; solo mira.
  $('as-guest').addEventListener('click', async () => {
    $('signin-status').textContent = t('login.status.guest');
    try {
      enter(await A.call(null, 'POST', '/api/auth/guest', {}));
    } catch (err) { $('signin-status').textContent = err.message; }
  });

  async function onCredential(response) {
    $('signin-status').textContent = t('login.status.verifying');
    try {
      const res = await A.call(null, 'POST', '/api/auth/google', { credential: response.credential });
      $('signin-status').textContent = t('login.status.ready', { role: ROLE_TEXT[res.role] });
      enter(res);
    } catch (err) {
      $('signin-status').textContent = err.message;
    }
  }

  function renderGoogle(clientId) {
    const area = $('google-area');
    if (!clientId) {
      const p = document.createElement('p');
      p.className = 'notice';
      p.textContent = t('login.google.missing');
      area.replaceChildren(p);
      return;
    }
    // GSI en el idioma de la página: `hl` al cargar la biblioteca y `locale` en el botón.
    const lang = AxonI18n.lang;
    const s = document.createElement('script');
    s.src = `https://accounts.google.com/gsi/client?hl=${lang}`;
    s.async = true;
    s.onload = () => {
      window.google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: 'popup', use_fedcm_for_prompt: true });
      const slot = document.createElement('div');
      area.replaceChildren(slot);
      window.google.accounts.id.renderButton(slot, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: lang });
    };
    s.onerror = () => { $('signin-status').textContent = t('login.google.loadError'); };
    document.head.appendChild(s);
  }

  async function signedState() {
    for (const role of ['admin', 'org', 'therapist', 'patient', 'user', 'guest']) {
      const acc = A.load(role);
      if (!acc) continue;
      try {
        const me = await A.call(role, 'GET', '/api/auth/me');
        if (role === 'user') {
          enter({ role: 'user', token: acc.token, user: me.user });
          return true;
        }
        $('signed-text').textContent = me.user ? t('login.signed.email', { role: ROLE_TEXT[role], email: me.user.email })
          : t('login.signed.demo', { role: ROLE_TEXT[role] });
        $('signed-go').href = A.HOME[role];
        $('signed-out').onclick = async () => { await A.logout(role); location.reload(); };
        show('signed');
        return true;
      } catch {
        A.save(role, null);
      }
    }
    return false;
  }

  $('as-therapist').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('choose-status').textContent = t('login.status.therapist');
    try {
      enter(await A.call('user', 'POST', '/api/auth/role', { role: 'therapist', name: $('t-name').value.trim() || undefined }));
    } catch (err) { $('choose-status').textContent = err.message; }
  });

  $('as-patient').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!$('p-consent').checked) { $('choose-status').textContent = t('login.status.consent'); $('p-consent').focus(); return; }
    $('choose-status').textContent = t('login.status.joining');
    try {
      enter(await A.call('user', 'POST', '/api/auth/role', { role: 'patient', code: $('p-code').value, consent: true }));
    } catch (err) { $('choose-status').textContent = err.message; }
  });

  (async () => {
    if (await signedState()) return;
    const cfg = await A.config();
    $('demo-area').hidden = !cfg.demo_accounts;
    renderGoogle(cfg.google_client_id);
  })();
})();
