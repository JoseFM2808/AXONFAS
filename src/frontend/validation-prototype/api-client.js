/* AXONFAS · cliente de la API de Staging (ADR-012, ADR-019). Lo usan todas las páginas con cuentas.
 * El token de cada rol (fisioterapeuta, paciente, administrador o cuenta de Google sin rol todavía) vive en localStorage
 * de este navegador y viaja en la cabecera Authorization, nunca en la URL. El canal en vivo se lee con fetch
 * (Server-Sent Events) por la misma razón. Con la web en otro dominio (Vercel), config.js trae la dirección de la API
 * (ADR-020); vacía = el mismo servidor.
 */
(function (root) {
  'use strict';
  const KEYS = { therapist: 'axonfas.therapist', patient: 'axonfas.patient', admin: 'axonfas.admin', user: 'axonfas.user',
    org: 'axonfas.org' };   // org = administración de una organización (Nivel 3, ADR-026)
  const BASE = ((root.AXONFAS_CONFIG && root.AXONFAS_CONFIG.apiBase) || '').replace(/\/$/, '');
  const url = (path) => (/^https?:/.test(path) ? path : `${BASE}${path}`);

  function load(role) {
    try { return JSON.parse(localStorage.getItem(KEYS[role]) || 'null'); } catch { return null; }
  }

  function save(role, value) {
    try {
      if (value) localStorage.setItem(KEYS[role], JSON.stringify(value));
      else localStorage.removeItem(KEYS[role]);
    } catch { /* sin almacenamiento: la sesión dura lo que la pestaña */ }
  }

  async function call(role, method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const account = role ? load(role) : null;
    if (account && account.token) headers.Authorization = `Bearer ${account.token}`;
    let res;
    try {
      res = await fetch(url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch {
      const err = new Error('No hay conexión con el servidor de AXONFAS. Revisa tu internet o, en esta PC, que esté corriendo lanzar-prototipo.cmd.');
      err.status = 0;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch { /* sin cuerpo */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Lee un canal de eventos con reconexión automática. Devuelve { stop() }. */
  function stream(role, path, onMessage, onState) {
    let stopped = false;
    let controller = null;
    (async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          if (onState) onState('connecting');
          const account = load(role);
          const res = await fetch(url(path), { headers: { Authorization: `Bearer ${account && account.token}` }, signal: controller.signal, cache: 'no-store' });
          if (!res.ok) {
            if (onState) onState('error', res.status);
            if ([401, 403, 404].includes(res.status)) return;
            throw new Error(String(res.status));
          }
          if (onState) onState('open');
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let cut;
            while ((cut = buffer.indexOf('\n\n')) >= 0) {
              const chunk = buffer.slice(0, cut);
              buffer = buffer.slice(cut + 2);
              const line = chunk.split('\n').find((l) => l.startsWith('data: '));
              if (line) {
                try { onMessage(JSON.parse(line.slice(6))); } catch { /* mensaje dañado: se ignora */ }
              }
            }
          }
        } catch {
          if (stopped) return;
        }
        if (onState) onState('closed');
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();
    return { stop() { stopped = true; if (controller) controller.abort(); } };
  }

  async function lanInfo() {
    try {
      if (BASE) return null;                                  // en la nube no hay red local ni QR
      const res = await fetch('/lan.json', { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }

  /** Dirección para abrir una página desde otro equipo (HTTPS de la red local si existe, si no la actual). */
  async function shareUrl(page) {
    const info = await lanInfo();
    const base = (info && (info.lan_https || info.lan_http)) || `${location.origin}/`;
    return new URL(page, base).href;
  }

  function qrSvg(text) {
    if (typeof root.qrcode !== 'function') return '';
    const qr = root.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag(6, 2);
  }

  /** Configuración pública del servidor: ID de cliente de Google, cuentas de demostración y proveedor de IA. */
  let configPromise = null;
  function config() {
    if (!configPromise) configPromise = call(null, 'GET', '/api/auth/config').catch(() => ({ google_client_id: null, demo_accounts: true, ai_provider: null }));
    return configPromise;
  }

  /** Cierra la sesión de un rol en el servidor y en este navegador. */
  async function logout(role) {
    if (load(role)) { try { await call(role, 'POST', '/api/auth/logout', {}); } catch { /* ya no valía */ } }
    save(role, null);
  }

  /** Página de inicio de cada rol. */
  const HOME = { admin: 'admin.html', therapist: 'doctor.html', patient: 'paciente.html', user: 'login.html', org: 'empresa.html' };

  root.AxonApi = { load, save, call, stream, lanInfo, shareUrl, qrSvg, config, logout, HOME };
})(typeof self !== 'undefined' ? self : this);
