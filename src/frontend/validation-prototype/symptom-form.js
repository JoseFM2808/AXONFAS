/* AXONFAS · formulario "Tengo una molestia" del paciente (ADR-021, ADR-033). Lo que se elige viaja a
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
  const DEFAULT_WAIT_S = 25;                                      // la espera del navegador: siempre más que la del servidor (/api/me la trae)

  /** Segundos con un decimal en el formato del idioma: 1240 → "1,2" (es) o "1.2" (en). */
  const seconds = (ms) => (ms / 1000).toLocaleString(I18N.locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /**
   * Frase de atribución de un turno (TD-34), armada solo con `res.ai`: dice qué modelo respondió y en cuánto, o que
   * respondieron las reglas de seguridad de AXONFAS. El proveedor y el modelo salen de los datos; nunca se escriben a
   * mano. El motivo exacto (tiempo agotado, cupo…) queda solo en el panel del fisioterapeuta.
   */
  function aiLine(ai) {
    if (!ai) return '';
    const provider = ai.provider || t('symptom.ai.defaultProvider');
    const model = ai.model || t('symptom.ai.defaultModel');
    const phrased = ai.phrased_by === 'llm' ? t('symptom.ai.phrased', { model }) : '';
    if (ai.decided_by === 'llm') return [t('symptom.ai.llm', { model, provider, s: seconds(ai.clinical_ms) }), phrased].filter(Boolean).join(' ');
    if (ai.llm_answered) return [t('symptom.ai.reviewed', { model, s: seconds(ai.clinical_ms) }), phrased].filter(Boolean).join(' ');
    if (ai.phrased_by === 'llm') return t('symptom.ai.phraseOnly', { model, provider });
    if (ai.skipped === 'red_flag') return t('symptom.ai.alarm');
    return t('symptom.ai.rules');
  }

  /** Aviso de datos personales ocultados antes de enviar el texto (ADR-034), o ''. */
  function privacyLine(privacy) {
    const n = privacy && Number(privacy.redactions);
    return n >= 1 ? I18N.tn('symptom.privacy', n) : '';
  }

  /** Lo que se le dice al paciente bajo el campo de texto, según lo que /api/me dijo del asistente. */
  const noteText = (assistant) => t(assistant && assistant.available ? 'symptom.note.ai' : 'symptom.note.rules');

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
    const note = node('p', 'muted', noteText(opts.assistant));
    note.id = `symptom-note-${n}`;
    note.hidden = true;
    text.setAttribute('aria-describedby', note.id);
    field.append(textLabel, text, note);
    const send = node('button', 'btn primary', t('symptom.send'));
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
      if (!body.option && !body.text) { say(t('symptom.empty')); return; }
      const useTurn = Boolean(opts.turn && body.in_session && body.text && body.exercise_id);
      if (useTurn) {
        const recent = opts.recent ? opts.recent() : null;
        if (recent && recent.length) body.recent_reps = recent;
      }
      send.disabled = true;
      form.setAttribute('aria-busy', 'true');
      aiNote.textContent = '';
      say(useTurn ? (opts.assistant && opts.assistant.available ? t('symptom.wait.ai') : t('symptom.wait.rules')) : t('symptom.sending'));
      try {
        const res = useTurn
          ? await root.AxonApi.call('patient', 'POST', '/api/me/turn', body, { timeoutMs: waitMs() })
          : await root.AxonApi.call('patient', 'POST', '/api/me/discomfort', body);
        say(res.message, res.stop);                     // lo escribe el servidor en el idioma de la página (TD-116)
        aiNote.textContent = useTurn ? [aiLine(res.ai), privacyLine(res.privacy)].filter(Boolean).join(' ') : '';
        form.reset();
        close(true);
        if (opts.onResult) opts.onResult(res);
      } catch (err) {
        // El texto se conserva para reenviarlo y no se reintenta solo: reenviar podría duplicar el aviso (TD-122).
        say(useTurn && err.status === 0 ? t('symptom.noReply') : err.message, useTurn && err.status === 0);
      } finally {
        send.disabled = false;
        form.removeAttribute('aria-busy');
      }
    });
    return { toggle, form, status };
  }

  return { OPTIONS, aiLine, privacyLine, noteText, render };
}));
