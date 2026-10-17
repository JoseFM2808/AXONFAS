/* AXONFAS · formulario "Tengo una molestia" del paciente (ADR-018). Sin GPU y sin IA: lo que se elige o se escribe viaja a
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

  // Los ids son los de SYMPTOM_OPTIONS en staging_api.py (un test lo comprueba).
  const OPTIONS = [
    { id: 'pain_mild', label: 'Dolor leve o pinchazo' },
    { id: 'fatigue', label: 'Cansancio' },
    { id: 'cramp', label: 'Calambre' },
    { id: 'stiffness', label: 'Rigidez' },
    { id: 'red_flag', label: 'Dolor fuerte, mareo o pérdida de fuerza', hint: 'Detiene la sesión' },
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

    const toggle = node('button', 'btn', 'Tengo una molestia');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', `symptom-form-${n}`);

    const form = node('form', 'profile-form');
    form.id = `symptom-form-${n}`;
    form.hidden = true;
    const group = node('fieldset', 'profile-group');
    const legend = node('legend', null, '¿Qué sientes?');
    legend.tabIndex = -1;
    group.appendChild(legend);
    OPTIONS.forEach((o) => {
      const label = node('label', 'check');
      const radio = doc.createElement('input');
      radio.type = 'radio';
      radio.name = `symptom-option-${n}`;
      radio.value = o.id;
      label.append(radio, node('span', null, o.hint ? `${o.label} (${o.hint})` : o.label));
      group.appendChild(label);
    });
    const field = node('div', 'field');
    const textLabel = node('label', null, 'Cuéntalo en pocas palabras (opcional; sin tu nombre ni datos personales)');
    textLabel.htmlFor = `symptom-text-${n}`;
    const text = doc.createElement('input');
    Object.assign(text, { type: 'text', id: `symptom-text-${n}`, maxLength: 200, autocomplete: 'off' });
    field.append(textLabel, text);
    const send = node('button', 'btn primary', 'Avisar a mi fisioterapeuta');
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
      if (!body.option && !body.text) { status.textContent = 'Cuéntanos qué sientes: elige una opción o escribe una frase.'; return; }
      send.disabled = true;
      status.textContent = 'Enviando…';
      try {
        const res = await root.AxonApi.call('patient', 'POST', '/api/me/discomfort', body);
        status.textContent = res.message;
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
