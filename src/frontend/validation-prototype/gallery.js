/* AXONFAS · galería de ejercicios documentados (ADR-011). Funciona también con doble clic (sin servidor). */
(() => {
  'use strict';
  const C = window.AxonCatalog;
  const B = window.AxonBodyMap;
  const $ = (id) => document.getElementById(id);
  const state = { theme: 'all', query: '' };
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** Tarjeta de un ejercicio. La reutilizan doctor.js y patient.js con `extra` (botones) y `doseText` propio. */
  function exerciseCard(e, { extra = null, doseText = null } = {}) {
    const theme = C.THEMES.find((t) => t.id === e.theme);
    const card = document.createElement('article');
    card.className = 'ex-card';
    const badges = document.createElement('div');
    badges.className = 'badge-row';
    badges.innerHTML = `<span class="tag cal"></span><span class="tag ${e.monitoring === 'auto' ? 'ok' : 'warn'}"></span>`;
    badges.children[0].textContent = theme ? theme.name : e.theme;
    badges.children[1].textContent = e.monitoring === 'auto' ? 'Monitoreo automático' : 'Guiado';
    const title = document.createElement('h3');
    title.textContent = e.name;
    const goal = document.createElement('p');
    goal.className = 'muted';
    goal.textContent = e.goal;
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
    card.append(badges, title, goal, map, dose, facts, details, source);
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
      let extra = null;
      if (e.monitoring === 'auto') {
        extra = document.createElement('a');
        extra.className = 'btn primary';
        extra.href = 'index.html';
        extra.textContent = 'Probar con la cámara';
      }
      grid.appendChild(exerciseCard(e, { extra }));
    });
    $('count').textContent = `${list.length} de ${C.EXERCISES.length} ejercicios`;
  }

  window.AxonGallery = { exerciseCard };
  if ($('grid')) {
    $('search').addEventListener('input', (ev) => { state.query = ev.target.value; renderGrid(); });
    renderThemes();
    renderGrid();
  }
})();
