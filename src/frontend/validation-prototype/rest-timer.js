/* AXONFAS · descanso recomendado entre series (ADR-022). Es una cuenta regresiva que el paciente puede saltar o alargar:
 * nunca bloquea el siguiente paso ni forma parte del sobre de seguridad. El valor lo recomienda el fisioterapeuta; sin
 * valor se sugiere 60 s, un valor de partida y no clínico (TD-87).
 *
 *   createRest({ seconds, now })  → lógica pura (testeable): tick(t) → { left, done }, skip(), extend(s)
 *   text(rest)                    → frase del descanso, según sea el de partida, un valor o un rango
 *   mount(container, opts)        → cuenta en pantalla con "Saltar descanso" y "+30 s"
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonRest = api;
}(typeof self !== 'undefined' ? self : this, (root) => {
  'use strict';

  const I18N = (typeof self !== 'undefined' && self.AxonI18n) || require('./i18n.js');   // textos (ADR-030)
  const t = I18N.t;

  const DEFAULT_SECONDS = 60;     // el mismo valor que REST_DEFAULT_SECONDS de catalog.js y de la API
  const EXTEND_SECONDS = 30;

  function createRest({ seconds, now = 0 }) {
    let endAt = now + seconds * 1000;
    let skipped = false;
    return {
      /** t en milisegundos: segundos que faltan (redondeados hacia arriba) y si terminó. */
      tick(t) {
        const left = Math.max(0, Math.ceil((endAt - t) / 1000));
        return { left: skipped ? 0 : left, done: skipped || left === 0 };
      },
      skip() { skipped = true; },
      extend(s) { if (!skipped) endAt += s * 1000; },
      get state() { return skipped ? 'skipped' : 'running'; },
    };
  }

  function text(rest) {
    const r = rest || { min: DEFAULT_SECONDS, max: DEFAULT_SECONDS, default: true };
    if (r.default) return t('rest.default', { s: r.min });
    if (r.min === r.max) return t('rest.therapist', { s: r.min });
    return t('rest.range', { min: r.min, max: r.max });
  }

  /** opts: { rest: { min, max, default }, speak(text), onEnd() }. Devuelve { stop() }. */
  function mount(container, opts = {}) {
    const doc = container.ownerDocument;
    const node = (tag, cls, content) => { const x = doc.createElement(tag); if (cls) x.className = cls; if (content != null) x.textContent = content; return x; };
    const rest = opts.rest || { min: DEFAULT_SECONDS, max: DEFAULT_SECONDS, default: true };
    const clock = () => (root.performance ? root.performance.now() : Date.now());
    const timer = createRest({ seconds: rest.min, now: clock() });
    container.replaceChildren();

    const box = node('div', 'panel-card stack');
    const big = node('div', 'guided-big', String(rest.min));
    big.setAttribute('aria-hidden', 'true');                // no se lee cada segundo; el estado anuncia solo inicio y fin
    const status = node('p', 'status-line', t('rest.canSkip', { text: text(rest) }));
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = node('div', 'guided-actions');
    const skip = node('button', 'btn', t('rest.skip'));
    skip.type = 'button';
    const more = node('button', 'btn', t('rest.extend', { s: EXTEND_SECONDS }));
    more.type = 'button';
    more.setAttribute('aria-label', t('rest.extendLabel', { s: EXTEND_SECONDS }));   // empieza con el texto visible (WCAG 2.5.3)
    actions.append(skip, more);
    box.append(big, status, actions);
    container.appendChild(box);

    let interval = 0;
    let ended = false;
    const finish = (message) => {
      if (ended) return;
      ended = true;
      clearInterval(interval);
      const hadFocus = box.contains(doc.activeElement);       // p. ej. quien pulsó "Saltar descanso" con el teclado
      status.textContent = message;
      if (opts.speak) opts.speak(message);
      container.replaceChildren(status);                      // se quita la cuenta; el aviso queda a la vista
      if (hadFocus) { status.tabIndex = -1; status.focus(); } // el foco no se pierde en el <body> al quitar los botones
      if (opts.onEnd) opts.onEnd();
    };
    const update = () => {
      const { left, done } = timer.tick(clock());
      big.textContent = String(left);
      if (done) finish(t('rest.over'));
    };
    skip.addEventListener('click', () => { timer.skip(); finish(t('rest.skipped')); });
    more.addEventListener('click', () => { timer.extend(EXTEND_SECONDS); update(); });
    interval = setInterval(update, 250);
    if (opts.speak) opts.speak(text(rest));
    return { stop() { ended = true; clearInterval(interval); container.replaceChildren(); } };
  }

  return { DEFAULT_SECONDS, EXTEND_SECONDS, createRest, text, mount };
}));
