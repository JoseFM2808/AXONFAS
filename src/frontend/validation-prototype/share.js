/* AXONFAS · probar el prototipo desde otro equipo de la misma red (TD-33).
 * Si la página la sirve serve.py, /lan.json trae la dirección de la red local; entonces aparece el botón "Probar en otro
 * equipo", que abre un QR. Con doble clic en index.html o con http.server no hay /lan.json y el botón no se muestra.
 * El QR usa qrcode-generator (MIT) desde cdnjs; si no carga, igual se muestra la dirección escrita.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ui = {
    button: $('btn-share'), dialog: $('share-dialog'), close: $('share-close'), qr: $('share-qr'),
    url: $('share-url'), copy: $('share-copy'), copyStatus: $('share-copy-status'),
    camera: $('share-camera-note'), plain: $('share-plain'), local: $('share-local'),
  };
  if (!ui.button || !ui.dialog) return;
  const { t } = AxonI18n;   // textos en i18n/common.js (ADR-030)

  function renderQr(url) {
    if (typeof window.qrcode !== 'function') {
      const p = document.createElement('p');
      p.className = 'share-qr-missing';
      p.textContent = t('share.qrMissing');
      ui.qr.replaceChildren(p);
      return;
    }
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    ui.qr.innerHTML = qr.createSvgTag(6, 2);           // SVG del generador, sin texto de la interfaz
    const svg = ui.qr.querySelector('svg');
    if (svg) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', t('share.qrLabel', { url }));
    }
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      ui.copyStatus.textContent = t('share.copied');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(ui.url);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ui.copyStatus.textContent = t('share.selected');
    }
  }

  async function init() {
    let info;
    try {
      const res = await fetch('/lan.json', { cache: 'no-store' });
      if (!res.ok) return;
      info = await res.json();
    } catch {
      return;                                               // abierto con doble clic o sin serve.py
    }
    const target = info.lan_https || info.lan_http;
    if (!target) return;
    ui.url.textContent = target;
    ui.camera.hidden = !info.lan_https;
    ui.plain.hidden = !(info.lan_https && info.lan_http);
    if (info.lan_http) ui.plain.querySelector('code').textContent = info.lan_http;
    ui.local.querySelector('code').textContent = info.local;
    ui.button.hidden = false;
    ui.button.addEventListener('click', () => {
      renderQr(target);
      ui.copyStatus.textContent = '';
      if (typeof ui.dialog.showModal === 'function') ui.dialog.showModal();
      else ui.dialog.setAttribute('open', '');
    });
    ui.close.addEventListener('click', () => ui.dialog.close());
    ui.dialog.addEventListener('click', (e) => { if (e.target === ui.dialog) ui.dialog.close(); });
    ui.copy.addEventListener('click', () => copyUrl(target));
  }

  init();
})();
