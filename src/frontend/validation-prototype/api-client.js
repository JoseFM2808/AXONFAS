/* AXONFAS · cliente de la API de Staging (ADR-012). Lo usan doctor.js, patient.js y patient-link.js.
 * El token de cada cuenta de demostración vive en localStorage de este navegador y viaja en la cabecera
 * Authorization, nunca en la URL. El canal en vivo se lee con fetch (Server-Sent Events) por la misma razón.
 */
(function (root) {
  'use strict';
  const KEYS = { therapist: 'axonfas.therapist', patient: 'axonfas.patient' };

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
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch {
      const err = new Error('No hay conexión con el servidor de AXONFAS. ¿Está corriendo lanzar-prototipo.cmd?');
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
          const res = await fetch(path, { headers: { Authorization: `Bearer ${account && account.token}` }, signal: controller.signal, cache: 'no-store' });
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

  root.AxonApi = { load, save, call, stream, lanInfo, shareUrl, qrSvg };
})(typeof self !== 'undefined' ? self : this);
