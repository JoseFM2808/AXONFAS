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
  // Idioma (ADR-030): se decide al cargar la página, así que los textos fijos se leen una vez aquí.
  const I18N = window.AxonI18n;
  const { t, tn } = I18N;

  const PHRASES = {
    trunk_flexion: t('app.phrase.trunk_flexion'),
    knee_valgus_left: t('app.phrase.knee_valgus_left'),
    knee_valgus_right: t('app.phrase.knee_valgus_right'),
  };
  // La voz dice qué pasa y qué hacer (TD-97): el paciente se corrige sin mirar la pantalla. La pantalla queda corta.
  // Cada idioma dice lo mismo: qué pasa, de qué lado y qué hacer (i18n/session.js, app.voice.*).
  const VOICE = {
    trunk_flexion: t('app.voice.trunk_flexion'),
    knee_valgus_left: t('app.voice.knee_valgus_left'),
    knee_valgus_right: t('app.voice.knee_valgus_right'),
  };
  // Nombre de cada compensación en tablas y resumen, con el lado ya dentro (en inglés va delante: "Left knee valgus").
  const EVENT_NAMES = {
    trunk_flexion: t('app.event.trunk_flexion'),
    knee_valgus: t('app.event.knee_valgus'),
    knee_valgus_left: t('app.event.knee_valgus_left'),
    knee_valgus_right: t('app.event.knee_valgus_right'),
  };
  const NAMES = { trunk_flexion: EVENT_NAMES.trunk_flexion, knee_valgus: EVENT_NAMES.knee_valgus };
  const END_TEXT = { completed: t('app.end.completed'), pain_stop: t('app.end.pain_stop'), user_quit: t('app.end.user_quit') };

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
    announce(tn('app.announce.calStart', cal), { ms: 4000 });
    emit('session-start', { source, startedAt: new Date().toISOString(), config: session.config });
  }

  function setButtons(active) {
    ui.btnPain.disabled = !active;
    ui.btnStop.disabled = !active;
    ui.btnNew.disabled = !source;
    ui.btnCopy.disabled = !session || session.reps.length === 0;
  }

  async function startCamera() {
    // El demo sintético queda abierto; hacer el ejercicio con la cámara pide el triaje del Nivel 1 (ADR-023, ADR-028).
    if (window.AxonTriage && !(await AxonTriage.ensure())) return;
    stopSource();
    const run = await PC.open({
      video: ui.video, canvas: ui.canvas, viewport: ui.viewport,
      status: (text) => { ui.sourceStatus.textContent = text; },
      unsupported: t('app.unsupported'),
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
    ui.phase.textContent = t('app.setup.phase');
    ui.phaseSub.textContent = t('app.setup.where', { how: CS.VIEWS[chosen].how });
    announce(t('app.setup.announce'), { ms: 3000 });
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
      const skip = document.createElement('button');
      skip.className = 'btn';
      skip.type = 'button';
      skip.dataset.camSkip = '';
      skip.textContent = t('app.setup.skip');
      el.append(skip);
    }
    if (r.ready) finishSetup(r);
  }

  function finishSetup(r) {
    if (!setup) return;
    view = r && r.view ? r.view : null;
    disabled = view ? CS.disabledFor(view) : {};
    setup = null;
    $('cam-check').hidden = true;
    ui.sourceStatus.textContent = view ? t('app.status.cameraView', { summary: CS.summary(view, CS.ENGINE.measures) })
      : t('pose.active');
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
    ui.sourceStatus.textContent = t('app.status.demo');
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
    if (lowStreak === LOW_CONFIDENCE_FRAMES_BEFORE_HINT) showInfo(t('app.hint.nobody'));
  }

  function handleFrame(frame, image, t0, draw) {
    const out = session.update(frame);
    emit('frame', { out, image, source, mirror: source === 'camera', view });
    if (out.newEvents.length) emit('event', { events: out.newEvents });
    if (out.lowConfidence) {
      lowStreak += 1;
      if (lowStreak === LOW_CONFIDENCE_FRAMES_BEFORE_HINT) showInfo(t('app.hint.lowConf'));
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
      announce(out.aborted.reason === 'one_leg' ? t('app.announce.oneLeg') : t('app.announce.notStanding'), { ms: 3200 });
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
      announce(t('app.announce.discarded'));
      return;
    }
    if (out.phase === 'ended') return;                       // el cierre lo anuncia onEnded
    const cfg = session.config;
    const done = out.repsDone;
    if (rep.calibration && out.phase === 'exercising') {
      announce(t('app.announce.calDone'), { ms: 3600 });
    } else if (rep.calibration) {
      announce(t('app.announce.calCount', { done, total: cfg.calibrationReps }));
    } else if (done === cfg.maxReps - 1) {
      announce(t('app.announce.last', { done, total: cfg.maxReps }));
    } else {
      announce(t('app.announce.count', { done, total: cfg.maxReps }));
    }
  }

  /** Contador fijo en una esquina del video: fase, repeticiones hechas y barra (calibración, hechas, con alerta). */
  function renderHud(snap) {
    const cfg = session.config;
    ui.hudPhase.textContent = snap.phase === 'ended' ? (END_TEXT[snap.endReason] || t('app.hud.ended'))
      : snap.phase === 'calibrating' ? t('app.hud.calibrating') : t('app.hud.alerts');
    ui.hudDone.textContent = snap.repsDone;
    ui.hudTotal.textContent = cfg.maxReps;
    const flagged = new Set(session.reps.filter((r) => r.events.length).map((r) => r.index));
    ui.hudBar.replaceChildren(...Array.from({ length: cfg.maxReps }, (_, i) => {
      const n = i + 1;
      const seg = document.createElement('span');
      seg.className = [n <= cfg.calibrationReps ? 'cal' : '', n <= snap.repsDone ? 'done' : '', flagged.has(n) ? 'flag' : '']
        .filter(Boolean).join(' ');
      return seg;
    }));
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
      ui.sourceStatus.textContent = t('app.status.fullscreen');
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
  /** Gemelo digital (twin.js, TD-101): esqueleto en espejo y, durante una alerta, la guía de corrección. */
  function drawPose(image, out) {
    const alertKey = activeAlert && activeAlert.until > performance.now() ? activeAlert.key : null;
    AxonTwin.draw(ctx, image, { alertKey, lowConfidence: out.lowConfidence });
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
      const cal = t('app.read.calibrating');
      const limit = (v) => t('app.read.threshold', { deg: v.toFixed(0) });
      setReadout('ro-knee', f(a.knee), th ? t('app.read.target', { deg: th.romTarget.toFixed(0) }) : cal, false, low);
      const off = (k) => (disabled[k] ? t('app.read.off') : null);
      setReadout('ro-trunk', f(a.trunk), off('trunk') || (th ? limit(th.trunk) : cal), !disabled.trunk && th && a.trunk > th.trunk, low);
      setReadout('ro-valgus-l', f(a.valgusL), off('valgus') || (th ? limit(th.valgusL) : cal), !disabled.valgus && th && a.valgusL > th.valgusL, low);
      setReadout('ro-valgus-r', f(a.valgusR), off('valgus') || (th ? limit(th.valgusR) : cal), !disabled.valgus && th && a.valgusR > th.valgusR, low);
      setReadout('ro-conf', a.confidence.toFixed(2), low ? t('app.read.confLow') : t('app.read.confOk'), false, low);
    }
    renderPhase(out);
  }

  function renderPhase(out) {
    const cfg = session.config;
    if (out.phase === 'ended') {
      ui.phase.textContent = END_TEXT[out.endReason] || t('app.end.generic');
      ui.phaseSub.textContent = t('app.phase.endSub', {
        reps: tn('app.count.reps', session.reps.length), alerts: tn('app.count.alerts', session.events.length) });
      return;
    }
    const current = out.repInProgress ? out.repInProgress.index : out.repsDone + 1;
    if (out.phase === 'calibrating') {
      ui.phase.textContent = t('app.phase.calibrating', { done: out.calibrationDone, total: cfg.calibrationReps });
      ui.phaseSub.textContent = out.posture === 'seated' ? t('app.phase.seated')
        : out.posture === 'standing' ? t('app.phase.standing') : t('app.phase.waiting');
    } else {
      ui.phase.textContent = t('app.phase.rep', { n: Math.min(current, cfg.maxReps), total: cfg.maxReps });
      ui.phaseSub.textContent = t('app.phase.alertsOn');
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
    ui.alertMeta.textContent = t('app.alert.meta', { rep: e.rep, value: e.value.toFixed(0), threshold: e.threshold.toFixed(0) });
    ui.alert.className = `alert${e.severity === 1 ? ' sev1' : ''}`;
    ui.alert.hidden = false;
    activeAlert = { key, until: performance.now() + 2500 };
    alertTimer = setTimeout(hideAlert, 2500);
    speak(VOICE[key] || phrase, 'alert');
  }

  /** Voz en el idioma de la página (ADR-030). Una alerta corta lo que se estaba diciendo; un aviso de progreso espera su turno. */
  function speak(text, priority) {
    if (!ui.voice.checked || !('speechSynthesis' in window)) return;
    try {
      if (priority === 'alert') window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = I18N.speechLang();
      const voice = I18N.voiceFor(window.speechSynthesis.getVoices());
      if (voice) u.voice = voice;
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
      ui.phase.textContent = t('index.phase.wait');
      ui.phaseSub.textContent = t('index.phase.waitSub');
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
      showStop(t('app.alert.painStop'));
      speak(t('app.alert.painStop'), 'alert');
    } else {
      hideAlert();
      if (reason === 'completed') announce(t('app.announce.completed'), { ms: 5000, tone: 'done' });
      else announce(t('app.end.generic'), { ms: 3000 });
    }
    renderHud(session.snapshot());
    renderPhase(session.snapshot());
    renderReps();
    renderEvents();
    setButtons(false);
    ui.btnNew.disabled = false;
    ui.sourceStatus.textContent = source === 'camera' ? t('app.status.cameraOff') : t('app.status.demoOff');
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
  const eventName = (e) => EVENT_NAMES[e.type + (e.side ? `_${e.side}` : '')] || NAMES[e.type] || e.type;

  // Filas de las tablas con DOM (nunca innerHTML): celda con texto, celda numérica y etiqueta de color.
  const cell = (content, cls) => {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    if (content && typeof content === 'object' && content.nodeType) td.append(content);
    else if (Array.isArray(content)) td.append(...content);
    else td.textContent = String(content);
    return td;
  };
  const num = (v) => cell(v, 'num');
  const tag = (cls, text) => {
    const s = document.createElement('span');
    s.className = `tag ${cls}`;
    s.textContent = text;
    return s;
  };
  const row = (...cells) => {
    const tr = document.createElement('tr');
    tr.append(...cells);
    return tr;
  };
  const emptyRow = (cols, text) => {
    const td = cell(text, 'empty');
    td.colSpan = cols;
    return row(td);
  };
  /** Varias etiquetas separadas por un espacio, como antes. */
  const tags = (list) => list.flatMap((el, i) => (i ? [document.createTextNode(' '), el] : [el]));

  function renderReps() {
    const snap = session ? session.snapshot() : null;
    const b = snap && snap.baseline;
    ui.baseline.textContent = b
      ? t('app.baseline.done', { knee: deg1(b.knee), trunk: deg1(b.trunk), valgusL: deg1(b.valgusL), valgusR: deg1(b.valgusR) })
      : t('app.baseline.pending');
    const reps = session ? session.reps : [];
    ui.repsBody.replaceChildren(...(reps.length ? reps.map((r) => row(
      num(r.index),
      cell(r.calibration ? tag('cal', t('app.table.calibration')) : t('app.table.exercise')),
      num(deg1(r.kneeRom)), num(deg1(r.peakTrunk)),
      num(deg1(r.peakValgusL)), num(deg1(r.peakValgusR)),
      cell(r.romReached === null ? '—' : r.romReached ? tag('ok', t('app.table.reached')) : tag('warn', t('app.table.notReached'))),
      cell(r.lowConfidenceRatio > 0.2 ? tag('warn', t('app.table.visLow', { pct: Math.round(r.lowConfidenceRatio * 100) }))
        : tag('ok', t('app.table.visOk'))),
      cell(r.events.length ? tags(r.events.map((e) => tag('bad', eventName(e)))) : '—'),
    )) : [emptyRow(9, t('app.table.noReps'))]));
    ui.btnCopy.disabled = reps.length === 0;
  }

  function renderEvents() {
    const events = session ? session.events : [];
    ui.eventsBody.replaceChildren(...(events.length ? events.map((e) => row(
      num(e.rep), cell(eventName(e)),
      num(deg1(e.value)), num(deg1(e.peak)), num(deg1(e.threshold)),
      num(e.severity), num(e.alertLatencyMs == null ? '…' : e.alertLatencyMs),
    )) : [emptyRow(7, t('app.table.noAlerts'))]));
  }

  /** Resumen para pegar en la nota SOAP, en el idioma de la página (lo arma el navegador; la nota del servidor no). */
  function summaryText() {
    const snap = session.snapshot();
    const cfg = session.config;
    const b = snap.baseline;
    const th = snap.thresholds;
    const lines = [
      t('app.summary.head', { date: new Date().toLocaleString(I18N.locale()) }),
      t('app.summary.source', { source: source === 'demo' ? t('app.summary.sourceDemo') : t('app.summary.sourceCamera'),
        state: END_TEXT[snap.endReason] || t('app.summary.inProgress') }),
      b ? t('app.summary.baseline', { knee: deg1(b.knee), trunk: deg1(b.trunk), valgusL: deg1(b.valgusL), valgusR: deg1(b.valgusR) })
        : t('app.summary.noBaseline'),
      t('app.summary.envelope', { trunk: cfg.trunkMarginDeg, valgus: cfg.valgusMarginDeg,
        rom: th ? `≥ ${deg1(th.romTarget)}°` : 'auto', conf: cfg.minConfidence }),
      '',
      ...session.reps.map((r) => t('app.summary.rep', {
        n: r.index, kind: r.calibration ? t('app.summary.kindCal') : t('app.summary.kindEx'),
        knee: deg1(r.kneeRom), trunk: deg1(r.peakTrunk), valgusL: deg1(r.peakValgusL), valgusR: deg1(r.peakValgusR),
        extra: `${r.lowConfidenceRatio > 0.2 ? t('app.summary.lowVis') : ''}${r.romReached === false ? t('app.summary.romMissed') : ''}`,
      })),
      '',
      ...(session.events.length ? session.events.map((e) => t('app.summary.alert', {
        rep: e.rep, name: eventName(e), value: deg1(e.value), peak: deg1(e.peak), threshold: deg1(e.threshold),
        severity: e.severity, latency: e.alertLatencyMs ?? '?',
      })) : [t('app.table.noAlerts')]),
    ];
    return lines.join('\n');
  }

  async function copySummary() {
    const text = summaryText();
    try {
      await navigator.clipboard.writeText(text);
      ui.copyStatus.textContent = t('app.copy.done');
      ui.copyFallback.hidden = true;
    } catch {
      ui.copyFallback.value = text;
      ui.copyFallback.hidden = false;
      ui.copyFallback.select();
      ui.copyStatus.textContent = t('app.copy.manual');
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
        announce(t('app.announce.romLowered', { deg: adj.new }), { ms: 4000 });
        return true;
      }
      if (adj.param === 'reps') {
        const keep = AxonEngine.DEFAULTS.calibrationReps + 1;                   // nunca menos que calibrar y una más
        const total = Math.min(session.config.maxReps, Math.max(session.reps.length + adj.new, keep));
        ui.maxReps.value = total;
        ui.maxReps.dispatchEvent(new Event('input', { bubbles: true }));
        announce(t('app.announce.repsLowered', { n: total - session.reps.length }), { ms: 4000 });
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
    { hint: t('app.setup.hint') }) : null;
})();
