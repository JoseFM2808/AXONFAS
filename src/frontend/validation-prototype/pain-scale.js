/* AXONFAS · "¿Cuánto te duele?" al terminar una sesión: escala visual analógica (EVA) de 0 a 10 (ADR-025, TD-100).
 * Lo que el paciente marca viaja a PUT /api/sessions/<id>/pain y le llega al fisioterapeuta. Sin IA y sin decisiones
 * clínicas: el mensaje lo trae la API. Es opcional y nunca reemplaza "Dolor: detener" ni el formulario de molestias.
 * Se usa en paciente.html (vista guiada), seguimiento.html e index.html?plan=.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonPainScale = api;
}(typeof self !== 'undefined' ? self : this, (root) => {
  'use strict';

  const I18N = (typeof self !== 'undefined' && self.AxonI18n) || require('./i18n.js');   // textos (ADR-030)
  const t = I18N.t;

  const ANCHORS = { 0: t('eva.anchor.0'), 5: t('eva.anchor.5'), 10: t('eva.anchor.10') };
  let counter = 0;

  /**
   * render(container, { sessionId, exerciseName, onDone })
   * onDone(res | null): la respuesta de la API ({ pain_score, high, message }) o null si el paciente lo omitió.
   */
  function render(container, opts = {}) {
    const doc = container.ownerDocument;
    const n = (counter += 1);
    const node = (tag, cls, text) => { const x = doc.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    container.replaceChildren();
    container.hidden = false;

    const form = node('form', 'eva-form');
    const group = node('fieldset', 'eva-group');
    const legend = node('legend', null, opts.exerciseName ? t('eva.legendAfter', { name: opts.exerciseName }) : t('eva.legend'));
    legend.tabIndex = -1;
    const hint = node('p', 'muted', t('eva.hint'));
    hint.id = `eva-hint-${n}`;
    group.setAttribute('aria-describedby', hint.id);
    const scale = node('div', 'eva-scale');
    for (let v = 0; v <= 10; v += 1) {
      const label = node('label', 'eva-option');
      const radio = doc.createElement('input');
      radio.type = 'radio';
      radio.name = `eva-${n}`;
      radio.value = String(v);
      label.append(radio, node('span', 'eva-num', String(v)));
      if (ANCHORS[v]) radio.setAttribute('aria-label', `${v}: ${ANCHORS[v]}`);
      scale.appendChild(label);
    }
    const ends = node('div', 'eva-ends');
    ends.setAttribute('aria-hidden', 'true');                // lo mismo que dicen la pista y las etiquetas de 0 y 10
    ends.append(node('span', null, `0 · ${ANCHORS[0]}`), node('span', null, `10 · ${ANCHORS[10]}`));
    group.append(legend, hint, scale, ends);
    const actions = node('div', 'eva-actions');
    const send = node('button', 'btn primary', t('eva.send'));
    send.type = 'submit';
    const skip = node('button', 'btn', t('eva.skip'));
    skip.type = 'button';
    actions.append(send, skip);
    const status = node('p', 'status-line');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.append(group, actions, status);
    container.appendChild(form);
    legend.focus({ preventScroll: true });

    // Al cambiar el formulario por el resultado, el foco pasa al texto nuevo para no perderse (WCAG 2.4.3).
    const replaceWith = (p) => { p.tabIndex = -1; form.replaceChildren(p); p.focus({ preventScroll: true }); };
    const finish = (res) => { if (opts.onDone) opts.onDone(res); };
    skip.addEventListener('click', () => {
      replaceWith(node('p', 'muted', t('eva.skipped', { button: t('symptom.toggle') })));
      finish(null);
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const picked = form.querySelector('input[type="radio"]:checked');
      if (!picked) { status.textContent = t('eva.pick', { skip: t('eva.skip') }); return; }
      send.disabled = true;
      status.textContent = t('eva.saving');
      try {
        const res = await root.AxonApi.call('patient', 'PUT', `/api/sessions/${opts.sessionId}/pain`, { score: Number(picked.value) });
        const done = node('p', res.high ? 'notice' : 'muted', t('eva.done', { score: res.pain_score, message: res.message }));
        done.setAttribute('role', 'status');
        replaceWith(done);
        finish(res);
      } catch (err) {
        status.textContent = err.message;
        send.disabled = false;
      }
    });
    return { form, legend };
  }

  return { ANCHORS, render };
}));
