/* AXONFAS · interfaz del prototipo de validación (TD-28).
 * Conecta la cámara (MediaPipe Pose en el navegador) o el demo sintético con el motor de engine.js. No guarda nada:
 * ni video, ni imágenes, ni datos en el navegador. Lo único que sale a internet es la descarga del modelo y de MediaPipe.
 */
(() => {
  'use strict';

  const LOW_CONFIDENCE_FRAMES_BEFORE_HINT = 15;
  const PC = window.AxonPoseCamera;                         // cámara y MediaPipe compartidos con seguimiento.js (TD-50)

  const $ = (id) => document.getElementById(id);
  // Eventos para módulos externos (patient-link.js manda la sesión al fisioterapeuta). app.js no sabe de la red.
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(`axon:${name}`, { detail }));
  const ui = {
    viewport: $('viewport'), video: $('video'), canvas: $('overlay'), placeholder: $('placeholder'),
    alert: $('alert'), alertText: $('alert-text'), alertMeta: $('alert-meta'),
    btnCamera: $('btn-camera'), btnDemo: $('btn-demo'), sourceStatus: $('source-status'),
    phase: $('phase'), phaseSub: $('phase-sub'),
    trunkMargin: $('trunk-margin'), valgusMargin: $('valgus-margin'), romTarget: $('rom-target'), romAuto: $('rom-auto'),
    maxReps: $('max-reps'), minConf: $('min-conf'), voice: $('voice'),
    btnPain: $('btn-pain'), btnStop: $('btn-stop'), btnNew: $('btn-new'), btnCopy: $('btn-copy'),
    copyStatus: $('copy-status'), copyFallback: $('copy-fallback'),
    baseline: $('baseline'), repsBody: $('reps-body'), eventsBody: $('events-body'),
    guide: $('guide'), guideRest: $('guide-rest'), guideTotal: $('guide-total'),
    hud: $('hud'), hudPhase: $('hud-phase'), hudDone: $('hud-done'), hudTotal: $('hud-total'), hudBar: $('hud-bar'),
    announce: $('announce'), btnFullscreen: $('btn-fullscreen'),
  };
  const ctx = ui.canvas.getContext('2d');

  const PHRASES = {
    trunk_flexion: 'Tronco más erguido',
    knee_valgus_left: 'Rodilla izquierda hacia afuera',
    knee_valgus_right: 'Rodilla derecha hacia afuera',
  };
  // La voz dice qué pasa y qué hacer (TD-97): el paciente se corrige sin mirar la pantalla. La pantalla queda corta.
  const VOICE = {
    trunk_flexion: 'Te estás inclinando mucho hacia adelante: sube el pecho',
    knee_valgus_left: 'Tu rodilla izquierda se está yendo hacia adentro: llévala hacia afuera',
    knee_valgus_right: 'Tu rodilla derecha se está yendo hacia adentro: llévala hacia afuera',
  };
  const NAMES = { trunk_flexion: 'Flexión de tronco', knee_valgus: 'Valgo de rodilla' };
  const SIDES = { left: 'izquierda', right: 'derecha' };
  const END_TEXT = { completed: 'Sesión completada', pain_stop: 'Detenida por dolor', user_quit: 'Terminada a mano' };
  const BONES = [[11, 12], [23, 24], [11, 23], [12, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

  let session = null;
  let source = null;              // 'camera' | 'demo'
  let running = false;             // bucle del demo
  let rafId = 0;
  let cam = null;                 // bucle de la cámara (pose-camera.js)
  let demo = null;                // { frames, start, idx }
  let lowStreak = 0;
  let alertTimer = 0;
  let activeAlert = null;         // { key, until } para pintar en rojo el segmento
  let endedShown = false;
  let announceTimer = 0;
  // Preparar la cámara (ADR-015): chequeo en vivo antes de calibrar, vista detectada y lo que no se evalúa desde ella.
  const CS = window.AxonCameraSetup;
  let camOpts = null;
  let setup = null;
  let view = null;
  let disabled = {};
  let lastCheck = 0;

  // ---------------------------------------------------------------- sobre de seguridad (controles del terapeuta)
  function readConfig() {
    return {
      trunkMarginDeg: Number(ui.trunkMargin.value),
      valgusMarginDeg: Number(ui.valgusMargin.value),
      romTargetDeg: ui.romAuto.checked ? null : Number(ui.romTarget.value),
      maxReps: Number(ui.maxReps.value),
      minConfidence: Number(ui.minConf.value),
      disabled,
    };
  }

  function renderControls() {
    $('trunk-margin-out').textContent = `+${ui.trunkMargin.value}°`;
    $('valgus-margin-out').textContent = `+${ui.valgusMargin.value}°`;
    ui.romTarget.disabled = ui.romAuto.checked;
    const auto = session && session.snapshot().thresholds;
    $('rom-target-out').textContent = ui.romAuto.checked
      ? (auto ? `≥ ${auto.romTarget.toFixed(0)}° (auto)` : 'auto') : `≥ ${ui.romTarget.value}°`;
    $('max-reps-out').textContent = ui.maxReps.value;
    $('min-conf-out').textContent = Number(ui.minConf.value).toFixed(2);
    const total = Number(ui.maxReps.value);
    ui.guideTotal.textContent = total;
    ui.guideRest.textContent = total - AxonEngine.DEFAULTS.calibrationReps;
    if (session) renderHud(session.snapshot());
  }

  [ui.trunkMargin, ui.valgusMargin, ui.romTarget, ui.romAuto, ui.maxReps, ui.minConf].forEach((el) =>
    el.addEventListener('input', () => {
      if (session) session.setConfig(readConfig());
      renderControls();
    }));

  // ---------------------------------------------------------------- fuentes
  function stopSource() {
    running = false;
    setup = null;
    $('cam-check').hidden = true;
    cancelAnimationFrame(rafId);
    if (cam) { cam.stop(); cam = null; }
    ui.video.srcObject = null;
  }

  function newSession() {
    session = AxonEngine.createSession(readConfig());
    lowStreak = 0;
    endedShown = false;
    hideAlert();
    renderReps();
    renderEvents();
    renderControls();
    setButtons(true);
    ui.guide.open = false;                                   // la guía se cierra para dejar el video a la vista
    ui.hud.hidden = false;
    renderHud(session.snapshot());
    const cal = session.config.calibrationReps;
    announce(`Empieza la calibración: ${cal} repeticiones con tu técnica normal`, { ms: 4000 });
    emit('session-start', { source, startedAt: new Date().toISOString(), config: session.config });
  }

  function setButtons(active) {
    ui.btnPain.disabled = !active;
    ui.btnStop.disabled = !active;
    ui.btnNew.disabled = !source;
    ui.btnCopy.disabled = !session || session.reps.length === 0;
  }

  async function startCamera() {
    stopSource();
    const run = await PC.open({
      video: ui.video, canvas: ui.canvas, viewport: ui.viewport,
      status: (text) => { ui.sourceStatus.textContent = text; },
      unsupported: 'Este navegador no permite la cámara aquí. Ábrelo con Chrome o Edge, con doble clic en index.html o '
        + 'desde http://localhost (ver README).',
    });
    if (!run) return;
    cam = run;
    source = 'camera';
    ui.placeholder.hidden = true;
    startSetup();
    cam.start(onCameraResult);
  }

  // ---------------------------------------------------------------- preparar la cámara (ADR-015)
  function startSetup() {
    const chosen = camOpts ? camOpts.selected : 'diagonal';
    setup = CS.createCheck({ measures: CS.ENGINE.measures, need: CS.ENGINE.need, chosen });
    setup.chosen = chosen;
    session = null;
    ui.hud.hidden = true;
    $('cam-check').hidden = false;
    ui.phase.textContent = 'Prepara la cámara';
    ui.phaseSub.textContent = `${CS.VIEWS[chosen].how}, a 2–3 m y a la altura de la cadera.`;
    announce('Coloca la cámara: que se vea el cuerpo entero y los pies', { ms: 3000 });
    ui.btnPain.disabled = false;
    ui.btnStop.disabled = false;
  }

  function onSetupFrame(image, t) {
    const aspect = (ui.video.videoWidth || 16) / (ui.video.videoHeight || 9);
    const r = setup.update(image, t, aspect);
    if (image) drawPose(image, { lowConfidence: false });
    else ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    if (t - lastCheck > 150 || r.ready) {
      lastCheck = t;
      const el = $('cam-check');
      CS.renderCheck(el, r, setup.chosen);
      el.insertAdjacentHTML('beforeend', '<button class="btn" type="button" data-cam-skip>Empezar ya</button>');
    }
    if (r.ready) finishSetup(r);
  }

  function finishSetup(r) {
    if (!setup) return;
    view = r && r.view ? r.view : null;
    disabled = view ? CS.disabledFor(view) : {};
    setup = null;
    $('cam-check').hidden = true;
    ui.sourceStatus.textContent = view ? `Cámara activa, ${CS.summary(view, CS.ENGINE.measures)}. El video no sale de este equipo.`
      : 'Cámara activa. El video no sale de este equipo.';
    newSession();
  }

  $('cam-check').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-cam-skip]') && setup) finishSetup(setup.last);
  });

  function startDemo() {
    stopSource();
    ui.canvas.width = 1280;
    ui.canvas.height = 720;
    // Solo lo usa la vista de celular: un recuadro cuadrado deja franjas arriba y abajo del demo (16:9) para la fase y
    // el contador, sin tapar la figura. En escritorio el video es 16:9 fijo.
    ui.viewport.style.setProperty('--src-ratio', '1 / 1');
    demo = { frames: AxonSynthetic.generateSession({ seed: 1 + Math.floor(Math.random() * 1000) }), start: performance.now(), idx: 0 };
    source = 'demo';
    ui.viewport.classList.remove('mirror');
    ui.placeholder.hidden = true;
    ui.sourceStatus.textContent = 'Demo sintético: 3 de calibración, una compensación de tronco (rep 5), un valgo izquierdo (rep 7) '
      + 'y una repetición mal vista (rep 8).';
    view = null;
    disabled = {};
    newSession();
    running = true;
    loop();
  }

  // ---------------------------------------------------------------- bucles
  /** Un frame nuevo de la cámara (pose-camera.js): primero la preparación, después la sesión. */
  function onCameraResult({ image, world, t }) {
    if (setup) onSetupFrame(image, t);
    else if (world && image) handleFrame({ t, world, visibility: image }, image, t, true);
    else handleNoPose();
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (source === 'demo' && demo) {
      // Se procesan todos los frames que ya tocaban (si la pestaña se ralentiza no se pierden repeticiones) y se dibuja el último.
      const elapsed = performance.now() - demo.start;
      while (demo.idx < demo.frames.length && demo.frames[demo.idx].t <= elapsed && running) {
        const f = demo.frames[demo.idx++];
        const isLast = demo.idx >= demo.frames.length || demo.frames[demo.idx].t > elapsed;
        handleFrame({ t: f.t, world: f.world, visibility: f.image }, f.image, performance.now(), isLast);
      }
      if (running && demo.idx >= demo.frames.length && session.snapshot().phase !== 'ended') {
        session.end('completed');
        onEnded();
      }
    }
  }

  function handleNoPose() {
    lowStreak += 1;
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    if (lowStreak === LOW_CONFIDENCE_FRAMES_BEFORE_HINT) showInfo('No veo a nadie: aléjate hasta que se vea el cuerpo entero');
  }

  function handleFrame(frame, image, t0, draw) {
    const out = session.update(frame);
    emit('frame', { out, image, source, mirror: source === 'camera', view });
    if (out.newEvents.length) emit('event', { events: out.newEvents });
    if (out.lowConfidence) {
      lowStreak += 1;
      if (lowStreak === LOW_CONFIDENCE_FRAMES_BEFORE_HINT) showInfo('No te veo bien: que se vean caderas, rodillas y tobillos');
    } else {
      if (lowStreak >= LOW_CONFIDENCE_FRAMES_BEFORE_HINT && ui.alert.classList.contains('info')) hideAlert();
      lowStreak = 0;
    }
    if (draw) { drawPose(image, out); renderLive(out); }
    if (out.newEvents.length) {
      showEventAlert(out.newEvents[0]);
      measureLatency(out.newEvents, t0);
    }
    if (out.completed) {
      renderReps();
      renderControls();
      announceProgress(out);
    }
    if (out.aborted) {                                       // se volvió a sentar sin pararse de verdad (TD-55)
      announce(out.aborted.reason === 'one_leg'
        ? 'No contó: ponte de pie con los dos pies apoyados, no levantes una pierna'
        : 'No contó: ponte de pie por completo, con rodillas y caderas estiradas', { ms: 3200 });
    }
    if (out.phase === 'ended' && !endedShown) onEnded();
  }

  // ---------------------------------------------------------------- TD-31 · avisos de progreso legibles a 2-3 m
  /** Cartel grande en el centro del video, con voz. */
  function announce(text, { ms = 2600, tone = '', voice = true } = {}) {
    clearTimeout(announceTimer);
    ui.announce.textContent = text;
    ui.announce.className = `announce${tone ? ` ${tone}` : ''}`;
    ui.announce.hidden = false;
    announceTimer = setTimeout(() => { ui.announce.hidden = true; }, ms);
    if (voice) speak(text, 'info');
  }

  /** Al cerrar cada repetición: cuenta de calibración, fin de calibración, conteo, aviso de la última. */
  function announceProgress(out) {
    const { rep, discarded } = out.completed;
    if (discarded) {
      announce('Esa no contó: no te vi bien. Repítela');
      return;
    }
    if (out.phase === 'ended') return;                       // el cierre lo anuncia onEnded
    const cfg = session.config;
    const done = out.repsDone;
    if (rep.calibration && out.phase === 'exercising') {
      announce('Calibración lista. Desde ahora te aviso si compensas', { ms: 3600 });
    } else if (rep.calibration) {
      announce(`Calibración: ${done} de ${cfg.calibrationReps}`);
    } else if (done === cfg.maxReps - 1) {
      announce(`${done} de ${cfg.maxReps}. Va la última`);
    } else {
      announce(`${done} de ${cfg.maxReps}`);
    }
  }

  /** Contador fijo en una esquina del video: fase, repeticiones hechas y barra (calibración, hechas, con alerta). */
  function renderHud(snap) {
    const cfg = session.config;
    ui.hudPhase.textContent = snap.phase === 'ended' ? (END_TEXT[snap.endReason] || 'Terminada')
      : snap.phase === 'calibrating' ? 'Calibración · técnica normal' : 'Con alertas';
    ui.hudDone.textContent = snap.repsDone;
    ui.hudTotal.textContent = cfg.maxReps;
    const flagged = new Set(session.reps.filter((r) => r.events.length).map((r) => r.index));
    ui.hudBar.innerHTML = Array.from({ length: cfg.maxReps }, (_, i) => {
      const n = i + 1;
      const cls = [n <= cfg.calibrationReps ? 'cal' : '', n <= snap.repsDone ? 'done' : '', flagged.has(n) ? 'flag' : '']
        .filter(Boolean).join(' ');
      return `<span class="${cls}"></span>`;
    }).join('');
  }

  // ---------------------------------------------------------------- TD-30 · guía del ejercicio
  // Figura de referencia del design system (componente .fig de guide-figure.js), igual que en la galería y el seguimiento.
  let guideFig = null;
  function renderGuide() {
    if (!window.AxonGuide || guideFig) return;
    guideFig = AxonGuide.render($('guide-figure'), 'sit-to-stand', { variant: 'large', autoplay: 'visible' });
  }

  async function toggleFullscreen() {
    try {
      // El escenario entero (video, tacómetros y botonera), para que "Dolor: detener" siga a mano.
      if (document.fullscreenElement) await document.exitFullscreen();
      else await ($('stage') || ui.viewport).requestFullscreen();
    } catch (err) {
      ui.sourceStatus.textContent = 'Este navegador no permitió la pantalla completa.';
    }
  }

  /** Latencia del bucle rápido en el navegador: del frame a la alerta pintada (aprox.: rAF + tarea siguiente). */
  function measureLatency(events, t0) {
    requestAnimationFrame(() => setTimeout(() => {
      const ms = Math.round(performance.now() - t0);
      events.forEach((e) => { e.alertLatencyMs = ms; });
      renderEvents();
    }, 0));
  }

  // ---------------------------------------------------------------- dibujo y lecturas
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function drawPose(image, out) {
    const w = ui.canvas.width, h = ui.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!image) return;
    const now = performance.now();
    const alertOn = activeAlert && activeAlert.until > now ? activeAlert.key : null;
    const ok = out.lowConfidence ? cssVar('--muted') : '#56B6E6';
    const bad = '#F07A6F';
    const isBad = (a, b) => alertOn && (
      (alertOn === 'trunk_flexion' && ((a === 11 && b === 23) || (a === 12 && b === 24) || (a === 11 && b === 12)))
      || (alertOn === 'knee_valgus_left' && (a === 23 || a === 25) && (b === 25 || b === 27))
      || (alertOn === 'knee_valgus_right' && (a === 24 || a === 26) && (b === 26 || b === 28)));
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(4, w / 220);
    for (const [a, b] of BONES) {
      const p = image[a], q = image[b];
      if (!p || !q) continue;
      ctx.strokeStyle = isBad(a, b) ? bad : ok;
      ctx.globalAlpha = Math.min(p.visibility, q.visibility) < 0.5 ? 0.35 : 1;
      ctx.beginPath();
      ctx.moveTo(p.x * w, p.y * h);
      ctx.lineTo(q.x * w, q.y * h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#E0E9EC';
    for (const i of [11, 12, 23, 24, 25, 26, 27, 28]) {
      const p = image[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, Math.max(5, w / 200), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function setReadout(id, value, threshold, over, low) {
    const el = $(id);
    el.querySelector('.v').textContent = value;
    el.querySelector('.th').textContent = threshold || '';
    el.classList.toggle('over', Boolean(over));
    el.classList.toggle('low', Boolean(low));
  }

  function renderLive(out) {
    const a = out.angles;
    const th = out.thresholds;
    const low = out.lowConfidence;
    const f = (v) => (Number.isFinite(v) ? `${v.toFixed(0)}°` : '—');
    if (a) {
      setReadout('ro-knee', f(a.knee), th ? `pedida ≥ ${th.romTarget.toFixed(0)}°` : 'calibrando', false, low);
      const off = (k) => (disabled[k] ? 'no se evalúa desde esta cámara' : null);
      setReadout('ro-trunk', f(a.trunk), off('trunk') || (th ? `umbral ${th.trunk.toFixed(0)}°` : 'calibrando'), !disabled.trunk && th && a.trunk > th.trunk, low);
      setReadout('ro-valgus-l', f(a.valgusL), off('valgus') || (th ? `umbral ${th.valgusL.toFixed(0)}°` : 'calibrando'), !disabled.valgus && th && a.valgusL > th.valgusL, low);
      setReadout('ro-valgus-r', f(a.valgusR), off('valgus') || (th ? `umbral ${th.valgusR.toFixed(0)}°` : 'calibrando'), !disabled.valgus && th && a.valgusR > th.valgusR, low);
      setReadout('ro-conf', a.confidence.toFixed(2), low ? 'baja: no se evalúa' : 'suficiente', false, low);
    }
    renderPhase(out);
  }

  function renderPhase(out) {
    const cfg = session.config;
    if (out.phase === 'ended') {
      ui.phase.textContent = END_TEXT[out.endReason] || 'Sesión terminada';
      ui.phaseSub.textContent = `${session.reps.length} repeticiones, ${session.events.length} alertas.`;
      return;
    }
    const current = out.repInProgress ? out.repInProgress.index : out.repsDone + 1;
    if (out.phase === 'calibrating') {
      ui.phase.textContent = `Calibrando: ${out.calibrationDone} de ${cfg.calibrationReps}`;
      ui.phaseSub.textContent = out.posture === 'seated' ? 'Sentado. Levántate con tu técnica normal.'
        : out.posture === 'standing' ? 'De pie. Vuelve a sentarte.' : 'Esperando ver a la persona.';
    } else {
      ui.phase.textContent = `Repetición ${Math.min(current, cfg.maxReps)} de ${cfg.maxReps}`;
      ui.phaseSub.textContent = 'Las alertas están activas.';
    }
  }

  // ---------------------------------------------------------------- alertas
  function hideAlert() {
    clearTimeout(alertTimer);
    ui.alert.hidden = true;
    ui.alert.className = 'alert';
  }

  function showInfo(text) {
    clearTimeout(alertTimer);
    ui.alertText.textContent = text;
    ui.alertMeta.textContent = '';
    ui.alert.className = 'alert info';
    ui.alert.hidden = false;
  }

  function showEventAlert(e) {
    const key = e.type + (e.side ? `_${e.side}` : '');
    const phrase = PHRASES[key] || NAMES[e.type];
    clearTimeout(alertTimer);
    ui.alertText.textContent = phrase;
    ui.alertMeta.textContent = `rep ${e.rep} · ${e.value.toFixed(0)}° > ${e.threshold.toFixed(0)}°`;
    ui.alert.className = `alert${e.severity === 1 ? ' sev1' : ''}`;
    ui.alert.hidden = false;
    activeAlert = { key, until: performance.now() + 2500 };
    alertTimer = setTimeout(hideAlert, 2500);
    speak(VOICE[key] || phrase, 'alert');
  }

  /** Voz en español. Una alerta corta lo que se estaba diciendo; un aviso de progreso espera su turno. */
  function speak(text, priority) {
    if (!ui.voice.checked || !('speechSynthesis' in window)) return;
    try {
      if (priority === 'alert') window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('es'));
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : 'es-PE';
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (err) {
      console.warn('Sin voz', err);
    }
  }

  // ---------------------------------------------------------------- fin de sesión
  function endSession(reason) {
    if (setup) {                                             // todavía preparando la cámara: solo se apaga
      stopSource();
      ui.placeholder.hidden = false;
      ui.phase.textContent = 'Esperando inicio…';
      ui.phaseSub.textContent = 'Pulsa un botón para comenzar.';
      setButtons(false);
      return;
    }
    if (!session) return;
    session.end(reason);
    onEnded();
  }

  function onEnded() {
    endedShown = true;
    const reason = session.snapshot().endReason;
    emit('session-end', { source, endReason: reason, endedAt: new Date().toISOString(), reps: session.reps,
      events: session.events, baseline: session.snapshot().baseline, config: session.config });
    stopSource();
    if (reason === 'pain_stop') {
      ui.announce.hidden = true;
      showStop('Sesión detenida. Si el dolor sigue, contacta a tu fisioterapeuta.');
      speak('Sesión detenida. Si el dolor sigue, contacta a tu fisioterapeuta.', 'alert');
    } else {
      hideAlert();
      if (reason === 'completed') announce('¡Listo! Sesión completada', { ms: 5000, tone: 'done' });
      else announce('Sesión terminada', { ms: 3000 });
    }
    renderHud(session.snapshot());
    renderPhase(session.snapshot());
    renderReps();
    renderEvents();
    setButtons(false);
    ui.btnNew.disabled = false;
    ui.sourceStatus.textContent = source === 'camera' ? 'Cámara apagada.' : 'Demo terminado.';
  }

  function showStop(text) {
    clearTimeout(alertTimer);
    ui.alertText.textContent = text;
    ui.alertMeta.textContent = '';
    ui.alert.className = 'alert stop';
    ui.alert.hidden = false;
  }

  // ---------------------------------------------------------------- tablas y resumen
  const deg1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const eventName = (e) => `${NAMES[e.type]}${e.side ? ` ${SIDES[e.side]}` : ''}`;

  function renderReps() {
    const snap = session ? session.snapshot() : null;
    const b = snap && snap.baseline;
    ui.baseline.textContent = b
      ? `Línea base (3 repeticiones): rodilla ${deg1(b.knee)}°, tronco ${deg1(b.trunk)}°, valgo izq. ${deg1(b.valgusL)}°, `
        + `valgo der. ${deg1(b.valgusR)}°.`
      : 'La línea base aparece al terminar las 3 repeticiones de calibración.';
    const reps = session ? session.reps : [];
    ui.repsBody.innerHTML = reps.length ? reps.map((r) => `<tr>
      <td class="num">${r.index}</td>
      <td>${r.calibration ? '<span class="tag cal">Calibración</span>' : 'Ejercicio'}</td>
      <td class="num">${deg1(r.kneeRom)}</td><td class="num">${deg1(r.peakTrunk)}</td>
      <td class="num">${deg1(r.peakValgusL)}</td><td class="num">${deg1(r.peakValgusR)}</td>
      <td>${r.romReached === null ? '—' : r.romReached ? '<span class="tag ok">Alcanzado</span>' : '<span class="tag warn">No alcanzado</span>'}</td>
      <td>${r.lowConfidenceRatio > 0.2 ? `<span class="tag warn">Baja (${Math.round(r.lowConfidenceRatio * 100)} %)</span>` : '<span class="tag ok">Buena</span>'}</td>
      <td>${r.events.length ? r.events.map((e) => `<span class="tag bad">${esc(eventName(e))}</span>`).join(' ') : '—'}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="empty">Todavía no hay repeticiones.</td></tr>';
    ui.btnCopy.disabled = reps.length === 0;
  }

  function renderEvents() {
    const events = session ? session.events : [];
    ui.eventsBody.innerHTML = events.length ? events.map((e) => `<tr>
      <td class="num">${e.rep}</td><td>${esc(eventName(e))}</td>
      <td class="num">${deg1(e.value)}</td><td class="num">${deg1(e.peak)}</td><td class="num">${deg1(e.threshold)}</td>
      <td class="num">${e.severity}</td><td class="num">${e.alertLatencyMs == null ? '…' : e.alertLatencyMs}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">Sin alertas.</td></tr>';
  }

  function summaryText() {
    const snap = session.snapshot();
    const cfg = session.config;
    const b = snap.baseline;
    const th = snap.thresholds;
    const lines = [
      `AXONFAS · prototipo de validación · ${new Date().toLocaleString('es-PE')}`,
      `Fuente: ${source === 'demo' ? 'demo sintético' : 'cámara'} · Estado: ${END_TEXT[snap.endReason] || 'en curso'}`,
      b ? `Línea base: rodilla ${deg1(b.knee)}°, tronco ${deg1(b.trunk)}°, valgo izq. ${deg1(b.valgusL)}°, der. ${deg1(b.valgusR)}°`
        : 'Línea base: sin completar',
      `Sobre: tronco +${cfg.trunkMarginDeg}°, valgo +${cfg.valgusMarginDeg}°, rodilla pedida ${th ? `≥ ${deg1(th.romTarget)}°` : 'auto'}, `
        + `confianza mínima ${cfg.minConfidence}`,
      '',
      ...session.reps.map((r) => `Rep ${r.index} (${r.calibration ? 'calibración' : 'ejercicio'}): rodilla ${deg1(r.kneeRom)}°, `
        + `tronco ${deg1(r.peakTrunk)}°, valgo ${deg1(r.peakValgusL)}° / ${deg1(r.peakValgusR)}°`
        + `${r.lowConfidenceRatio > 0.2 ? ', visibilidad baja' : ''}${r.romReached === false ? ', rango no alcanzado' : ''}`),
      '',
      ...(session.events.length ? session.events.map((e) => `Alerta rep ${e.rep}: ${eventName(e)} ${deg1(e.value)}° (pico ${deg1(e.peak)}°, `
        + `umbral ${deg1(e.threshold)}°, severidad ${e.severity}, latencia ${e.alertLatencyMs ?? '?'} ms)`) : ['Sin alertas.']),
    ];
    return lines.join('\n');
  }

  async function copySummary() {
    const text = summaryText();
    try {
      await navigator.clipboard.writeText(text);
      ui.copyStatus.textContent = 'Resumen copiado.';
      ui.copyFallback.hidden = true;
    } catch {
      ui.copyFallback.value = text;
      ui.copyFallback.hidden = false;
      ui.copyFallback.select();
      ui.copyStatus.textContent = 'No se pudo copiar solo: el texto está seleccionado abajo, cópialo con Ctrl+C.';
    }
  }

  // ---------------------------------------------------------------- ajuste por molestia (ADR-021)
  // patient-link.js lo usa cuando el paciente avisa de una molestia en plena sesión: el motor de reglas del servidor ya
  // validó el cambio contra el sobre del fisioterapeuta; aquí solo se aplica. Solo baja la exigencia.
  window.AxonApp = {
    /** Valores vigentes de la sesión en curso: { rom_target, reps (las que faltan) }, o null sin sesión. */
    current() {
      if (!session) return null;
      const snap = session.snapshot();
      if (snap.phase === 'ended') return null;
      const out = {};
      if (snap.thresholds && Number.isFinite(snap.thresholds.romTarget)) out.rom_target = Math.round(snap.thresholds.romTarget);
      const left = session.config.maxReps - session.reps.length;
      if (left >= 1) out.reps = left;
      return Object.keys(out).length ? out : null;
    },
    /** Aplica { param, new } de la respuesta de la API. Devuelve true si cambió algo. */
    adjust(adj) {
      if (!session || !adj || session.snapshot().phase === 'ended') return false;
      if (adj.param === 'rom_target') {
        ui.romAuto.checked = false;
        ui.romTarget.min = Math.min(Number(ui.romTarget.min), adj.new);
        ui.romTarget.value = adj.new;
        ui.romTarget.dispatchEvent(new Event('input', { bubbles: true }));       // setConfig + salidas de la pantalla
        announce(`Bajamos el rango: ahora se pide al menos ${adj.new}°`, { ms: 4000 });
        return true;
      }
      if (adj.param === 'reps') {
        const keep = AxonEngine.DEFAULTS.calibrationReps + 1;                   // nunca menos que calibrar y una más
        const total = Math.min(session.config.maxReps, Math.max(session.reps.length + adj.new, keep));
        ui.maxReps.value = total;
        ui.maxReps.dispatchEvent(new Event('input', { bubbles: true }));
        announce(`Bajamos las repeticiones: ${total - session.reps.length} más`, { ms: 4000 });
        return true;
      }
      return false;
    },
    /** Dolor fuerte o alarma: termina la sesión como "dolor: detener" (I-7). */
    stop() { endSession('pain_stop'); },
  };

  // ---------------------------------------------------------------- eventos de la página
  ui.btnCamera.addEventListener('click', startCamera);
  ui.btnDemo.addEventListener('click', startDemo);
  ui.btnPain.addEventListener('click', () => endSession('pain_stop'));
  ui.btnStop.addEventListener('click', () => endSession('user_quit'));
  ui.btnNew.addEventListener('click', () => (source === 'camera' ? startCamera() : startDemo()));
  ui.btnCopy.addEventListener('click', copySummary);
  ui.btnFullscreen.addEventListener('click', toggleFullscreen);
  ui.guide.addEventListener('toggle', renderGuide);
  if ('speechSynthesis' in window) window.speechSynthesis.getVoices();     // precarga la lista de voces
  renderControls();
  renderGuide();
  camOpts = CS ? CS.renderOptions($('cam-setup'), CS.ENGINE.measures,
    { hint: 'A 2–3 m, a la altura de la cadera, con el cuerpo entero y los pies a la vista.' }) : null;
})();
