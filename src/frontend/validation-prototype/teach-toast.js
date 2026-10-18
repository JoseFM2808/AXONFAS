/* AXONFAS · aviso de enseñanza: el fisioterapeuta señala un músculo o un ejercicio y el paciente lo ve sobre el mapa
 * corporal (ADR-013); si es un ejercicio, también su figura de referencia (componente .fig del design system).
 * Lo usan paciente.html, el prototipo en modo paciente (patient-link.js) y seguimiento.html.
 */
(function (root) {
  'use strict';
  let box = null;
  let timer = 0;
  let figure = null;

  function show(message) {
    const C = root.AxonCatalog;
    const B = root.AxonBodyMap;
    if (!B) return;
    const exercise = message.exercise_id && C ? C.get(message.exercise_id) : null;
    const muscles = message.muscle ? [message.muscle] : (exercise ? exercise.muscles : []);
    if (!box) {
      box = document.createElement('section');
      box.className = 'toast';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const I18N = root.AxonI18n;   // textos en i18n/common.js (ADR-030)
    const t = I18N.t;
    box.hidden = false;
    if (figure) { figure.stop(); figure = null; }
    box.replaceChildren();
    const head = document.createElement('div');
    head.className = 'row-between';
    const title = document.createElement('h3');
    title.textContent = t('teach.from', { from: message.from || t('teach.fromDefault') });
    const close = document.createElement('button');
    close.className = 'btn';
    close.type = 'button';
    close.textContent = t('teach.close');
    close.addEventListener('click', () => { box.hidden = true; if (figure) { figure.stop(); figure = null; } });
    head.append(title, close);
    const what = document.createElement('p');
    what.className = 'facts';
    const names = B.muscleNames(muscles).join(', ');
    what.textContent = exercise
      ? t('teach.exercise', { name: exercise.name, muscles: names, bones: exercise.bones.join(', ') })
      : t('teach.muscle', { muscles: names });
    const map = document.createElement('div');
    box.append(head, what);
    if (exercise && root.AxonGuide && root.AxonGuide.GUIDES[exercise.id]) {
      const fig = document.createElement('div');
      box.appendChild(fig);
      figure = root.AxonGuide.render(fig, exercise.id, { hold: exercise.dose.hold, variant: 'pip', autoplay: 'always' });
    }
    box.appendChild(map);
    if (message.note) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = `“${message.note}”`;
      box.appendChild(note);
    }
    const intensities = Object.fromEntries(muscles.map((m) => [m, 0.9]));
    B.render(map, { intensities, focus: message.muscle || null });
    if ('speechSynthesis' in root) {
      try {
        const u = new SpeechSynthesisUtterance(exercise
          ? t('teach.say.exercise', { name: exercise.name, muscles: names })
          : t('teach.say.muscle', { muscles: names }));
        u.lang = I18N.speechLang();
        const v = I18N.voiceFor(root.speechSynthesis.getVoices());
        if (v) u.voice = v;
        root.speechSynthesis.speak(u);
      } catch { /* sin voz */ }
    }
    clearTimeout(timer);
    timer = setTimeout(() => { box.hidden = true; }, 15000);
  }

  root.AxonTeach = { show };
})(typeof self !== 'undefined' ? self : this);
