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
  const api = factory(root.AxonCatalog || (typeof require === 'function' ? require('./catalog.js') : null),
    (typeof self !== 'undefined' && self.AxonI18n) || require('./i18n.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonSuggest = api;
}(typeof self !== 'undefined' ? self : this, (C, I18N) => {
  'use strict';
  // Textos en el idioma de la interfaz (ADR-030). Los ids, kind, priority y action no se traducen: las reglas son las mismas
  // en cualquier idioma y el sentido no cambia (las del fisioterapeuta son propuestas; las del usuario no tocan la dosis).
  const t = I18N.t;
  const tn = I18N.tn;

  // Limitaciones que el paciente (o su fisioterapeuta) marca en el perfil. Los ids los valida también la API.
  const limit = (id) => ({ id, get label() { return t(`suggest.limit.${id}`); }, get other() { return t(`suggest.limitOther.${id}`); } });
  const LIMITS = ['no_floor', 'no_kneel', 'no_standing', 'balance', 'walking_aid', 'arm_limited', 'no_band', 'low_vision', 'hearing'].map(limit);
  const PAIN_AREAS = ['knee', 'hip', 'back', 'neck', 'shoulder'].map((id) => ({ id, get label() { return t(`suggest.area.${id}`); } }));

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

  const SYMPTOM_CATEGORIES = ['pain', 'cramp', 'fatigue', 'stiffness', 'other', 'red_flag'];
  const categoryName = (c) => t(`suggest.symptom.${SYMPTOM_CATEGORIES.includes(c) ? c : 'other'}`);
  const areaName = (id) => (PAIN_AREAS.find((a) => a.id === id) || { label: id }).label.toLowerCase();
  const and = (list) => list.join(t('suggest.and'));
  const exName = (id) => { const e = C && C.get(id); return e ? e.name : id; };
  const has = (profile, id) => Boolean(profile && Array.isArray(profile.limitations) && profile.limitations.includes(id));
  const profileEmpty = (p) => !p || (!(p.limitations || []).length && !(p.pain_areas || []).length && !p.note);

  /** Por qué un ejercicio NO encaja con el perfil (bloqueos) y qué cuidar (precauciones). */
  function fit(exerciseId, profile) {
    const n = NEEDS[exerciseId] || {};
    const blocks = [];
    const cautions = [];
    if (n.floor && has(profile, 'no_floor')) blocks.push(t('suggest.block.floor'));
    if (n.kneel && has(profile, 'no_kneel')) blocks.push(t('suggest.block.kneel'));
    if (n.stand && has(profile, 'no_standing')) blocks.push(t('suggest.block.stand'));
    if (n.band && has(profile, 'no_band')) blocks.push(t('suggest.block.band'));
    if ((n.balance || 0) >= 2 && (has(profile, 'balance') || has(profile, 'walking_aid'))) {
      (n.balance >= 3 ? blocks : cautions).push(t('suggest.block.balance'));
    } else if ((n.balance || 0) >= 1 && (has(profile, 'balance') || has(profile, 'walking_aid'))) {
      cautions.push(t('suggest.caution.standing'));
    }
    if (n.arm && has(profile, 'arm_limited')) cautions.push(t('suggest.caution.arm'));
    const pain = (n.areas || []).filter((a) => profile && (profile.pain_areas || []).includes(a));
    if (pain.length) cautions.push(t('suggest.caution.pain', { areas: and(pain.map(areaName)) }));
    // painful: carga una zona con dolor (decide "bajar la dosis" sin mirar el texto, que cambia con el idioma)
    return { ok: blocks.length === 0, blocks, cautions, painful: pain.length > 0 };
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
      push({ id: 'profile-missing', kind: 'info', priority: 3, title: t('suggest.profileMissing.title'),
        detail: t('suggest.profileMissing.detail'), because: t('suggest.profileMissing.because') });
    }

    // Molestias que el paciente reportó en los últimos 14 días (ADR-021): una propuesta por ejercicio, que el fisioterapeuta revisa.
    const recentSymptoms = (data.symptoms || []).filter((x) => now - Date.parse(x.reported_at) <= 14 * 864e5);
    const symptomsBy = {};
    recentSymptoms.forEach((x) => { (symptomsBy[x.exercise_id || ''] = symptomsBy[x.exercise_id || ''] || []).push(x); });
    Object.entries(symptomsBy).forEach(([id, list]) => {
      const cats = [...new Set(list.map((x) => categoryName(x.category)))].join(', ');
      const stopped = list.filter((x) => x.action === 'session_stopped').length;
      const because = tn('suggest.discomfort.because', list.length, { cats, stopped: stopped ? t('suggest.discomfort.stopped', { n: stopped }) : '' });
      const priority = list.length >= 2 || list.some((x) => x.kind === 'red_flag') ? 1 : 2;
      if (!id) {
        push({ id: 'discomfort-general', kind: 'review', priority: 2, title: t('suggest.discomfort.general.title'),
          detail: t('suggest.discomfort.general.detail'), because });
        return;
      }
      const item = plan.find((p) => p.exercise_id === id);
      const reps = item ? Math.max(1, Math.round(item.reps * 0.7)) : null;
      const lower = item && reps < item.reps;               // con 1 repetición no hay qué bajar: solo hablar con el paciente
      push({ id: `discomfort-${id}`, kind: 'dose', priority, title: t('suggest.discomfort.title', { name: exName(id) }),
        detail: lower ? t('suggest.discomfort.lower', { reps, old: item.reps })
          : item ? t('suggest.discomfort.review') : t('suggest.talkBefore'),
        because, action: lower ? { type: 'dose', exercise_id: id, field: 'reps', value: reps } : undefined });
    });

    const painStops = sessions.filter((s) => s.end_reason === 'pain_stop');
    const byExercise = {};
    painStops.forEach((s) => { byExercise[s.exercise_id] = (byExercise[s.exercise_id] || 0) + 1; });

    plan.forEach((item) => {
      const f = fit(item.exercise_id, profile);
      const name = exName(item.exercise_id);
      if (!f.ok) {
        const alt = alternatives(item.exercise_id, profile, inPlan)[0];
        push({ id: `swap-${item.exercise_id}`, kind: 'swap', priority: 1,
          title: alt ? t('suggest.swap.title', { name, alt: exName(alt) }) : t('suggest.remove.title', { name }),
          detail: alt ? t('suggest.swap.detail', { alt: exName(alt) }) : t('suggest.remove.detail'),
          because: t('suggest.swap.because', { name, blocks: and(f.blocks) }),
          action: alt ? { type: 'swap', from: item.exercise_id, to: alt } : { type: 'remove', exercise_id: item.exercise_id } });
      } else if (f.cautions.length && !byExercise[item.exercise_id]) {
        const painful = f.painful;
        push({ id: `caution-${item.exercise_id}`, kind: painful ? 'dose' : 'safety', priority: 2,
          title: painful ? t('suggest.caution.doseTitle', { name }) : t('suggest.caution.title', { name }),
          detail: painful ? t('suggest.caution.doseDetail', { reps: Math.max(1, Math.round(item.reps * 0.7)), old: item.reps })
            : t('suggest.caution.detail'),
          because: t('suggest.caution.because', { name, cautions: f.cautions.join('; ') }),
          action: painful ? { type: 'dose', exercise_id: item.exercise_id, field: 'reps', value: Math.max(1, Math.round(item.reps * 0.7)) } : undefined });
      }
    });

    Object.entries(byExercise).forEach(([id, n]) => {
      const item = plan.find((p) => p.exercise_id === id);
      const extra = fit(id, profile).cautions;
      push({ id: `pain-${id}`, kind: 'dose', priority: 1, title: t('suggest.pain.title', { name: exName(id) }),
        detail: item ? t('suggest.pain.detail', { reps: Math.max(1, Math.round(item.reps * 0.7)), old: item.reps }) : t('suggest.talkBefore'),
        because: tn('suggest.pain.because', n, { name: exName(id), extra: extra.length ? t('suggest.pain.extra', { list: extra.join('; ') }) : '' }),
        action: item ? { type: 'dose', exercise_id: id, field: 'reps', value: Math.max(1, Math.round(item.reps * 0.7)) } : undefined });
    });

    if ((metrics.sessions_total || 0) > 0) {
      (metrics.per_exercise || []).forEach((x) => {
        const item = plan.find((p) => p.exercise_id === x.exercise_id);
        const weekOld = item && item.since && (now - Date.parse(item.since)) >= 7 * 864e5;   // recién indicado: todavía no se juzga
        if (item && weekOld && x.ratio != null && x.ratio < 0.5 && item.per_week > 2 && !out.some((o) => o.id === `swap-${x.exercise_id}`)) {
          const value = Math.max(2, Math.ceil(item.per_week / 2));
          push({ id: `adherence-${x.exercise_id}`, kind: 'plan', priority: 2, title: t('suggest.adherence.title', { name: exName(x.exercise_id) }),
            detail: t('suggest.adherence.detail', { value, old: item.per_week }),
            because: t('suggest.adherence.because', { done: x.done_7d, per: x.per_week }),
            action: { type: 'dose', exercise_id: x.exercise_id, field: 'per_week', value } });
        }
        const first = x.camera_first;
        const last = x.camera_last;
        if (first && last && x.camera_sessions >= 2 && first.peak && last.peak && last.peak < first.peak * 0.85) {
          push({ id: `range-${x.exercise_id}`, kind: 'review', priority: 2, title: t('suggest.range.title', { name: exName(x.exercise_id) }),
            detail: t('suggest.range.detail'),
            because: t('suggest.range.because', { first: first.peak, last: last.peak }) });
        }
      });
    }

    const count = (type) => events.filter((e) => e.type === type).length;
    const addFor = (type, ids) => {
      const n = count(type);
      if (n < 2) return;
      const pick = ids.filter((id) => !inPlan.includes(id) && fit(id, profile).ok);
      if (!pick.length) return;
      push({ id: `add-${type}`, kind: 'exercise', priority: 2, title: t('suggest.add.title', { name: exName(pick[0]) }),
        detail: t(`suggest.add.why.${type}`), because: t('suggest.add.because', { n, type: t(`suggest.add.type.${type}`) }),
        action: { type: 'add', exercise_ids: [pick[0]] } });
    };
    addFor('knee_valgus', ['clamshell', 'hip-abduction', 'half-squat']);           // glúteo medio: la rodilla no se va adentro
    addFor('trunk_flexion', ['hip-bridge', 'abdominal-bracing', 'seated-trunk-rotation']);   // glúteos y control del tronco

    if (!plan.length && !profileEmpty(profile)) {
      const starters = ['sit-to-stand', 'leg-extension', 'calf-raises', 'chin-retraction', 'seated-trunk-rotation', 'hip-bridge', 'tandem-stance']
        .filter((id) => fit(id, profile).ok && !fit(id, profile).cautions.length).slice(0, 3);
      if (starters.length) {
        push({ id: 'starter', kind: 'plan', priority: 2, title: t('suggest.starter.title'),
          detail: starters.map(exName).join(', ') + '.', because: t('suggest.starter.because'),
          action: { type: 'add', exercise_ids: starters } });
      }
    }
    if (has(profile, 'low_vision') || has(profile, 'hearing')) {
      push({ id: 'access', kind: 'access', priority: 3, title: t('suggest.access.title'),
        detail: has(profile, 'low_vision') ? t('suggest.access.lowVision') : t('suggest.access.hearing'),
        because: t('suggest.access.because') });
    }
    if (profile && profile.note) {
      push({ id: 'note', kind: 'info', priority: 3, title: t('suggest.note.title'), detail: t('suggest.note.detail', { note: profile.note }),
        because: t('suggest.note.because') });
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
      if (profileEmpty(profile)) push('profile', 'setup', t('suggest.user.profile'));
      const plan = ctx.plan || [];
      const blocked = plan.filter((p) => !fit(p.exercise_id, profile).ok);
      blocked.forEach((p) => push(`talk-${p.exercise_id}`, 'safety',
        t('suggest.user.talk', { name: exName(p.exercise_id), blocks: and(fit(p.exercise_id, profile).blocks) })));
      // Con la agenda del día (care-plan.js, ADR-025) cada ejercicio trae `due`: solo se sugiere lo que toca hoy.
      const pending = plan.filter((p) => (p.done_7d || 0) < p.per_week && p.due !== false && fit(p.exercise_id, profile).ok)
        .sort((a, b) => (a.done_7d / a.per_week) - (b.done_7d / b.per_week));
      if (pending.length) push('next', 'plan', t('suggest.user.next', { name: exName(pending[0].exercise_id), done: pending[0].done_7d || 0, per: pending[0].per_week }));
      else if (plan.length && plan.every((p) => (p.done_7d || 0) >= p.per_week)) push('done', 'plan', t('suggest.user.done'));
      const limited = plan.find((p) => NEEDS[p.exercise_id] && NEEDS[p.exercise_id].floor && fit(p.exercise_id, profile).ok);
      if (limited) push('camera', 'camera', t('suggest.user.floorCamera', { name: exName(limited.exercise_id) }));
    }
    if (ctx.page === 'gallery') {
      push('hover', 'ui', t('suggest.user.hover'));
      if (!profileEmpty(profile)) push('fit', 'ui', t('suggest.user.fit'));
      else if (ctx.signedIn) push('fit', 'setup', t('suggest.user.fitSetup'));
    }
    if (ctx.page === 'session' && ctx.session) {
      const s = ctx.session;
      if (s.partials >= 2) push('partials', 'technique', t('suggest.user.partials', { n: s.partials }));
      if (s.shortHolds >= 1) push('holds', 'technique', t('suggest.user.holds'));
      if (s.lowConfidenceRatio > 0.2) push('light', 'camera', t('suggest.user.light'));
      if (s.view && s.recommended && s.view !== s.recommended) push('view', 'camera', t('suggest.user.view'));
      if (s.total && s.count >= s.total) push('well', 'plan', t('suggest.user.well'));
    }
    if (has(profile, 'low_vision')) push('voice', 'access', t('suggest.user.voice'));
    if (has(profile, 'hearing')) push('text', 'access', t('suggest.user.text'));
    if (has(profile, 'balance') || has(profile, 'walking_aid')) push('support', 'safety', t('suggest.user.support'));
    return out;
  }

  // ------------------------------------------------------------------ componentes (design system §6)
  let uid = 0;
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const KINDS = ['swap', 'dose', 'safety', 'plan', 'exercise', 'review', 'access', 'info', 'setup', 'ui', 'camera', 'technique'];
  const kindName = (k) => t(`suggest.kind.${KINDS.includes(k) ? k : 'default'}`);

  /**
   * Lista de sugerencias (.suggest). opts: { title, note, empty, actionLabel, onAction(item) }.
   * La región se anuncia al lector de pantalla cuando cambia (aria-live="polite").
   */
  function renderList(container, items, opts = {}) {
    if (!container || typeof document === 'undefined') return;
    const id = `suggest-${++uid}`;
    container.replaceChildren();
    const box = node('section', 'suggest');
    box.setAttribute('aria-labelledby', id);
    const head = node('h2', 'suggest-title', opts.title || t('suggest.list.title'));
    head.id = id;
    box.appendChild(head);
    if (opts.note) box.appendChild(node('p', 'suggest-note', opts.note));
    const live = node('div');
    live.setAttribute('aria-live', 'polite');
    if (!items.length) live.appendChild(node('p', 'muted', opts.empty || t('suggest.list.empty')));
    else {
      const list = node('ul', 'suggest-list');
      items.forEach((s) => {
        const li = node('li', 'suggest-item');
        li.dataset.kind = s.kind;
        if (s.priority) li.dataset.priority = String(s.priority);
        const top = node('p', 'suggest-kind', `${kindName(s.kind)}${s.priority === 1 ? t('suggest.list.highPriority') : ''}`);
        li.appendChild(top);
        if (s.title) li.appendChild(node('p', 'suggest-head', s.title));
        li.appendChild(node('p', 'suggest-text', s.detail || s.text));
        if (s.because) li.appendChild(node('p', 'suggest-why', t('suggest.list.because', { because: s.because })));
        if (s.action && opts.onAction) {
          const label = opts.actionLabel || t('suggest.list.apply');
          const b = node('button', 'btn', label);
          b.type = 'button';
          b.setAttribute('aria-label', t('suggest.list.actionAria', { label, title: s.title || s.text }));
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
    container.replaceChildren();
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
    form.append(group(me ? t('suggest.profile.limitsMe') : t('suggest.profile.limits'), LIMITS, p.limitations, 'limitations'),
      group(me ? t('suggest.profile.painMe') : t('suggest.profile.pain'), PAIN_AREAS, p.pain_areas, 'pain_areas'));
    const field = node('div', 'field');
    const lab = node('label', null, me ? t('suggest.profile.otherMe') : t('suggest.profile.note'));
    lab.htmlFor = `profile-note-${n}`;
    const note = document.createElement('textarea');
    Object.assign(note, { id: `profile-note-${n}`, maxLength: 200, rows: 2, value: p.note || '' });
    note.setAttribute('aria-describedby', `profile-note-hint-${n}`);
    const hint = node('p', 'hint', t('suggest.profile.hint'));
    hint.id = `profile-note-hint-${n}`;
    field.append(lab, note, hint);
    const save = node('button', 'btn primary', t('suggest.profile.save'));
    save.type = 'submit';
    const status = node('p', 'status-line');
    status.setAttribute('role', 'status');
    form.append(field, save, status);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pick = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
      save.disabled = true;
      status.textContent = t('suggest.profile.saving');
      try {
        await onSave({ limitations: pick('limitations'), pain_areas: pick('pain_areas'), note: note.value.trim() || null });
        status.textContent = me ? t('suggest.profile.savedMe') : t('suggest.profile.saved');
      } catch (err) {
        status.textContent = t('suggest.profile.error', { error: err.message });
      } finally {
        save.disabled = false;
      }
    });
    container.appendChild(form);
  }

  return { LIMITS, PAIN_AREAS, NEEDS, fit, alternatives, forTherapist, forUser, profileEmpty, renderList, renderProfileForm };
}));
