/* AXONFAS · Nivel 1: descargo médico y triaje de banderas rojas antes de las rutinas de autogestión (ADR-023, TD-95).
 *
 * Quien usa la galería, el seguimiento libre o el Prototipo sin un plan de su fisioterapeuta primero acepta el descargo
 * y responde el cuestionario. Una sola bandera roja bloquea esas rutinas en este equipo y recomienda urgencias o una
 * consulta; las banderas amarillas (miedo a moverse, catastrofismo) no bloquean: solo hacen más cuidadoso el tono.
 * Reglas fijas, sin IA (I-17). Las respuestas no salen del navegador y no se guardan: solo queda el resultado
 * (`clear` o `blocked`), su vencimiento y el tono, en localStorage (`axonfas.triage`).
 * Exentos: el modo paciente (`?plan=` con cuenta de paciente: su fisioterapeuta ya lo evaluó, Nivel 2) y las cuentas de
 * fisioterapeuta y Administrador. Una página entera entra al triaje con <script src="triage.js" data-gate="self-care">;
 * una página abierta (el Prototipo) lo pide al encender la cámara con `AxonTriage.ensure()` (ADR-028).
 * Funciones puras en Node y navegador; la pantalla, solo en el navegador. Valores de partida, a validar (TD-98).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonTriage = api;
}(typeof self !== 'undefined' ? self : this, (root) => {
  'use strict';

  const VERSION = 1;                 // sube si cambian las preguntas: obliga a responder de nuevo
  const STORE_KEY = 'axonfas.triage';
  const CLEAR_DAYS = 7;              // un triaje sin banderas vale una semana
  const BLOCK_HOURS = 24;            // con una bandera roja, no se puede volver a responder antes de esto
  const HOUR = 3600 * 1000;

  // Textos en el idioma de la interfaz (ADR-030), leídos al cargar (cambiar de idioma recarga la página). El inglés dice
  // exactamente lo mismo que el español: lo revisa triage.test.cjs. Los ids y lo que se guarda no se traducen.
  const I18N = (typeof self !== 'undefined' && self.AxonI18n) || require('./i18n.js');
  const t = I18N.t;
  const tn = I18N.tn;

  const DISCLAIMER = [
    t('triage.disclaimer.1'),
    t('triage.disclaimer.2'),
    t('triage.disclaimer.3'),
    t('triage.disclaimer.4'),
    t('triage.disclaimer.5'),
  ];
  const DISCLAIMER_ACCEPT = t('triage.accept');

  // Banderas rojas: las seis del estudio de tele-rehabilitación (TD-95) y dos de las guías habituales de fisioterapia
  // (infección y déficit neurológico que avanza). Cualquiera bloquea.
  const RED_FLAGS = [
    { id: 'sphincter', text: t('triage.red.sphincter'), source: 'study' },
    { id: 'saddle', text: t('triage.red.saddle'), source: 'study' },
    { id: 'cancer', text: t('triage.red.cancer'), source: 'study' },
    { id: 'weight_loss', text: t('triage.red.weight_loss'), source: 'study' },
    { id: 'trauma', text: t('triage.red.trauma'), source: 'study' },
    { id: 'night_pain', text: t('triage.red.night_pain'), source: 'study' },
    { id: 'fever', text: t('triage.red.fever'), source: 'guideline' },
    { id: 'neuro', text: t('triage.red.neuro'), source: 'guideline' },
  ];
  // Banderas amarillas (psicosociales): opcionales y nunca bloquean.
  const YELLOW_FLAGS = [
    { id: 'fear', text: t('triage.yellow.fear') },
    { id: 'catastrophizing', text: t('triage.yellow.catastrophizing') },
    { id: 'avoidance', text: t('triage.yellow.avoidance') },
  ];

  // Urgencias: SAMU (106) en Perú o el número de emergencias del país, en los dos idiomas.
  const MESSAGES = {
    blockedTitle: t('triage.msg.blockedTitle'),
    blocked: t('triage.msg.blocked'),
    blockedPatient: t('triage.msg.blockedPatient'),
    clear: t('triage.msg.clear'),
    gentle: t('triage.msg.gentle'),
  };

  /**
   * answers: { [id]: 'yes' | 'no' }. Todas las rojas son obligatorias; las amarillas, no.
   * → { status: 'incomplete' | 'blocked' | 'clear', missing, red, yellow, tone: 'standard' | 'gentle' }
   */
  function evaluate(answers) {
    const a = answers || {};
    const missing = RED_FLAGS.filter((f) => a[f.id] !== 'yes' && a[f.id] !== 'no').map((f) => f.id);
    const red = RED_FLAGS.filter((f) => a[f.id] === 'yes').map((f) => f.id);
    const yellow = YELLOW_FLAGS.filter((f) => a[f.id] === 'yes').map((f) => f.id);
    // Una bandera roja marcada basta para bloquear, aunque falten otras por responder.
    const status = red.length ? 'blocked' : missing.length ? 'incomplete' : 'clear';
    return { status, missing, red, yellow, tone: yellow.length ? 'gentle' : 'standard' };
  }

  /** Lo único que se guarda: resultado, vencimiento y tono. Nunca qué se respondió. */
  function record(result, now = Date.now()) {
    if (!result || (result.status !== 'clear' && result.status !== 'blocked')) return null;
    const ms = result.status === 'blocked' ? BLOCK_HOURS * HOUR : CLEAR_DAYS * 24 * HOUR;
    return { v: VERSION, status: result.status, until: new Date(now + ms).toISOString(), tone: result.tone || 'standard' };
  }

  /** 'needed' (sin triaje vigente) | 'blocked' | 'clear'. */
  function gateState(rec, now = Date.now()) {
    if (!rec || rec.v !== VERSION || (rec.status !== 'clear' && rec.status !== 'blocked')) return 'needed';
    const until = Date.parse(rec.until);
    if (!Number.isFinite(until) || now >= until) return 'needed';
    return rec.status;
  }

  /** ¿Esta visita pasa por el triaje? No en el modo paciente ni con cuenta de fisioterapeuta o Administrador. */
  function exempt({ search = '', hasAccount = () => false } = {}) {
    const params = new URLSearchParams(search);
    if (params.has('plan') && hasAccount('patient')) return true;
    return hasAccount('therapist') || hasAccount('admin');
  }

  // ------------------------------------------------------------------ almacenamiento (solo navegador)
  function load() {
    try { return JSON.parse(root.localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
  }
  function save(rec) {
    try {
      if (rec) root.localStorage.setItem(STORE_KEY, JSON.stringify(rec));
      else root.localStorage.removeItem(STORE_KEY);
    } catch { /* sin almacenamiento: el triaje se pide en cada visita */ }
  }
  const hasAccount = (role) => {
    try { return !!(root.AxonApi ? root.AxonApi.load(role) : root.localStorage.getItem(`axonfas.${role}`)); } catch { return false; }
  };

  // ------------------------------------------------------------------ pantalla (solo navegador)
  let counter = 0;

  /**
   * mount(host, { onClear(rec), onBlocked() }): dibuja el descargo, el cuestionario y el resultado dentro de `host`.
   * Si ya hay un bloqueo vigente, va directo a la pantalla de bloqueo.
   */
  function mount(host, opts = {}) {
    const doc = host.ownerDocument;
    const n = (counter += 1);
    const node = (tag, cls, text) => { const x = doc.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    const section = node('section', 'panel-card triage');
    section.setAttribute('aria-labelledby', `triage-title-${n}`);
    host.replaceChildren(section);
    const answers = {};

    function screen(title, ...children) {
      const h = node('h2', 'page-title', title);
      h.id = `triage-title-${n}`;
      h.tabIndex = -1;
      section.replaceChildren(h, ...children);
      h.focus();
    }

    function disclaimer() {
      const intro = node('p', 'page-lede', t('triage.intro'));
      const list = node('ul', 'triage-list');
      DISCLAIMER.forEach((t) => list.appendChild(node('li', null, t)));
      const label = node('label', 'check');
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.id = `triage-accept-${n}`;
      label.append(box, node('span', null, DISCLAIMER_ACCEPT));
      const go = node('button', 'btn primary', t('triage.continue'));
      go.type = 'button';
      go.disabled = true;
      box.addEventListener('change', () => { go.disabled = !box.checked; });
      go.addEventListener('click', () => { if (box.checked) questions(); });
      screen(t('triage.before.title'), intro, list, label, go);
    }

    function group(flag, required) {
      const fs = node('fieldset', 'profile-group triage-q');
      fs.dataset.flag = flag.id;
      const legend = node('legend', null, flag.text);
      fs.appendChild(legend);
      const row = node('div', 'triage-yn');
      [['yes', t('triage.yes')], ['no', t('triage.no')]].forEach(([value, text]) => {
        const label = node('label', 'check');
        const radio = doc.createElement('input');
        radio.type = 'radio';
        radio.name = `triage-${n}-${flag.id}`;
        radio.value = value;
        if (required) radio.required = true;
        if (answers[flag.id] === value) radio.checked = true;
        radio.addEventListener('change', () => { answers[flag.id] = value; fs.classList.remove('missing'); });
        label.append(radio, node('span', null, text));
        row.appendChild(label);
      });
      fs.appendChild(row);
      return fs;
    }

    function questions() {
      const form = node('form', 'profile-form');
      form.noValidate = true;
      form.appendChild(node('p', 'muted', t('triage.q.note')));
      form.appendChild(node('h3', 'triage-sub', t('triage.q.red')));
      RED_FLAGS.forEach((f) => form.appendChild(group(f, true)));
      form.appendChild(node('h3', 'triage-sub', t('triage.q.yellow')));
      YELLOW_FLAGS.forEach((f) => form.appendChild(group(f, false)));
      const status = node('p', 'triage-status');
      status.setAttribute('role', 'status');
      const send = node('button', 'btn primary', t('triage.q.send'));
      send.type = 'submit';
      form.append(status, send);
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const res = evaluate(answers);
        if (res.status === 'incomplete') {
          res.missing.forEach((id) => { const fs = form.querySelector(`[data-flag="${id}"]`); if (fs) fs.classList.add('missing'); });
          status.textContent = tn('triage.q.missing', res.missing.length);
          const first = form.querySelector('.triage-q.missing input');
          if (first) first.focus();
          return;
        }
        if (res.status === 'blocked') confirmRed(res);
        else finish(res);
      });
      screen(t('triage.q.title'), form);
    }

    /** Con una bandera roja, se pide confirmar: un toque equivocado no debe bloquear, ni pasar de largo. */
    function confirmRed(res) {
      const p = node('p', 'page-lede', t('triage.confirm.lede'));
      const list = node('ul', 'triage-list');
      res.red.forEach((id) => list.appendChild(node('li', null, RED_FLAGS.find((f) => f.id === id).text)));
      const ok = node('button', 'btn danger', t('triage.confirm.ok'));
      ok.type = 'button';
      ok.addEventListener('click', () => finish(res));
      const back = node('button', 'btn', t('triage.confirm.fix'));
      back.type = 'button';
      back.addEventListener('click', questions);
      const row = node('div', 'triage-actions');
      row.append(ok, back);
      screen(t('triage.confirm.title'), p, list, row);
    }

    function finish(res) {
      const rec = record(res);
      save(rec);
      if (res.status === 'blocked') { blocked(); if (opts.onBlocked) opts.onBlocked(); return; }
      if (opts.onClear) opts.onClear(rec);
    }

    function blocked() {
      const alert = node('div', 'triage-alert');
      alert.setAttribute('role', 'alert');
      alert.append(node('p', null, MESSAGES.blocked));
      const patient = node('p', null, `${MESSAGES.blockedPatient} `);
      const link = node('a', null, t('triage.blocked.asPatient'));
      link.href = 'paciente.html';
      patient.appendChild(link);
      const rec = load();
      const until = rec && rec.until ? new Date(rec.until) : null;
      const when = until && Number.isFinite(until.getTime())
        ? t('triage.blocked.until', { date: until.toLocaleString(I18N.locale(), { dateStyle: 'long', timeStyle: 'short' }) }).replace(/\.\.$/, '.')
        : t('triage.blocked.tomorrow');
      const extra = [];
      if (opts.onBack) {                                     // puerta "camera" (ADR-028): se puede volver al demo sin cámara
        const back = node('button', 'btn', opts.backText || t('triage.back'));
        back.type = 'button';
        back.addEventListener('click', opts.onBack);
        extra.push(back);
      }
      screen(MESSAGES.blockedTitle, alert, patient, node('p', 'muted', when), ...extra);
    }

    if (gateState(load()) === 'blocked') blocked();
    else disclaimer();
    return { section };
  }

  /**
   * Puerta de la página: oculta el contenido de `.wrap` hasta que haya un triaje vigente sin banderas rojas. Con un
   * bloqueo vigente, muestra la pantalla de bloqueo. Lo exento pasa de largo.
   */
  function gate(doc = root.document) {
    if (exempt({ search: root.location ? root.location.search : '', hasAccount })) return 'exempt';
    const rec = load();
    const state = gateState(rec);
    if (state === 'clear') { toneNote(doc, rec); return 'clear'; }
    showGate(doc, {});
    return state;
  }

  /** Oculta el contenido de `.wrap` y muestra el triaje en su lugar. opts: { onClear, onBlocked, onBack, backText }. */
  function showGate(doc, opts) {
    const wrap = doc.querySelector('.wrap');
    if (!wrap) return;
    const hidden = Array.from(wrap.children).filter((el) => !el.hidden);
    hidden.forEach((el) => { el.hidden = true; });
    const host = doc.createElement('main');
    host.id = 'triage';
    host.tabIndex = -1;
    wrap.prepend(host);
    const skip = doc.querySelector('.skip-link');
    const skipHref = skip && skip.getAttribute('href');
    if (skip) skip.setAttribute('href', '#triage');
    const restore = () => {
      host.remove();
      hidden.forEach((el) => { el.hidden = false; });
      if (skip && skipHref) skip.setAttribute('href', skipHref);
    };
    mount(host, {
      onClear(next) {
        restore();
        toneNote(doc, next, true);
        if (opts.onClear) opts.onClear(next);
      },
      onBlocked: opts.onBlocked,
      onBack: opts.onBack ? () => { restore(); opts.onBack(); } : null,
      backText: opts.backText,
    });
  }

  /**
   * Puerta en el momento de hacer ejercicio (ADR-028): la página queda abierta (la demo sintética, la galería) y el
   * triaje se pide al encender la cámara. Promesa: true si se puede seguir; false si hay una bandera roja o la persona
   * vuelve atrás. Exentos y triaje vigente pasan sin mostrar nada.
   */
  function ensure(doc = root.document, { backText = t('triage.backNoCamera') } = {}) {
    if (exempt({ search: root.location ? root.location.search : '', hasAccount })) return Promise.resolve(true);
    if (gateState(load()) === 'clear') return Promise.resolve(true);
    return new Promise((resolve) => {
      showGate(doc, { onClear: () => resolve(true), onBlocked: () => resolve(false), onBack: () => resolve(false), backText });
    });
  }

  /** Mensaje al pasar el triaje; con banderas amarillas, el tono cuidadoso se mantiene mientras el triaje esté vigente. */
  function toneNote(doc, rec, justNow = false) {
    if (!rec || (!justNow && rec.tone !== 'gentle')) return;
    const wrap = doc.querySelector('.wrap');
    if (!wrap) return;
    const note = doc.createElement('p');
    note.className = 'notice triage-tone';
    note.setAttribute('role', 'status');
    note.textContent = rec.tone === 'gentle' ? MESSAGES.gentle : MESSAGES.clear;
    wrap.prepend(note);
  }

  /** El tono vigente ('standard' | 'gentle'), para que otras pantallas adapten sus mensajes. */
  const tone = () => { const rec = load(); return gateState(rec) === 'clear' && rec.tone === 'gentle' ? 'gentle' : 'standard'; };

  if (root.document && root.document.currentScript && root.document.currentScript.dataset.gate) {
    const run = () => gate(root.document);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  return {
    VERSION, STORE_KEY, CLEAR_DAYS, BLOCK_HOURS, DISCLAIMER, DISCLAIMER_ACCEPT, RED_FLAGS, YELLOW_FLAGS, MESSAGES,
    evaluate, record, gateState, exempt, mount, gate, ensure, tone, load, save,
  };
}));
