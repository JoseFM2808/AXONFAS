/* AXONFAS · idioma de la interfaz según la región del navegador (ADR-030).
 *
 * Detección sin servicios externos: la elección manual guardada (`axonfas.lang`) gana; si no hay, el primer idioma de
 * `navigator.languages` que tengamos (es-* → español, en-* → inglés); el resto → inglés. La zona horaria (`Intl`) solo
 * desempata cuando el navegador no declara idiomas. Nunca se consulta la IP (ADR-003, TD-14).
 *
 * Diccionarios: cada archivo de `i18n/` es un paquete `{ es: {clave: texto}, en: {...} }` (y opcionalmente
 * `data: { nombre: { en: {...} } }` para traducir datos como el catálogo). Las páginas cargan los paquetes ANTES que este
 * archivo y este archivo los recoge, traduce el HTML (`data-i18n`) y pone el selector en la cabecera. En Node lee la
 * carpeta `i18n/` entera. Sumar un idioma: añadirlo a LANGS y su bloque en cada paquete (lo que falte cae al español).
 *
 * HTML: `data-i18n="clave"` cambia el texto; `data-i18n-aria-label`, `-title`, `-placeholder`, `-alt`, `-content`
 * cambian ese atributo. Un texto con elementos dentro usa `{nombre}` en el diccionario y `data-i18n-slot="nombre"` en el
 * hijo, que se conserva (con su id y sus eventos). Nunca innerHTML: todo es texto o nodos.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    // Node (tests): carga todos los paquetes de i18n/.
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, 'i18n');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) api.add(require(path.join(dir, f)));
    module.exports = api;
  } else {
    root.AxonI18n = api;
    for (const pack of root.AXONFAS_I18N || []) api.add(pack);
    root.AXONFAS_I18N = { push: (pack) => api.add(pack) };   // un paquete cargado después también entra
    if (root.document) api.start(root.document);
  }
}(typeof self !== 'undefined' ? self : this, (root) => {
  'use strict';

  const BASE = 'es';
  const STORE_KEY = 'axonfas.lang';
  // Idiomas activos. `speech` = voz de speechSynthesis; `locale` = fechas y números. Para sumar portugués:
  // pt: { name: 'Português', short: 'PT', speech: 'pt-BR', locale: 'pt-BR' } y su bloque `pt` en cada paquete.
  const LANGS = {
    es: { name: 'Español', short: 'ES', speech: 'es-PE', locale: 'es-PE' },
    en: { name: 'English', short: 'EN', speech: 'en-US', locale: 'en-US' },
  };
  const FALLBACK = 'en';   // un navegador en un idioma que no tenemos ve inglés
  // Zonas horarias de países de habla hispana: solo pista cuando el navegador no declara idiomas.
  const ES_TZ = /^America\/(Lima|Bogota|Mexico_City|Monterrey|Merida|Cancun|Chihuahua|Hermosillo|Mazatlan|Tijuana|Santiago|Punta_Arenas|Argentina\/.+|Buenos_Aires|Caracas|Guayaquil|La_Paz|Asuncion|Montevideo|Panama|Costa_Rica|Managua|Tegucigalpa|El_Salvador|Guatemala|Santo_Domingo|Havana|Puerto_Rico)$|^Europe\/Madrid$|^Atlantic\/Canary$|^Africa\/(Ceuta|Malabo)$|^Pacific\/Galapagos$/;
  const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'content'];

  const dicts = {};
  const data = {};
  for (const l of Object.keys(LANGS)) dicts[l] = {};

  function add(pack) {
    if (!pack || typeof pack !== 'object') return;
    for (const [l, entries] of Object.entries(pack)) {
      if (l === 'data') {
        for (const [name, byLang] of Object.entries(entries)) data[name] = Object.assign(data[name] || {}, byLang);
      } else if (dicts[l]) Object.assign(dicts[l], entries);
    }
  }

  const supported = (l) => Object.prototype.hasOwnProperty.call(LANGS, l);
  const baseOf = (tag) => String(tag || '').toLowerCase().split(/[-_]/)[0];

  /**
   * Idioma para este visitante. { stored, languages, timeZone } → 'es' | 'en' | …
   * 1) la elección manual guardada; 2) el primer idioma del navegador que tengamos; 3) un navegador con idiomas que no
   * tenemos → inglés; 4) sin idiomas declarados: la zona horaria (hispana → español); 5) sin ninguna señal → español.
   */
  function detect({ stored, languages, timeZone } = {}) {
    if (supported(stored)) return stored;
    const list = (Array.isArray(languages) ? languages : [languages]).filter(Boolean);
    for (const tag of list) if (supported(baseOf(tag))) return baseOf(tag);
    if (list.length) return FALLBACK;
    if (timeZone) return ES_TZ.test(timeZone) ? 'es' : FALLBACK;
    return BASE;
  }

  function readStored(store) {
    try { return store ? store.getItem(STORE_KEY) : null; } catch { return null; }
  }

  function browserSignals() {
    const nav = root.navigator;
    let timeZone = null;
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* sin Intl */ }
    let store = null;
    try { store = root.localStorage; } catch { /* almacenamiento bloqueado */ }
    return {
      stored: readStored(store),
      languages: nav ? (nav.languages && nav.languages.length ? Array.from(nav.languages) : [nav.language]) : [],
      timeZone,
    };
  }

  // En el navegador se decide al cargar; en Node arranca en español (los tests eligen con use()).
  let lang = root.navigator ? detect(browserSignals()) : BASE;

  /** Cambia el idioma en memoria (tests, o antes de pintar). No guarda nada. */
  function use(l) { if (supported(l)) lang = l; return lang; }

  /** Elección manual: se recuerda en este equipo y se recarga la página para que todo salga en el idioma nuevo. */
  function choose(l, { store, reload = true } = {}) {
    if (!supported(l)) return false;
    try { (store || root.localStorage).setItem(STORE_KEY, l); } catch { /* sin almacenamiento: vale solo esta vez */ }
    lang = l;
    if (reload && root.location) root.location.reload();
    return true;
  }

  const has = (key, l = lang) => Object.prototype.hasOwnProperty.call(dicts[l] || {}, key);
  const raw = (key) => (has(key) ? dicts[lang][key] : has(key, BASE) ? dicts[BASE][key] : key);
  const fmt = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s);

  /** Texto de una clave en el idioma actual, con {variables}. Si falta en el idioma, cae al español; si falta, la clave. */
  function t(key, vars) { return fmt(raw(key), vars); }

  /** Plural: usa `clave.one` o `clave.other` según n (Intl.PluralRules); {n} queda disponible. */
  function tn(key, n, vars = {}) {
    let cat = 'other';
    try { cat = new Intl.PluralRules(LANGS[lang].locale).select(n); } catch { cat = n === 1 ? 'one' : 'other'; }
    const k = has(`${key}.${cat}`) || has(`${key}.${cat}`, BASE) ? `${key}.${cat}` : `${key}.other`;
    return t(k, Object.assign({ n }, vars));
  }

  /**
   * Pone en `el` el texto de `key` sin innerHTML: cada {nombre} se reemplaza por vars[nombre]; si es un nodo del DOM, se
   * inserta tal cual (un enlace, un <strong> con id); si no, como texto.
   */
  function fill(el, key, vars = {}) {
    const doc = el.ownerDocument;
    const parts = raw(key).split(/(\{\w+\})/);
    const nodes = parts.filter((p) => p !== '').map((p) => {
      const m = /^\{(\w+)\}$/.exec(p);
      if (m && Object.prototype.hasOwnProperty.call(vars, m[1])) {
        const v = vars[m[1]];
        return v && typeof v === 'object' && v.nodeType ? v : doc.createTextNode(String(v));
      }
      return doc.createTextNode(p);
    });
    el.replaceChildren(...nodes);
    return el;
  }

  /** Traduce los data-i18n de `scope` (por defecto, el documento). */
  function apply(scope) {
    const doc = scope.ownerDocument || scope;
    for (const el of scope.querySelectorAll('[data-i18n]')) {
      const slots = {};
      for (const child of el.querySelectorAll('[data-i18n-slot]')) slots[child.getAttribute('data-i18n-slot')] = child;
      if (Object.keys(slots).length) fill(el, el.getAttribute('data-i18n'), slots);
      else el.textContent = t(el.getAttribute('data-i18n'));
    }
    for (const a of ATTRS) {
      for (const el of scope.querySelectorAll(`[data-i18n-${a}]`)) el.setAttribute(a, t(el.getAttribute(`data-i18n-${a}`)));
    }
    if (doc.documentElement) doc.documentElement.lang = lang;
  }

  /** Selector en la cabecera: un botón por idioma, con su nombre en ese idioma; el activo lleva aria-pressed. */
  function mountSwitch(doc) {
    const header = doc.querySelector('.top-header');
    if (!header || header.querySelector('.lang-switch')) return null;
    const box = doc.createElement('div');
    box.className = 'lang-switch';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', t('i18n.switch'));
    for (const [code, info] of Object.entries(LANGS)) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'lang-btn';
      b.lang = code;
      b.textContent = info.short;
      b.setAttribute('aria-label', info.name);   // contiene lo visible (ES ⊂ Español, EN ⊂ English): WCAG 2.5.3
      b.title = info.name;
      b.setAttribute('aria-pressed', String(code === lang));
      b.addEventListener('click', () => { if (code !== lang) choose(code); });
      box.append(b);
    }
    const nav = header.querySelector('.top-nav');
    if (nav && nav.nextSibling) header.insertBefore(box, nav.nextSibling); else header.append(box);
    return box;
  }

  function start(doc) {
    if (doc.documentElement) doc.documentElement.lang = lang;
    const run = () => { apply(doc); mountSwitch(doc); };
    // Las páginas cargan este archivo al final del <body>: el HTML ya está y se traduce antes que los demás scripts.
    if (doc.readyState === 'loading' && !doc.body) doc.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  }

  /** Traducción de datos (por ejemplo, el catálogo) para el idioma actual, o null si se usa el original en español. */
  const dataFor = (name, l = lang) => (l !== BASE && data[name] && data[name][l]) || null;

  return {
    BASE, STORE_KEY, LANGS, FALLBACK, ES_TZ,
    get lang() { return lang; },
    detect, use, choose, add, has, t, tn, fill, apply, mountSwitch, start, data: dataFor,
    keys: (l) => Object.keys(dicts[l] || {}),
    locale: () => LANGS[lang].locale,
    speechLang: () => LANGS[lang].speech,
    /** Voz del idioma actual entre las de speechSynthesis (o null: el navegador usa la de `speechLang()`). */
    voiceFor: (voices) => (voices || []).find((v) => v.lang && baseOf(v.lang) === lang) || null,
  };
}));
