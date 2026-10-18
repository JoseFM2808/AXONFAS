/* AXONFAS · formulario "Tengo una molestia" del paciente (ADR-021). Sin GPU y sin IA: lo que se elige o se escribe viaja a
 * POST /api/me/discomfort, y el motor de reglas decide (alarma → detener; molestia → registrar y bajar la exigencia dentro
 * del sobre, o pausar). El mensaje que se muestra lo trae la API; aquí no se decide nada clínico.
 * Se usa en paciente.html (plan y vista guiada), seguimiento.html e index.html?plan=. Nunca bloquea "Dolor: detener".
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonSymptom = api;
}(typeof self !== 'undefined' ? self : this, (root) => {
  'use strict';

  const I18N = (typeof self !== 'undefined' && self.AxonI18n) || require('./i18n.js');   // textos (ADR-030)
  const t = I18N.t;

  // Los ids son los de SYMPTOM_OPTIONS en staging_api.py (un test lo comprueba).
  const OPTIONS = [
    // El id viaja a la API; label y hint son lo que se ve, en el idioma de la interfaz.
    { id: 'pain_mild', label: t('symptom.opt.pain_mild') },
    { id: 'fatigue', label: t('symptom.opt.fatigue') },
    { id: 'cramp', label: t('symptom.opt.cramp') },
    { id: 'stiffness', label: t('symptom.opt.stiffness') },
    { id: 'red_flag', label: t('symptom.opt.red_flag'), hint: t('symptom.opt.red_flag.hint') },
  ];
  let counter = 0;

  /**
   * render(container, { exerciseId, inSession, current, onResult })
   * - inSession: booleano o función que dice si hay una sesión en curso en este momento.
   * - current: función que devuelve { rom_target?, reps? } del ejercicio en curso, o null.
   * - onResult(res): recibe la respuesta de la API ({ report, action, adjustment, stop, message }).
   */
  function render(container, opts = {}) {
    const doc = container.ownerDocument;
    const n = (counter += 1);
    const node = (tag, cls, text) => { const x = doc.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    container.replaceChildren();

    const toggle = node('button', 'btn', t('symptom.toggle'));
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', `symptom-form-${n}`);

    const form = node('form', 'profile-form');
    form.id = `symptom-form-${n}`;
    form.hidden = true;
    const group = node('fieldset', 'profile-group');
    const legend = node('legend', null, t('symptom.legend'));
    legend.tabIndex = -1;
    group.appendChild(legend);
    OPTIONS.forEach((o) => {
      const label = node('label', 'check');
      const radio = doc.createElement('input');
      radio.type = 'radio';
      radio.name = `symptom-option-${n}`;
      radio.value = o.id;
      label.append(radio, node('span', null, o.hint ? t('symptom.option', { label: o.label, hint: o.hint }) : o.label));
      group.appendChild(label);
    });
    const field = node('div', 'field');
    const textLabel = node('label', null, t('symptom.text'));
    textLabel.htmlFor = `symptom-text-${n}`;
    const text = doc.createElement('input');
    Object.assign(text, { type: 'text', id: `symptom-text-${n}`, maxLength: 200, autocomplete: 'off' });
    field.append(textLabel, text);
    const send = node('button', 'btn primary', t('symptom.send'));
    send.type = 'submit';
    form.append(group, field, send);

    const status = node('p', 'status-line');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    container.append(toggle, form, status);

    const close = (focus) => {
      form.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (focus) toggle.focus();
    };
    toggle.addEventListener('click', () => {
      const open = form.hidden;
      form.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) { status.textContent = ''; legend.focus(); }
    });
    form.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(true); } });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const picked = form.querySelector('input[type="radio"]:checked');
      const body = { in_session: typeof opts.inSession === 'function' ? Boolean(opts.inSession()) : Boolean(opts.inSession) };
      if (opts.exerciseId) body.exercise_id = opts.exerciseId;
      if (picked) body.option = picked.value;
      if (text.value.trim()) body.text = text.value.trim();
      const current = opts.current ? opts.current() : null;
      if (current) body.current = current;
      if (!body.option && !body.text) { status.textContent = t('symptom.empty'); return; }
      send.disabled = true;
      status.textContent = t('symptom.sending');
      try {
        const res = await root.AxonApi.call('patient', 'POST', '/api/me/discomfort', body);
        status.textContent = res.message;               // lo escribe el servidor (en español en esta etapa)
        form.reset();
        close(true);
        if (opts.onResult) opts.onResult(res);
      } catch (err) {
        status.textContent = err.message;
      } finally { send.disabled = false; }
    });
    return { toggle, form, status };
  }

  return { OPTIONS, render };
}));
