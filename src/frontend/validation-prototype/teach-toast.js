/* AXONFAS · aviso de enseñanza: el fisioterapeuta señala un músculo o un ejercicio y el paciente lo ve sobre el mapa
 * corporal (ADR-013). Lo usan paciente.html y el prototipo en modo paciente (patient-link.js).
 */
(function (root) {
  'use strict';
  let box = null;
  let timer = 0;

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
    box.hidden = false;
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'row-between';
    const title = document.createElement('h3');
    title.textContent = `${message.from || 'Tu fisioterapeuta'} te señala`;
    const close = document.createElement('button');
    close.className = 'btn';
    close.type = 'button';
    close.textContent = 'Cerrar';
    close.addEventListener('click', () => { box.hidden = true; });
    head.append(title, close);
    const what = document.createElement('p');
    what.className = 'facts';
    const names = B.muscleNames(muscles).join(', ');
    what.textContent = exercise ? `${exercise.name}: trabajas ${names}. Huesos: ${exercise.bones.join(', ')}.` : `Músculo: ${names}.`;
    const map = document.createElement('div');
    box.append(head, what, map);
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
        const u = new SpeechSynthesisUtterance(exercise ? `${exercise.name}: trabajas ${names}` : `Músculo: ${names}`);
        u.lang = 'es-PE';
        root.speechSynthesis.speak(u);
      } catch { /* sin voz */ }
    }
    clearTimeout(timer);
    timer = setTimeout(() => { box.hidden = true; }, 15000);
  }

  root.AxonTeach = { show };
})(typeof self !== 'undefined' ? self : this);
