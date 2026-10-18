/* AXONFAS · formulario "Tengo una molestia" del paciente (ADR-021, ADR-025). Lo que se elige viaja a
 * POST /api/me/discomfort y el motor de reglas decide (alarma → detener; molestia → registrar y bajar la exigencia dentro
 * del sobre, o pausar). Durante una sesión y con texto escrito (opts.turn) viaja a POST /api/me/turn: las reglas deciden
 * primero y, si la IA de AMD está conectada, el agente clínico propone una baja que las reglas validan. El mensaje y la
 * frase de atribución (aiLine) salen solo de la respuesta de la API; aquí no se decide nada clínico.
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
  const DEFAULT_WAIT_S = 25;                                      // la espera del navegador: siempre más que la del servidor (/api/me la trae)
  // La espera solo nombra al asistente de AMD si /api/me dijo que está disponible (TD-34); si no, solo las reglas.
  const WAITING_AI = 'El asistente de AMD está revisando lo que dijiste…';
  const WAITING_RULES = 'Revisando lo que dijiste con las reglas de seguridad…';
  const NO_REPLY = 'No llegó la respuesta. Si sientes dolor fuerte, mareo o pérdida de fuerza, toca «Dolor: detener».';

  /** Segundos con coma decimal: 1240 → "1,2". */
  const seconds = (ms) => (ms / 1000).toFixed(1).replace('.', ',');

  /**
   * Frase de atribución de un turno (TD-34), armada solo con `res.ai`: dice qué modelo respondió y en cuánto, o que
   * respondieron las reglas de seguridad de AXONFAS. El proveedor y el modelo salen de los datos; nunca se escriben a
   * mano. El motivo exacto (tiempo agotado, cupo…) queda solo en el panel del fisioterapeuta.
   */
  function aiLine(ai) {
    if (!ai) return '';
    const who = ai.provider || 'AMD';
    const model = ai.model || 'de IA';
    if (ai.decided_by === 'llm') {
      return `Lo propuso el modelo ${model} de ${who} en ${seconds(ai.clinical_ms)} s y lo validaron las reglas de seguridad.`
        + (ai.phrased_by === 'llm' ? ` Frase redactada por ${model}.` : '');
    }
    if (ai.llm_answered) {
      return `El asistente de AMD (${model}) revisó lo que dijiste en ${seconds(ai.clinical_ms)} s; se aplicó la baja de las reglas `
        + 'de seguridad de AXONFAS.' + (ai.phrased_by === 'llm' ? ` Frase redactada por ${model}.` : '');
    }
    if (ai.phrased_by === 'llm') {
      return `La decisión la tomaron las reglas de seguridad de AXONFAS; la frase la redactó el modelo ${model} de ${who}.`;
    }
    if (ai.skipped === 'red_flag') return 'La alarma siempre la deciden las reglas de seguridad de AXONFAS.';
    return 'Te respondieron las reglas de seguridad de AXONFAS.';
  }

  /** Aviso de datos personales ocultados antes de enviar el texto (ADR-026), o ''. */
  function privacyLine(privacy) {
    const n = privacy && Number(privacy.redactions);
    if (!n || n < 1) return '';
    return n === 1 ? 'Ocultamos 1 dato personal antes de enviarlo.' : `Ocultamos ${n} datos personales antes de enviarlo.`;
  }

  /** Lo que se le dice al paciente bajo el campo de texto, según lo que /api/me dijo del asistente. */
  const noteText = (assistant) => (assistant && assistant.available
    ? 'Lo revisan las reglas de seguridad de AXONFAS y el asistente de AMD. Se envía sin tu nombre; ocultamos correos, teléfonos y documentos.'
    : 'Lo revisan las reglas de seguridad de AXONFAS.');

  /**
   * render(container, { exerciseId, inSession, current, turn, recent, assistant, onResult })
   * - inSession: booleano o función que dice si hay una sesión en curso en este momento.
   * - current: función que devuelve { rom_target?, reps? } del ejercicio en curso, o null.
   * - turn: true si, en sesión y con texto, el aviso va al turno con el agente clínico (POST /api/me/turn).
   * - recent: función que devuelve las últimas repeticiones { index, kneeRom, peakTrunk } para el contexto del agente.
   * - assistant: lo que trajo /api/me ({ available, wait_s }): elige el texto de espera y cuánto espera el navegador.
   * - onResult(res): recibe la respuesta de la API ({ report, action, adjustment, stop, message, turn?, decision?, ai? }).
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
    const note = node('p', 'muted', noteText(opts.assistant));
    note.id = `symptom-note-${n}`;
    note.hidden = true;
    text.setAttribute('aria-describedby', note.id);
    field.append(textLabel, text, note);
    const send = node('button', 'btn primary', 'Avisar a mi fisioterapeuta');
    send.type = 'submit';
    form.append(group, field, send);

    const status = node('p', 'status-line');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const alert = node('p', 'status-line');                     // una alarma o un fallo se anuncian de inmediato
    alert.setAttribute('role', 'alert');
    const aiNote = node('p', 'muted');                           // quién respondió (TD-34)
    aiNote.id = `symptom-ai-${n}`;
    aiNote.setAttribute('aria-live', 'polite');                  // también se anuncia quién respondió
    container.append(toggle, form, status, alert, aiNote);
    const waitMs = () => ((opts.assistant && Number(opts.assistant.wait_s)) || DEFAULT_WAIT_S) * 1000;
    const sessionNow = () => (typeof opts.inSession === 'function' ? Boolean(opts.inSession()) : Boolean(opts.inSession));
    const say = (msg, urgent) => {
      status.textContent = urgent ? '' : msg;
      alert.textContent = urgent ? msg : '';
    };

    const close = (focus) => {
      form.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (focus) toggle.focus();
    };
    toggle.addEventListener('click', () => {
      const open = form.hidden;
      form.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        say('');
        aiNote.textContent = '';
        note.hidden = !(opts.turn && sessionNow());
        legend.focus();
      }
    });
    form.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(true); } });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const picked = form.querySelector('input[type="radio"]:checked');
      const body = { in_session: sessionNow() };
      if (opts.exerciseId) body.exercise_id = opts.exerciseId;
      if (picked) body.option = picked.value;
      if (text.value.trim()) body.text = text.value.trim();
      const current = opts.current ? opts.current() : null;
      if (current) body.current = current;
      if (!body.option && !body.text) { say('Cuéntanos qué sientes: elige una opción o escribe una frase.'); return; }
      const useTurn = Boolean(opts.turn && body.in_session && body.text && body.exercise_id);
      if (useTurn) {
        const recent = opts.recent ? opts.recent() : null;
        if (recent && recent.length) body.recent_reps = recent;
      }
      send.disabled = true;
      form.setAttribute('aria-busy', 'true');
      aiNote.textContent = '';
      say(useTurn ? (opts.assistant && opts.assistant.available ? WAITING_AI : WAITING_RULES) : 'Enviando…');
      try {
        const res = useTurn
          ? await root.AxonApi.call('patient', 'POST', '/api/me/turn', body, { timeoutMs: waitMs() })
          : await root.AxonApi.call('patient', 'POST', '/api/me/discomfort', body);
        say(res.message, res.stop);
        aiNote.textContent = useTurn ? [aiLine(res.ai), privacyLine(res.privacy)].filter(Boolean).join(' ') : '';
        form.reset();
        close(true);
        if (opts.onResult) opts.onResult(res);
      } catch (err) {
        // El texto se conserva para reenviarlo y no se reintenta solo: reenviar podría duplicar el aviso (TD-107).
        say(useTurn && err.status === 0 ? NO_REPLY : err.message, useTurn && err.status === 0);
      } finally {
        send.disabled = false;
        form.removeAttribute('aria-busy');
      }
    });
    return { toggle, form, status };
  }

  return { OPTIONS, aiLine, privacyLine, noteText, render };
}));
