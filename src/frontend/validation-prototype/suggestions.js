/* AXONFAS · sugerencias por rol (ADR-017). Navegador y Node.
 *
 * Dos destinatarios, dos reglas:
 *   forUser()      → para la persona que usa la plataforma (paciente o visitante): consejos de USO. Nunca cambian dosis
 *                    ni dan consejo clínico; lo clínico siempre remite al fisioterapeuta.
 *   forTherapist() → para el fisioterapeuta, a partir del perfil del paciente (limitaciones físicas, zonas con dolor)
 *                    y de sus datos: cambios de ejercicio, dosis y precauciones. Son PROPUESTAS: nada se aplica hasta
 *                    que el fisioterapeuta lo revisa y guarda el plan (ADR-005).
 * Ambas son reglas deterministas y explicables (cada sugerencia dice qué dato la originó). La IA (LLM en la GPU, si está
 * conectada) solo puede redactar un resumen de estas sugerencias; no agrega otras (src/agents/advisor.py).
 */
(function (root, factory) {
  const api = factory(root.AxonCatalog || (typeof require === 'function' ? require('./catalog.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonSuggest = api;
}(typeof self !== 'undefined' ? self : this, (C) => {
  'use strict';

  // Limitaciones que el paciente (o su fisioterapeuta) marca en el perfil. Los ids los valida también la API.
  const LIMITS = [
    { id: 'no_floor', label: 'No puedo acostarme en el suelo ni levantarme de él', other: 'No puede acostarse en el suelo ni levantarse de él' },
    { id: 'no_kneel', label: 'No puedo apoyarme en las rodillas', other: 'No puede apoyarse en las rodillas' },
    { id: 'no_standing', label: 'No puedo estar mucho tiempo de pie, o uso silla de ruedas', other: 'No puede estar mucho tiempo de pie, o usa silla de ruedas' },
    { id: 'balance', label: 'Me cuesta mantener el equilibrio o me he caído este año', other: 'Le cuesta mantener el equilibrio o se ha caído este año' },
    { id: 'walking_aid', label: 'Uso bastón o andador', other: 'Usa bastón o andador' },
    { id: 'arm_limited', label: 'Tengo limitado un brazo o un hombro', other: 'Tiene limitado un brazo o un hombro' },
    { id: 'no_band', label: 'No tengo banda elástica', other: 'No tiene banda elástica' },
    { id: 'low_vision', label: 'Veo poco: necesito letra grande o que me lean las indicaciones', other: 'Ve poco: necesita letra grande o que le lean las indicaciones' },
    { id: 'hearing', label: 'Oigo poco: necesito todo por escrito', other: 'Oye poco: necesita todo por escrito' },
  ];
  const PAIN_AREAS = [
    { id: 'knee', label: 'Rodilla' }, { id: 'hip', label: 'Cadera' }, { id: 'back', label: 'Espalda baja' },
    { id: 'neck', label: 'Cuello' }, { id: 'shoulder', label: 'Hombro' },
  ];

  // Qué pide cada ejercicio del catálogo: postura, equilibrio (0 nada, 1 con apoyo, 2 alto, 3 muy alto), banda,
  // brazos y zonas que carga. Los tests exigen una entrada por ejercicio.
  const NEEDS = {
    'sit-to-stand': { stand: true, balance: 1, areas: ['knee', 'hip'] },
    'tandem-stance': { stand: true, balance: 2, areas: [] },
    'one-leg-stand': { stand: true, balance: 3, areas: ['hip'] },
    'calf-raises': { stand: true, balance: 1, areas: [] },
    'half-squat': { stand: true, balance: 1, areas: ['knee', 'hip'] },
    'leg-extension': { areas: ['knee'] },
    'straight-leg-raise': { floor: true, areas: ['hip'] },
    'hamstring-curl': { stand: true, balance: 1, areas: ['knee'] },
    'supine-hamstring-stretch': { floor: true, areas: ['back'] },
    'hip-abduction': { floor: true, areas: ['hip'] },
    clamshell: { floor: true, areas: ['hip'] },
    'knee-to-chest': { floor: true, areas: ['back', 'hip'] },
    'hip-bridge': { floor: true, areas: ['back', 'hip'] },
    'bird-dog': { floor: true, kneel: true, areas: ['back', 'shoulder'] },
    'abdominal-bracing': { floor: true, areas: ['back'] },
    'chin-retraction': { areas: ['neck'] },
    'neck-side-flexion': { areas: ['neck'] },
    'seated-trunk-rotation': { areas: ['back'] },
    pendulum: { stand: true, balance: 1, arm: true, areas: ['shoulder'] },
    'crossover-arm-stretch': { arm: true, areas: ['shoulder'] },
    'external-rotation-band': { stand: true, band: true, arm: true, areas: ['shoulder'] },
    'internal-rotation-band': { stand: true, band: true, arm: true, areas: ['shoulder'] },
    'standing-row': { stand: true, band: true, arm: true, areas: ['shoulder', 'back'] },
    'scapula-setting': { arm: true, areas: ['shoulder'] },
  };

  const areaName = (id) => (PAIN_AREAS.find((a) => a.id === id) || { label: id }).label.toLowerCase();
  const exName = (id) => { const e = C && C.get(id); return e ? e.name : id; };
  const has = (profile, id) => Boolean(profile && Array.isArray(profile.limitations) && profile.limitations.includes(id));
  const profileEmpty = (p) => !p || (!(p.limitations || []).length && !(p.pain_areas || []).length && !p.note);

  /** Por qué un ejercicio NO encaja con el perfil (bloqueos) y qué cuidar (precauciones). */
  function fit(exerciseId, profile) {
    const n = NEEDS[exerciseId] || {};
    const blocks = [];
    const cautions = [];
    if (n.floor && has(profile, 'no_floor')) blocks.push('se hace en el suelo');
    if (n.kneel && has(profile, 'no_kneel')) blocks.push('se apoya en las rodillas');
    if (n.stand && has(profile, 'no_standing')) blocks.push('se hace de pie');
    if (n.band && has(profile, 'no_band')) blocks.push('necesita banda elástica');
    if ((n.balance || 0) >= 2 && (has(profile, 'balance') || has(profile, 'walking_aid'))) {
      (n.balance >= 3 ? blocks : cautions).push('exige mucho equilibrio');
    } else if ((n.balance || 0) >= 1 && (has(profile, 'balance') || has(profile, 'walking_aid'))) {
      cautions.push('es de pie: con apoyo firme y alguien cerca');
    }
    if (n.arm && has(profile, 'arm_limited')) cautions.push('usa un brazo o un hombro que tiene limitado');
    const pain = (n.areas || []).filter((a) => profile && (profile.pain_areas || []).includes(a));
    if (pain.length) cautions.push(`carga ${pain.map(areaName).join(' y ')}, donde refiere dolor`);
    return { ok: blocks.length === 0, blocks, cautions };
  }

  /** Alternativas que encajan con el perfil, del mismo tema y que trabajan los mismos músculos, mejor primero. */
  function alternatives(exerciseId, profile, exclude = []) {
    const base = C && C.get(exerciseId);
    if (!base) return [];
    return C.EXERCISES
      .filter((e) => e.id !== exerciseId && !exclude.includes(e.id) && fit(e.id, profile).ok)
      .map((e) => ({ id: e.id, shared: e.muscles.filter((m) => base.muscles.includes(m)).length, same: e.theme === base.theme,
        cautions: fit(e.id, profile).cautions.length }))
      .filter((x) => x.shared > 0)
      .sort((a, b) => (b.shared * 2 + b.same - b.cautions) - (a.shared * 2 + a.same - a.cautions) || (b.shared - a.shared))
      .map((x) => x.id);
  }

  /**
   * Sugerencias para el fisioterapeuta. data: { profile, plan, metrics, sessions, events }.
   * Cada una: { id, kind, priority (1 alta · 3 baja), title, detail, because, action? }.
   * action: { type: 'swap', from, to } | { type: 'remove', exercise_id } | { type: 'dose', exercise_id, field, value }
   *       | { type: 'add', exercise_ids: [...] }.
   */
  function forTherapist(data) {
    const profile = data.profile || null;
    const plan = data.plan || [];
    const metrics = data.metrics || {};
    const sessions = data.sessions || [];
    const events = data.events || [];
    const now = data.now || Date.now();
    const inPlan = plan.map((p) => p.exercise_id);
    const out = [];
    const push = (s) => { if (!out.some((x) => x.id === s.id)) out.push(s); };

    if (profileEmpty(profile)) {
      push({ id: 'profile-missing', kind: 'info', priority: 3, title: 'Perfil del paciente sin completar',
        detail: 'Con sus limitaciones físicas y zonas con dolor, las sugerencias adaptan los ejercicios. Puede completarlo el paciente en su página o tú aquí.',
        because: 'El perfil está vacío.' });
    }

    const painStops = sessions.filter((s) => s.end_reason === 'pain_stop');
    const byExercise = {};
    painStops.forEach((s) => { byExercise[s.exercise_id] = (byExercise[s.exercise_id] || 0) + 1; });

    plan.forEach((item) => {
      const f = fit(item.exercise_id, profile);
      const name = exName(item.exercise_id);
      if (!f.ok) {
        const alt = alternatives(item.exercise_id, profile, inPlan)[0];
        push({ id: `swap-${item.exercise_id}`, kind: 'swap', priority: 1,
          title: alt ? `Cambiar ${name} por ${exName(alt)}` : `Quitar ${name} del plan`,
          detail: alt ? `${exName(alt)} trabaja músculos parecidos y encaja con su perfil.`
            : 'No hay en el catálogo una alternativa que encaje con su perfil y trabaje los mismos músculos.',
          because: `${name} ${f.blocks.join(' y ')}, y el paciente indicó que no puede.`,
          action: alt ? { type: 'swap', from: item.exercise_id, to: alt } : { type: 'remove', exercise_id: item.exercise_id } });
      } else if (f.cautions.length && !byExercise[item.exercise_id]) {
        const painful = f.cautions.some((c) => c.includes('dolor'));
        push({ id: `caution-${item.exercise_id}`, kind: painful ? 'dose' : 'safety', priority: 2,
          title: painful ? `Bajar la dosis de ${name}` : `Precaución en ${name}`,
          detail: painful ? `Proponer ${Math.max(1, Math.round(item.reps * 0.7))} repeticiones en vez de ${item.reps} y revisar su respuesta.`
            : 'Indicarle un apoyo firme (mesa o respaldo) y, las primeras veces, alguien cerca.',
          because: `${name} ${f.cautions.join('; ')}.`,
          action: painful ? { type: 'dose', exercise_id: item.exercise_id, field: 'reps', value: Math.max(1, Math.round(item.reps * 0.7)) } : undefined });
      }
    });

    Object.entries(byExercise).forEach(([id, n]) => {
      const item = plan.find((p) => p.exercise_id === id);
      const extra = fit(id, profile).cautions;
      push({ id: `pain-${id}`, kind: 'dose', priority: 1, title: `Revisar ${exName(id)}: se detuvo por dolor`,
        detail: item ? `Proponer ${Math.max(1, Math.round(item.reps * 0.7))} repeticiones en vez de ${item.reps}, o un rango menor, y hablar con el paciente antes de la próxima sesión.`
          : 'Hablar con el paciente antes de volver a indicarlo.',
        because: `${n} sesión(es) de ${exName(id)} terminaron con "dolor: detener"${extra.length ? `; además ${extra.join('; ')}` : ''}.`,
        action: item ? { type: 'dose', exercise_id: id, field: 'reps', value: Math.max(1, Math.round(item.reps * 0.7)) } : undefined });
    });

    if ((metrics.sessions_total || 0) > 0) {
      (metrics.per_exercise || []).forEach((x) => {
        const item = plan.find((p) => p.exercise_id === x.exercise_id);
        const weekOld = item && item.since && (now - Date.parse(item.since)) >= 7 * 864e5;   // recién indicado: todavía no se juzga
        if (item && weekOld && x.ratio != null && x.ratio < 0.5 && item.per_week > 2 && !out.some((o) => o.id === `swap-${x.exercise_id}`)) {
          const value = Math.max(2, Math.ceil(item.per_week / 2));
          push({ id: `adherence-${x.exercise_id}`, kind: 'plan', priority: 2, title: `${exName(x.exercise_id)}: menos veces por semana`,
            detail: `Proponer ${value} veces por semana en vez de ${item.per_week}: un plan que cumple es mejor que uno ideal que no.`,
            because: `Hizo ${x.done_7d} de ${x.per_week} sesiones en los últimos 7 días.`,
            action: { type: 'dose', exercise_id: x.exercise_id, field: 'per_week', value } });
        }
        const first = x.camera_first;
        const last = x.camera_last;
        if (first && last && x.camera_sessions >= 2 && first.peak && last.peak && last.peak < first.peak * 0.85) {
          push({ id: `range-${x.exercise_id}`, kind: 'review', priority: 2, title: `${exName(x.exercise_id)}: el recorrido bajó`,
            detail: 'Preguntar por dolor o cansancio y revisar la técnica antes de subir la exigencia.',
            because: `Recorrido medio: ${first.peak} en la primera sesión con cámara y ${last.peak} en la última.` });
        }
      });
    }

    const count = (type) => events.filter((e) => e.type === type).length;
    const addFor = (type, ids, why) => {
      const n = count(type);
      if (n < 2) return;
      const pick = ids.filter((id) => !inPlan.includes(id) && fit(id, profile).ok);
      if (!pick.length) return;
      push({ id: `add-${type}`, kind: 'exercise', priority: 2, title: `Agregar ${exName(pick[0])}`,
        detail: why, because: `${n} alertas de ${type === 'knee_valgus' ? 'valgo de rodilla' : 'flexión de tronco'} en sus sesiones recientes.`,
        action: { type: 'add', exercise_ids: [pick[0]] } });
    };
    addFor('knee_valgus', ['clamshell', 'hip-abduction', 'half-squat'],
      'Fortalece el glúteo medio, que ayuda a que la rodilla no se vaya hacia adentro. Elegido entre los que encajan con su perfil.');
    addFor('trunk_flexion', ['hip-bridge', 'abdominal-bracing', 'seated-trunk-rotation'],
      'Trabaja glúteos y control del tronco, para pararse sin inclinarse tanto. Elegido entre los que encajan con su perfil.');

    if (!plan.length && !profileEmpty(profile)) {
      const starters = ['sit-to-stand', 'leg-extension', 'calf-raises', 'chin-retraction', 'seated-trunk-rotation', 'hip-bridge', 'tandem-stance']
        .filter((id) => fit(id, profile).ok && !fit(id, profile).cautions.length).slice(0, 3);
      if (starters.length) {
        push({ id: 'starter', kind: 'plan', priority: 2, title: 'Plan inicial que encaja con su perfil',
          detail: starters.map(exName).join(', ') + '.', because: 'El plan está vacío y el perfil tiene limitaciones marcadas.',
          action: { type: 'add', exercise_ids: starters } });
      }
    }
    if (has(profile, 'low_vision') || has(profile, 'hearing')) {
      push({ id: 'access', kind: 'access', priority: 3, title: 'Cómo darle las indicaciones',
        detail: has(profile, 'low_vision') ? 'Prefiere voz y letra grande: recomiéndale activar la voz y usar pantalla completa.'
          : 'Prefiere texto: los avisos de la sesión también aparecen escritos en grande.',
        because: 'Lo indicó en su perfil.' });
    }
    if (profile && profile.note) {
      push({ id: 'note', kind: 'info', priority: 3, title: 'Nota del paciente', detail: `«${profile.note}»`, because: 'La escribió en su perfil.' });
    }
    return out.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Consejos de uso para la persona. ctx: { page: 'patient'|'gallery'|'session', profile?, plan?, signedIn?, session? }.
   * session (al terminar el seguimiento): { count, total, partials, shortHolds, lowConfidenceRatio, view, recommended, spec }.
   * Cada uno: { id, kind, text }. Nunca cambian la dosis: lo clínico remite al fisioterapeuta.
   */
  function forUser(ctx) {
    const profile = ctx.profile || null;
    const out = [];
    const push = (id, kind, text) => out.push({ id, kind, text });
    if (ctx.page === 'patient') {
      if (profileEmpty(profile)) push('profile', 'setup', 'Completa "Mi perfil" (tus limitaciones y dónde te duele): tu fisioterapeuta podrá adaptar tus ejercicios.');
      const plan = ctx.plan || [];
      const blocked = plan.filter((p) => !fit(p.exercise_id, profile).ok);
      blocked.forEach((p) => push(`talk-${p.exercise_id}`, 'safety', `"${exName(p.exercise_id)}" ${fit(p.exercise_id, profile).blocks.join(' y ')}, y en tu perfil indicaste que no puedes: coméntaselo a tu fisioterapeuta antes de hacerlo.`));
      const pending = plan.filter((p) => (p.done_7d || 0) < p.per_week && fit(p.exercise_id, profile).ok)
        .sort((a, b) => (a.done_7d / a.per_week) - (b.done_7d / b.per_week));
      if (pending.length) push('next', 'plan', `Hoy te conviene "${exName(pending[0].exercise_id)}": llevas ${pending[0].done_7d || 0} de ${pending[0].per_week} esta semana.`);
      else if (plan.length) push('done', 'plan', '¡Cumpliste todo tu plan de esta semana! Descansar también es parte del tratamiento.');
      const limited = plan.find((p) => NEEDS[p.exercise_id] && NEEDS[p.exercise_id].floor && fit(p.exercise_id, profile).ok);
      if (limited) push('camera', 'camera', `"${exName(limited.exercise_id)}" se hace en el suelo: pon la cámara a la altura del suelo y de lado para que te vea entero.`);
    }
    if (ctx.page === 'gallery') {
      push('hover', 'ui', 'Pasa el mouse o toca una figura para verla en movimiento.');
      if (!profileEmpty(profile)) push('fit', 'ui', 'Marcamos los ejercicios que no encajan con lo que indicaste en tu perfil. Igual, tu fisioterapeuta decide.');
      else if (ctx.signedIn) push('fit', 'setup', 'Si completas "Mi perfil", aquí te marcaremos los ejercicios que no encajan con tus limitaciones.');
    }
    if (ctx.page === 'session' && ctx.session) {
      const s = ctx.session;
      if (s.partials >= 2) push('partials', 'technique', `${s.partials} repeticiones quedaron a medias: intenta llegar a llenar la barra. Si no llegas sin dolor, díselo a tu fisioterapeuta.`);
      if (s.shortHolds >= 1) push('holds', 'technique', 'Algunos sostenes se cortaron antes de tiempo: mantén la posición hasta que la cuenta llegue a 0.');
      if (s.lowConfidenceRatio > 0.2) push('light', 'camera', 'La cámara no te vio bien parte del tiempo: más luz, ropa que contraste con el fondo y todo el cuerpo a la vista.');
      if (s.view && s.recommended && s.view !== s.recommended) push('view', 'camera', 'La próxima vez prueba con la cámara en la posición recomendada: se mide mejor.');
      if (s.total && s.count >= s.total) push('well', 'plan', '¡Completaste la sesión! Tu fisioterapeuta ya tiene tus repeticiones.');
    }
    if (has(profile, 'low_vision')) push('voice', 'access', 'Activa la voz y usa pantalla completa (⛶): las indicaciones se leen en voz alta y en grande.');
    if (has(profile, 'hearing')) push('text', 'access', 'Todas las indicaciones aparecen escritas en grande sobre el video; puedes desactivar la voz.');
    if (has(profile, 'balance') || has(profile, 'walking_aid')) push('support', 'safety', 'Haz los ejercicios de pie junto a una mesa o respaldo firme, y con alguien cerca las primeras veces.');
    return out;
  }

  // ------------------------------------------------------------------ componentes (design system §6)
  let uid = 0;
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const KIND = { swap: 'Cambio de ejercicio', dose: 'Dosis', safety: 'Precaución', plan: 'Plan', exercise: 'Ejercicio nuevo',
    review: 'Revisar', access: 'Accesibilidad', info: 'Dato', setup: 'Configura', ui: 'Uso', camera: 'Cámara',
    technique: 'Técnica' };

  /**
   * Lista de sugerencias (.suggest). opts: { title, note, empty, actionLabel, onAction(item) }.
   * La región se anuncia al lector de pantalla cuando cambia (aria-live="polite").
   */
  function renderList(container, items, opts = {}) {
    if (!container || typeof document === 'undefined') return;
    const id = `suggest-${++uid}`;
    container.innerHTML = '';
    const box = node('section', 'suggest');
    box.setAttribute('aria-labelledby', id);
    const head = node('h2', 'suggest-title', opts.title || 'Sugerencias');
    head.id = id;
    box.appendChild(head);
    if (opts.note) box.appendChild(node('p', 'suggest-note', opts.note));
    const live = node('div');
    live.setAttribute('aria-live', 'polite');
    if (!items.length) live.appendChild(node('p', 'muted', opts.empty || 'Por ahora no hay sugerencias.'));
    else {
      const list = node('ul', 'suggest-list');
      items.forEach((s) => {
        const li = node('li', 'suggest-item');
        li.dataset.kind = s.kind;
        if (s.priority) li.dataset.priority = String(s.priority);
        const top = node('p', 'suggest-kind', `${KIND[s.kind] || 'Sugerencia'}${s.priority === 1 ? ' · prioridad alta' : ''}`);
        li.appendChild(top);
        if (s.title) li.appendChild(node('p', 'suggest-head', s.title));
        li.appendChild(node('p', 'suggest-text', s.detail || s.text));
        if (s.because) li.appendChild(node('p', 'suggest-why', `Por qué: ${s.because}`));
        if (s.action && opts.onAction) {
          const b = node('button', 'btn', opts.actionLabel || 'Aplicar');
          b.type = 'button';
          b.setAttribute('aria-label', `${opts.actionLabel || 'Aplicar'}: ${s.title || s.text}`);
          b.addEventListener('click', () => opts.onAction(s));
          li.appendChild(b);
        }
        list.appendChild(li);
      });
      live.appendChild(list);
    }
    box.appendChild(live);
    container.appendChild(box);
  }

  /**
   * Formulario del perfil (limitaciones, zonas con dolor y nota). onSave(profile) devuelve una promesa; el resultado se
   * anuncia en una línea de estado (role="status"). opts: { who: 'patient' | 'therapist' }.
   */
  function renderProfileForm(container, profile, onSave, opts = {}) {
    if (!container || typeof document === 'undefined') return;
    const me = opts.who !== 'therapist';
    const p = profile || { limitations: [], pain_areas: [], note: null };
    const n = ++uid;
    container.innerHTML = '';
    const form = node('form', 'profile-form');
    form.noValidate = true;
    const group = (legend, options, chosen, name) => {
      const fs = node('fieldset', 'profile-group');
      fs.appendChild(node('legend', null, legend));
      options.forEach((o) => {
        const label = node('label', 'check');
        const cb = document.createElement('input');
        Object.assign(cb, { type: 'checkbox', name, value: o.id, checked: (chosen || []).includes(o.id) });
        label.append(cb, node('span', null, me || !o.other ? o.label : o.other));
        fs.appendChild(label);
      });
      return fs;
    };
    form.append(group(me ? 'Lo que no puedo hacer o me cuesta' : 'Limitaciones', LIMITS, p.limitations, 'limitations'),
      group(me ? '¿Dónde te duele?' : 'Zonas con dolor', PAIN_AREAS, p.pain_areas, 'pain_areas'));
    const field = node('div', 'field');
    const lab = node('label', null, me ? 'Otra limitación (opcional)' : 'Nota (opcional)');
    lab.htmlFor = `profile-note-${n}`;
    const note = document.createElement('textarea');
    Object.assign(note, { id: `profile-note-${n}`, maxLength: 200, rows: 2, value: p.note || '' });
    note.setAttribute('aria-describedby', `profile-note-hint-${n}`);
    const hint = node('p', 'hint', 'Hasta 200 caracteres. Sin nombres ni datos que te identifiquen.');
    hint.id = `profile-note-hint-${n}`;
    field.append(lab, note, hint);
    const save = node('button', 'btn primary', 'Guardar perfil');
    save.type = 'submit';
    const status = node('p', 'status-line');
    status.setAttribute('role', 'status');
    form.append(field, save, status);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pick = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
      save.disabled = true;
      status.textContent = 'Guardando…';
      try {
        await onSave({ limitations: pick('limitations'), pain_areas: pick('pain_areas'), note: note.value.trim() || null });
        status.textContent = me ? 'Guardado. Tu fisioterapeuta ya lo ve.' : 'Guardado.';
      } catch (err) {
        status.textContent = `No se pudo guardar: ${err.message}`;
      } finally {
        save.disabled = false;
      }
    });
    container.appendChild(form);
  }

  return { LIMITS, PAIN_AREAS, NEEDS, fit, alternatives, forTherapist, forUser, profileEmpty, renderList, renderProfileForm };
}));
