/* AXONFAS · galería de ejercicios documentados (ADR-011). Funciona también con doble clic (sin servidor). */
(() => {
  'use strict';
  const C = window.AxonCatalog;
  const B = window.AxonBodyMap;
  const $ = (id) => document.getElementById(id);
  const S = window.AxonSuggest;
  const state = { theme: 'all', query: '', profile: null };
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** Aviso de encaje con el perfil (ADR-017): vacío si encaja. Siempre se crea, para que las tarjetas tengan las mismas filas. */
  function fitNote(e, profile, forPlan) {
    const p = document.createElement('p');
    p.className = 'fit-note';
    if (!S || !profile) return p;
    const f = S.fit(e.id, profile);
    if (!f.ok) p.textContent = `No encaja con tu perfil: ${f.blocks.join(' y ')}. ${forPlan ? 'Coméntaselo a tu fisioterapeuta.' : 'Tu fisioterapeuta decide.'}`;
    else if (f.cautions.length) p.textContent = `Ojo: ${f.cautions[0]}.`;
    return p;
  }

  /** Tarjeta de un ejercicio. La reutiliza patient.js con `extra` (botones), `doseText`, `hold` y `profile` del plan. */
  function exerciseCard(e, { extra = null, doseText = null, hold = null, profile = null, forPlan = false } = {}) {
    const theme = C.THEMES.find((t) => t.id === e.theme);
    const card = document.createElement('article');
    card.className = 'ex-card';
    const badges = document.createElement('div');
    badges.className = 'badge-row';
    badges.innerHTML = `<span class="tag cal"></span><span class="tag ${e.monitoring === 'auto' ? 'ok' : 'warn'}"></span>`;
    badges.children[0].textContent = theme ? theme.name : e.theme;
    const track = window.AxonTracker && AxonTracker.SPECS[e.id];
    badges.children[1].textContent = e.monitoring === 'auto' ? 'Alertas automáticas'
      : track && track.quality === 'limited' ? 'Conteo con cámara (aprox.)' : 'Conteo con cámara';
    const title = document.createElement('h3');
    title.textContent = e.name;
    title.id = `ex-${e.id}-${Math.random().toString(36).slice(2, 7)}`;
    card.setAttribute('aria-labelledby', title.id);
    const goal = document.createElement('p');
    goal.className = 'muted';
    goal.textContent = e.goal;
    // Figura de referencia animada (TD-44): cómo se hace, con dibujo propio. Se anima solo mientras se ve.
    let guide = null;
    if (window.AxonGuide && AxonGuide.GUIDES[e.id]) {
      guide = document.createElement('div');
      const holdS = hold == null ? e.dose.hold : hold;
      queueMicrotask(() => AxonGuide.render(guide, e.id, { hold: holdS, variant: 'card', autoplay: 'visible' }));
    }
    const map = document.createElement('div');
    const dose = document.createElement('p');
    dose.className = 'dose';
    dose.textContent = doseText || e.dose.text;
    const facts = document.createElement('div');
    facts.className = 'facts';
    [['Músculos', B.muscleNames(e.muscles).join(', ')], ['Huesos', e.bones.join(', ')], ['Articulaciones', e.joints.join(', ')]]
      .forEach(([k, v]) => {
        const line = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = `${k}: `;
        line.append(strong, document.createTextNode(v));
        facts.appendChild(line);
      });
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Cómo se hace';
    const position = document.createElement('p');
    position.className = 'muted';
    position.textContent = `Posición: ${e.position}`;
    const steps = document.createElement('ol');
    e.steps.forEach((s) => { const li = document.createElement('li'); li.textContent = s; steps.appendChild(li); });
    const precTitle = document.createElement('p');
    precTitle.className = 'muted';
    precTitle.textContent = 'Precauciones';
    const prec = document.createElement('ul');
    e.precautions.forEach((s) => { const li = document.createElement('li'); li.textContent = s; prec.appendChild(li); });
    details.append(summary, position, steps, precTitle, prec);
    const source = document.createElement('p');
    source.className = 'source';
    source.append('Fuente: ');
    const a = document.createElement('a');
    a.href = e.source.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `${e.source.org} · ${e.source.title}`;
    source.append(a, ` (${e.sourceName})`);
    card.append(badges, title, goal, fitNote(e, profile, forPlan), guide || document.createElement('div'), map, dose, facts, details, source);
    if (extra) card.appendChild(extra);
    B.render(map, { intensities: B.staticLoad(e) });
    return card;
  }

  function renderThemes() {
    const box = $('themes');
    if (!box) return;
    const options = [{ id: 'all', name: 'Todas' }, ...C.THEMES];
    box.innerHTML = '';
    options.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.textContent = t.name;
      b.setAttribute('aria-pressed', String(state.theme === t.id));
      b.addEventListener('click', () => { state.theme = t.id; renderThemes(); renderGrid(); });
      box.appendChild(b);
    });
  }

  function renderGrid() {
    const grid = $('grid');
    if (!grid) return;
    const q = norm(state.query.trim());
    const list = C.EXERCISES.filter((e) => (state.theme === 'all' || e.theme === state.theme)
      && (!q || norm(`${e.name} ${e.goal} ${B.muscleNames(e.muscles).join(' ')} ${e.bones.join(' ')}`).includes(q)));
    grid.innerHTML = '';
    list.forEach((e) => {
      // Todos se siguen con la cámara (ADR-014); sentarse y pararse además tiene alertas en el Prototipo (ADR-009).
      const extra = document.createElement('div');
      extra.className = 'row-between';
      const track = document.createElement('a');
      track.className = 'btn primary';
      track.href = `seguimiento.html?ex=${encodeURIComponent(e.id)}`;
      track.textContent = 'Seguir con la cámara';
      extra.appendChild(track);
      if (e.monitoring === 'auto') {
        const alerts = document.createElement('a');
        alerts.className = 'btn';
        alerts.href = 'index.html';
        alerts.textContent = 'Con alertas (Prototipo)';
        extra.appendChild(alerts);
      }
      grid.appendChild(exerciseCard(e, { extra, profile: state.profile }));
    });
    $('count').textContent = `${list.length} de ${C.EXERCISES.length} ejercicios`;
  }

  /** Consejos de uso (rol usuario) y, con una cuenta de paciente, el encaje de cada ejercicio con su perfil. */
  async function loadProfile() {
    const A = window.AxonApi;
    const signedIn = Boolean(A && A.load('patient'));
    if (signedIn) {
      try { state.profile = (await A.call('patient', 'GET', '/api/me')).patient.profile; } catch { state.profile = null; }
    }
    if (S && $('tips')) {
      S.renderList($('tips'), S.forUser({ page: 'gallery', profile: state.profile, signedIn }), {
        title: 'Sugerencias para ti', note: 'Consejos de uso calculados con reglas a partir de tus datos. No reemplazan a tu fisioterapeuta.' });
    }
    if (state.profile) renderGrid();
  }

  window.AxonGallery = { exerciseCard };
  if ($('grid')) {
    $('search').addEventListener('input', (ev) => { state.query = ev.target.value; renderGrid(); });
    renderThemes();
    renderGrid();
    loadProfile();
  }
})();
