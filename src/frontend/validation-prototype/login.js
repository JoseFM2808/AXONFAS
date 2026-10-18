/* AXONFAS · inicio de sesión con Google y elección de rol (ADR-019).
 * Google Identity Services entrega un ID token; el servidor lo verifica (src/backend/google_auth.py) y devuelve el token
 * del rol: administrador (si su correo está en AXONFAS_ADMIN_EMAILS), fisioterapeuta, paciente o "user" (cuenta nueva
 * que todavía elige rol). Sin GOOGLE_CLIENT_ID en el servidor, la página lo dice y ofrece las cuentas de demostración.
 */
(() => {
  'use strict';
  const A = window.AxonApi;
  const $ = (id) => document.getElementById(id);
  const ROLE_TEXT = { admin: 'Administrador', therapist: 'Fisioterapeuta', patient: 'Paciente', user: 'Cuenta nueva', org: 'Empresa' };

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
    if (res.role === 'user') {
      $('choose-hello').textContent = `Hola${name ? `, ${name}` : ''}. Es tu primera vez: elige cómo vas a usar AXONFAS.`;
      $('t-name').value = name;
      show('choose');
      return;
    }
    location.href = A.HOME[res.role];
  }

  async function onCredential(response) {
    $('signin-status').textContent = 'Verificando con Google…';
    try {
      const res = await A.call(null, 'POST', '/api/auth/google', { credential: response.credential });
      $('signin-status').textContent = `Listo: ${ROLE_TEXT[res.role]}.`;
      enter(res);
    } catch (err) {
      $('signin-status').textContent = err.message;
    }
  }

  function renderGoogle(clientId) {
    const area = $('google-area');
    if (!clientId) {
      area.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'notice';
      p.textContent = 'El inicio de sesión con Google todavía no está configurado en este servidor (falta GOOGLE_CLIENT_ID).';
      area.appendChild(p);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      window.google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: 'popup', use_fedcm_for_prompt: true });
      area.innerHTML = '';
      const slot = document.createElement('div');
      area.appendChild(slot);
      window.google.accounts.id.renderButton(slot, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es' });
    };
    s.onerror = () => { $('signin-status').textContent = 'No se pudo cargar el botón de Google. Revisa tu conexión.'; };
    document.head.appendChild(s);
  }

  async function signedState() {
    for (const role of ['admin', 'org', 'therapist', 'patient', 'user']) {
      const acc = A.load(role);
      if (!acc) continue;
      try {
        const me = await A.call(role, 'GET', '/api/auth/me');
        if (role === 'user') {
          enter({ role: 'user', token: acc.token, user: me.user });
          return true;
        }
        $('signed-text').textContent = `${ROLE_TEXT[role]}${me.user ? ` · ${me.user.email}` : ' · cuenta de demostración'}.`;
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
    $('choose-status').textContent = 'Creando tu cuenta de fisioterapeuta…';
    try {
      enter(await A.call('user', 'POST', '/api/auth/role', { role: 'therapist', name: $('t-name').value.trim() || undefined }));
    } catch (err) { $('choose-status').textContent = err.message; }
  });

  $('as-patient').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!$('p-consent').checked) { $('choose-status').textContent = 'Para continuar, acepta el consentimiento.'; $('p-consent').focus(); return; }
    $('choose-status').textContent = 'Afiliándote…';
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
