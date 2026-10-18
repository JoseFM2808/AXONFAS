/* AXONFAS · seguimiento con la cámara para cualquier ejercicio de la galería (ADR-014).
 * MediaPipe Pose en el navegador → tracker.js (medida, repeticiones, sostenes) → esqueleto, contador, mapa muscular.
 * No hay alertas de compensación: eso es solo de sentarse y pararse en index.html (ADR-004, ADR-009).
 * Con seguimiento.html?ex=<id>&plan=1 y una cuenta de paciente, sigue la dosis del plan, manda al fisioterapeuta el
 * esqueleto y el conteo unas 5 veces por segundo (nunca video, ADR-003) y guarda la sesión al terminar.
 */
(() => {
  'use strict';

  const LOW_FRAMES_BEFORE_HINT = 15;
  const LIVE_POINTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];   // lo único que sale del equipo
  const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
    [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [7, 0], [0, 8]];

  const C = window.AxonCatalog;
  const B = window.AxonBodyMap;
  const T = window.AxonTracker;
  const A = window.AxonApi;
  const GF = window.AxonGuide;
  const CS = window.AxonCameraSetup;
  const PC = window.AxonPoseCamera;                         // cámara y MediaPipe compartidos con app.js (TD-50)
  const SG = window.AxonSuggest;                            // consejos de uso al terminar (ADR-017)
  const P = window.AxonPractice;                            // tutorial y rutina sin cámara (TD-109, TD-110)
  const S = T.SIDES;
  const I18N = window.AxonI18n;                            // textos y voz en el idioma de la interfaz (ADR-030)
  const { t, tn } = I18N;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  // Puntos que se resaltan en el esqueleto según la medida; el del medio (o el promedio) lleva el número.
  const FOCUS = {
    kneeFlex: (s) => [s.hip, s.kn, s.an], hipFlex: (s) => [s.sh, s.hip, s.kn], hipLine: (s) => [s.sh, s.hip, s.kn],
    straightLegRaise: (s) => [s.sh, s.hip, s.kn], kneeStraightRaised: (s) => [s.hip, s.kn, s.an],
    shoulderElev: (s) => [s.hip, s.sh, s.el], elbowFlex: (s) => [s.sh, s.el, s.wr], armHang: (s) => [s.sh, s.el, s.wr],
    crossArm: (s) => [s.osh, s.sh, s.el], forearmRot: (s) => [s.el, s.wr], heelRise: (s) => [s.an, s.heel, s.toe],
    thighSpread: () => [25, 23, 24, 26], trunkLean: () => [11, 12, 24, 23], trunkRot: () => [11, 12, 24, 23],
    neckTilt: () => [7, 8, 12, 11], headForward: () => [7, 8, 12, 11], footLift: () => [27, 28], feetInLine: () => [27, 28],
    birdDog: () => [13, 11, 23, 25, 14, 12, 24, 26], standHeight: () => [23, 24, 28, 27],
  };

  const ui = {
    select: $('ex-select'), video: $('video'), canvas: $('overlay'), viewport: $('viewport'), placeholder: $('placeholder'),
    phase: $('phase'), phaseSub: $('phase-sub'), alert: $('alert'), alertText: $('alert-text'), alertMeta: $('alert-meta'),
    hud: $('hud'), hudPhase: $('hud-phase'), hudDone: $('hud-done'), hudTotal: $('hud-total'), hudSub: $('hud-sub'),
    hudBar: $('hud-bar'), announce: $('announce'), status: $('source-status'), voice: $('voice'),
    btnCamera: $('btn-camera'), btnHold: $('btn-hold'), btnRecal: $('btn-recal'), btnFull: $('btn-fullscreen'),
    btnPain: $('btn-pain'), btnStop: $('btn-stop'), repsBody: $('reps-body'),
    btnTutorial: $('btn-tutorial'), btnNoCam: $('btn-nocam'), practice: $('practice'),
    holdBadge: $('hold-badge'), holdLabel: $('hold-label'), holdNum: $('hold-num'), holdBar: $('hold-bar'),
  };
  const ctx = ui.canvas.getContext('2d');

  const st = {
    camOpts: null, camMeasures: null, setup: null, view: null, lastCheck: 0,
    ex: null, spec: null, dose: null, tracker: null, map: null,
    cam: null, lowStreak: 0, lastMap: 0,
    startedAt: null, ended: false, lastPartialSpoken: 0, lastShortSpoken: 0, guides: [], cues: null, holdFlashUntil: 0,
    patient: null, item: null, symptomIds: [], turnIds: [], lastSent: 0, inFlight: false, saved: false, frames: 0, lowFrames: 0, lastOut: null,
    lastLimitSpoken: 0,
    practice: null,        // { mode: 'tutorial' | 'offer' | 'nocam', reason?, counter?, guide? } (TD-109, TD-110)
  };

  const cssCache = {};
  const cssVar = (name) => (cssCache[name] ??= getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  const fmt = (v, unit) => (v == null || !Number.isFinite(v) ? '—' : `${unit === 'cm' ? v.toFixed(1) : Math.round(v)}${unit === '%' ? ' %' : unit === 'cm' ? ' cm' : '°'}`);
  const sideText = (side) => T.sideName(side);

  // ------------------------------------------------------------------ ejercicio
  function fillSelect() {
    ui.select.replaceChildren();
    C.THEMES.forEach((theme) => {
      const group = document.createElement('optgroup');
      group.label = theme.name;
      C.EXERCISES.filter((e) => e.theme === theme.id).forEach((e) => {
        const o = document.createElement('option');
        o.value = e.id;
        o.textContent = T.SPECS[e.id].quality === 'limited' ? t('tracking.select.limited', { name: e.name }) : e.name;
        group.appendChild(o);
      });
      ui.select.appendChild(group);
    });
  }

  function doseText() {
    const d = st.dose;
    const tg = T.targetFor(st.spec, d);
    const what = st.spec.mode === 'reps'
      ? (st.spec.perSide ? tn('tracking.dose.setsSide', d.sets, { reps: d.reps }) : tn('tracking.dose.sets', d.sets, { reps: d.reps }))
      : (st.spec.perSide ? tn('tracking.dose.timesSide', d.reps) : tn('tracking.dose.times', d.reps));
    const r = st.item && st.item.rest ? st.item.rest : { min: C.REST_DEFAULT_SECONDS, max: C.REST_DEFAULT_SECONDS, default: true };
    const range = r.min === r.max ? `${r.min} s` : `${r.min}–${r.max} s`;
    const rest = r.default ? t('tracking.dose.suggested', { rest: range }) : range;
    return [what, d.hold ? t('tracking.dose.hold', { s: d.hold }) : null, t('tracking.dose.rest', { rest, total: tg.total })]
      .filter(Boolean).join(' · ');
  }

  /** Descanso recomendado al terminar una serie (ADR-022): es una guía, el conteo sigue activo y no bloquea nada. */
  let restView = null;
  function startRest() {
    stopRest();
    if (!window.AxonRest) return;
    const rest = st.item && st.item.rest ? st.item.rest : { min: C.REST_DEFAULT_SECONDS, max: C.REST_DEFAULT_SECONDS, default: true };
    restView = AxonRest.mount($('rest-track'), { rest, speak: (t) => speak(t) });
  }
  function stopRest() {
    if (restView) { restView.stop(); restView = null; }
    if ($('rest-track')) $('rest-track').replaceChildren();
  }

  function setExercise(id) {
    stopCamera();
    hidePractice();
    st.ex = C.get(id) || C.get('half-squat');
    // En modo paciente, la meta de recorrido y su límite son los del plan del fisioterapeuta (ADR-025).
    st.spec = T.withGoal(T.SPECS[st.ex.id], st.item && st.item.exercise_id === st.ex.id ? st.item.range_goal : null);
    st.dose = st.item ? { sets: st.item.sets, reps: st.item.reps, hold: st.item.hold_seconds }
      : { sets: st.ex.dose.sets, reps: st.ex.dose.reps, hold: st.ex.dose.hold };
    st.tracker = null;
    st.ended = false;
    ui.select.value = st.ex.id;
    document.title = t('tracking.doc.title', { name: st.ex.name });
    $('ex-title').textContent = st.ex.name;
    $('ex-goal').textContent = st.ex.goal;
    const lim = $('ex-limited');
    lim.hidden = st.spec.quality !== 'limited';
    lim.textContent = st.spec.quality === 'limited' ? t('tracking.limited', { note: T.noteText(st.ex.id) }) : '';
    $('ph-title').textContent = st.spec.mode === 'manual' ? t('tracking.ph.manual') : t('tracking.ph.title');
    $('ph-camera').textContent = t('tracking.ph.camera', { camera: T.cameraText(st.ex.id) });
    $('how-position').textContent = t('tracking.how.position', { position: st.ex.position });
    $('how-camera').textContent = T.cameraText(st.ex.id);
    $('how-dose').textContent = st.item ? t('tracking.how.dosePlan', { dose: doseText() })
      : t('tracking.how.doseSource', { dose: doseText(), source: st.ex.dose.text });
    const list = (el, items) => { el.replaceChildren(...items.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; })); };
    list($('how-steps'), st.ex.steps);
    list($('how-prec'), st.ex.precautions);
    const src = $('how-source');
    const a = document.createElement('a');
    a.href = st.ex.source.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `${st.ex.source.org} · ${st.ex.source.title}`;
    I18N.fill(src, 'tracking.how.source', { link: a, name: st.ex.sourceName });
    st.map = B.render($('live-map'), { intensities: B.estimateLoad(st.ex, null, 0) });
    mountGuides();
    // 1 · Dónde va la cámara (ADR-015): alternativas con la calidad de la medida de este ejercicio
    st.camMeasures = CS.measuresFor(st.ex.id, 'track', T);
    st.camOpts = CS.renderOptions($('cam-setup'), st.camMeasures.measures, { hint: T.cameraText(st.ex.id) });
    st.view = null;
    ui.btnHold.hidden = st.spec.mode !== 'manual';
    ui.placeholder.hidden = false;
    ui.hud.hidden = true;
    ui.holdBadge.hidden = true;
    hideAlert();
    renderReadouts(null);
    renderReps();
    if ($('tips')) $('tips').replaceChildren();
    setPhase(t('tracking.phase.waiting'), t('tracking.phase.waitingSub'));
    setButtons(false);
  }

  /** Figura de referencia (componente .fig del design system): pequeña sobre el video y grande en "Cómo se hace". */
  function mountGuides() {
    st.guides.forEach((g) => g.stop());
    st.guides = [];
    st.cues = GF ? GF.cuesFor(st.ex.id) : null;
    if (!GF || !st.cues) return;
    st.guides.push(GF.render($('pip-guide'), st.ex.id, { hold: st.dose.hold, variant: 'pip', autoplay: 'always' }));
    st.guides.push(GF.render($('how-guide'), st.ex.id, { hold: st.dose.hold, variant: 'large', autoplay: 'visible' }));
  }

  ui.select.addEventListener('change', () => {
    history.replaceState(null, '', `seguimiento.html?ex=${encodeURIComponent(ui.select.value)}`);
    setExercise(ui.select.value);
  });

  // ------------------------------------------------------------------ cámara
  async function startCamera() {
    stopCamera();
    const run = await PC.open({
      video: ui.video, canvas: ui.canvas, viewport: ui.viewport,
      status: (text) => { ui.status.textContent = text; },
      unsupported: t('tracking.cam.unsupported'),
      onFail: (kind) => offerNoCamera(kind),            // sin cámara la rutina sigue (TD-110)
    });
    if (!run) return;
    hidePractice();
    st.cam = run;
    startSetup();
    st.cam.start(onCameraResult);
  }

  function stopCamera() {
    st.setup = null;
    $('cam-check').hidden = true;
    if (st.cam) { st.cam.stop(); st.cam = null; }
    ui.video.srcObject = null;
  }

  /** Un frame nuevo de la cámara (pose-camera.js): primero la preparación, después el seguimiento. */
  function onCameraResult({ image, world, t }) {
    if (st.setup) onSetupFrame(image, t);
    else if (world && image) onFrame({ t, world, visibility: image }, image);
    else onNoPose(t);
  }

  // ------------------------------------------------------------------ preparar la cámara (ADR-015)
  function startSetup() {
    const chosen = st.camOpts ? st.camOpts.selected : 'diagonal';
    st.setup = CS.createCheck({ measures: st.camMeasures.measures, need: st.camMeasures.need, chosen });
    st.setup.chosen = chosen;
    ui.placeholder.hidden = true;
    ui.hud.hidden = true;
    $('cam-check').hidden = false;
    setPhase(t('tracking.setup.phase'), `${CS.VIEWS[chosen].how}. ${T.cameraText(st.ex.id)}`);
    announce(t('tracking.setup.announce'), { ms: 3000 });
    setButtons(true);
  }

  function onSetupFrame(image, t) {
    const aspect = (ui.video.videoWidth || 16) / (ui.video.videoHeight || 9);
    const r = st.setup.update(image, t, aspect);
    if (image) drawPose(image, { side: null, progress: 0, lowConfidence: false, value: null });
    else ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    if (t - st.lastCheck > 150 || r.ready) {
      st.lastCheck = t;
      const el = $('cam-check');
      CS.renderCheck(el, r, st.setup.chosen);
      const skip = document.createElement('button');
      skip.className = 'btn';
      skip.type = 'button';
      skip.dataset.camSkip = '';
      skip.textContent = t('tracking.setup.skip');
      el.append(skip);
    }
    if (r.ready) finishSetup(r);
  }

  function finishSetup(r) {
    if (!st.setup) return;
    st.view = r && r.view ? r.view : null;
    st.setup = null;
    $('cam-check').hidden = true;
    const q = st.view ? CS.qualityOf(st.camMeasures.measures, st.view)[0] : null;
    ui.status.textContent = st.view ? t('tracking.setup.done', { view: CS.VIEWS[st.view].short, quality: `${q.label.toLowerCase()} ${q.text}` })
      : t('tracking.setup.doneNoView');
    startSession();
  }

  $('cam-check').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-cam-skip]') && st.setup) finishSetup(st.setup.last);
  });

  // ------------------------------------------------------------------ sesión
  function startSession() {
    st.tracker = T.createTracker(st.spec, st.dose);
    st.startedAt = new Date().toISOString();
    st.ended = false;
    st.saved = false;
    st.symptomIds = [];
    st.turnIds = [];
    st.lowStreak = 0;
    st.frames = 0;
    st.lowFrames = 0;
    st.lastOut = null;
    ui.placeholder.hidden = true;
    ui.hud.hidden = false;
    hideAlert();
    renderReps();
    renderHud(null);
    setButtons(true);
    const first = st.spec.mode === 'reps' ? t('tracking.start.reps')
      : st.spec.mode === 'hold' ? t('tracking.start.hold') : t('tracking.start.manual');
    announce(st.view ? t('tracking.start.ready', { next: first }) : first, { ms: 3500 });
  }

  function onNoPose(t) {
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    if (!st.tracker) return;
    const out = st.tracker.update({ t, world: blankPose(), visibility: null });
    handleOut(out, null);
  }

  // Un frame sin persona: puntos con visibilidad 0, así el contador sabe que no ve a nadie (cancela sostenes manuales).
  let blank = null;
  function blankPose() {
    if (!blank) blank = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    return blank;
  }

  function onFrame(frame, image) {
    if (!st.tracker) return;
    const out = st.tracker.update(frame);
    drawPose(image, out);
    handleOut(out, image);
  }

  function handleOut(out, image) {
    st.frames += 1;
    st.lastOut = out;
    if (out.lowConfidence) st.lowFrames += 1;
    if (out.lowConfidence) {
      st.lowStreak += 1;
      if (st.lowStreak === LOW_FRAMES_BEFORE_HINT) showInfo(t('tracking.info.lowConf', { camera: T.cameraText(st.ex.id) }));
    } else {
      if (st.lowStreak >= LOW_FRAMES_BEFORE_HINT) hideAlert();
      st.lowStreak = 0;
    }
    out.events.forEach(onEvent);
    renderHold(out);
    renderReadouts(out);
    renderHud(out);
    renderPhase(out);
    const now = performance.now();
    if (now - st.lastMap > 120) {
      st.lastMap = now;
      st.map.update({ intensities: B.estimateLoad(st.ex, null, out.lowConfidence ? 0 : out.progress) });
    }
    publishLive(out, image);
    if (out.phase === 'done' && !st.ended) finish('completed');
  }

  function onEvent(e) {
    const tg = st.tracker.target;
    switch (e.type) {
      case 'ready': announce(t('tracking.ev.ready'), { ms: 1800 }); break;
      case 'hold_start': stopRest(); if (e.seconds) speak(t('tracking.voice.hold')); break;
      case 'hold_done':
        st.holdFlashUntil = performance.now() + 1500;
        speak(st.spec.mode === 'reps' ? t('tracking.voice.holdDoneReps') : t('tracking.voice.holdDone'));
        break;
      case 'hold_short': {
        const now = performance.now();
        showInfo(t('tracking.info.holdShort', { s: e.seconds, need: e.needed || tg.hold }), 4000);
        if (now - st.lastShortSpoken > 5000) { st.lastShortSpoken = now; speak(t('tracking.voice.holdShort')); }
        break;
      }
      case 'hold_lost': showInfo(t('tracking.info.holdLost'), 2500); break;
      case 'over_limit': {                                // dosis, no alerta (I-12): la repetición cuenta igual
        const now = performance.now();
        const unit = T.METRICS[st.spec.metric].unit;
        showInfo(t('tracking.info.overLimit', { limit: fmt(e.limit, unit) }), 3500);
        if (now - st.lastLimitSpoken > 6000) { st.lastLimitSpoken = now; speak(t('tracking.voice.overLimit')); }
        break;
      }
      case 'partial': {
        const now = performance.now();
        showInfo(t('tracking.info.partial'), 2200);
        if (now - st.lastPartialSpoken > 6000) { st.lastPartialSpoken = now; speak(t('tracking.voice.partial')); }
        break;
      }
      case 'rep': {
        stopRest();                                       // empezó la siguiente serie: el descanso se cierra en silencio
        const n = e.index % tg.perSet || tg.perSet;
        if (e.index < tg.total && n < tg.perSet) speak(String(n));
        renderReps();
        break;
      }
      case 'set_done': if (!previewEnds()) { announce(t('tracking.ev.setDone', { set: e.set }), { ms: 3200 }); startRest(); } break;
      default: break;
    }
  }

  function finish(reason) {
    if (st.practice && st.practice.mode === 'nocam') { finishNoCamera(reason); return; }
    if (st.practice) { hidePractice(); setButtons(false); return; }   // tutorial u oferta: no hay sesión que cerrar
    if (st.setup) {                                       // todavía preparando la cámara: solo se apaga
      stopCamera();
      setButtons(false);
      ui.placeholder.hidden = false;
      setPhase(t('tracking.phase.waiting'), t('tracking.phase.waitingSub'));
      return;
    }
    if (!st.tracker || st.ended) return;
    st.ended = true;
    stopRest();
    ui.holdBadge.hidden = true;
    st.tracker.end();
    stopCamera();
    const reps = st.tracker.reps.length;
    if (reason === 'pain_stop') {
      hideAnnounce();
      showStop(t('tracking.end.pain'));
      speak(t('tracking.end.pain'), true);
    } else if (reason === 'completed') {
      announce(t('tracking.end.completed'), { ms: 5000, tone: 'done' });
    } else {
      announce(t('tracking.end.ended'), { ms: 2500 });
    }
    setPhase(reason === 'completed' ? t('tracking.end.phaseCompleted') : reason === 'pain_stop' ? t('tracking.end.phasePain') : t('tracking.end.phaseEnded'),
      tn('tracking.end.repsOf', reps, { total: st.tracker.target.total }));
    ui.status.textContent = t('tracking.status.camOff');
    setButtons(false);
    renderReps();
    renderTips(reps);
    saveSession(reason, reps);
  }

  /** Consejos de uso según cómo fue la sesión (rol usuario, ADR-017). Nunca cambian la dosis. */
  function renderTips(reps) {
    if (!SG || !$('tips')) return;
    const o = st.lastOut || {};
    const session = { count: reps, total: st.tracker.target.total, partials: o.partials || 0, shortHolds: o.shortHolds || 0,
      lowConfidenceRatio: st.frames ? st.lowFrames / st.frames : 0, view: st.view,
      recommended: st.camMeasures ? CS.recommend(st.camMeasures.measures) : null };
    SG.renderList($('tips'), SG.forUser({ page: 'session', profile: st.patient ? st.patient.profile : null, session }), {
      title: t('tracking.tips.title'), note: t('tracking.tips.note'), empty: t('tracking.tips.empty') });
  }

  function setButtons(active) {
    ui.btnPain.disabled = !active;
    ui.btnStop.disabled = !active;
    ui.btnRecal.disabled = !active || st.spec.mode !== 'reps';
    ui.btnHold.disabled = !active;
    ui.btnCamera.textContent = active ? t('tracking.btn.restart') : t('tracking.btn.camera');
    ui.btnTutorial.disabled = active;
    ui.btnNoCam.disabled = active;
  }

  // ------------------------------------------------------------------ pintar
  function setPhase(label, sub) {
    ui.phase.textContent = label;
    ui.phaseSub.textContent = sub;
  }

  /** Qué hacer ahora, con los textos de la figura de referencia: posición inicial → movimiento → sostén → vuelta. */
  function renderPhase(out) {
    if (st.ended) return;
    const c = st.cues || {};
    const hold = st.tracker.target.hold;
    const left = out.holdMs != null && hold ? Math.max(0, Math.ceil(hold - out.holdMs / 1000)) : null;
    const holdLeft = left != null ? t('tracking.phase.holdLeft', { s: left }) : null;
    if (out.phase === 'setup') setPhase(t('tracking.phase.start'), t('tracking.phase.startSub', { start: c.start || t('tracking.phase.startDefault') }));
    else if (st.spec.mode === 'reps') {
      if (out.state !== 'up') setPhase(c.go || st.ex.name, t('tracking.phase.fill'));
      else if (holdLeft) setPhase(holdLeft, t('tracking.phase.holdSub'));
      else if (out.holdDone || !hold) setPhase(c.back || t('tracking.phase.backDefault'), t('tracking.phase.backSub'));
      else setPhase(c.go || st.ex.name, t('tracking.phase.refill'));
    } else if (st.spec.mode === 'hold') {
      setPhase(holdLeft || c.go || t('tracking.phase.holdDefault'), t('tracking.phase.holdEach', { s: hold }));
    } else {
      setPhase(holdLeft || t('tracking.phase.tapHold'), holdLeft ? (c.go || '') : t('tracking.phase.manualSub'));
    }
  }

  function renderHold(out) {
    const hold = st.tracker.target.hold;
    const flash = performance.now() < st.holdFlashUntil;
    const counting = hold && out.holdMs != null && !out.lowConfidence;
    const done = (st.spec.mode === 'reps' && out.state === 'up' && out.holdDone) || flash;
    ui.holdBadge.hidden = st.ended || !(counting || done);
    if (ui.holdBadge.hidden) return;
    ui.holdBadge.classList.toggle('done', Boolean(done && !counting));
    if (done && !counting) {
      ui.holdLabel.textContent = st.spec.mode === 'reps' ? t('tracking.hold.doneReps') : t('tracking.hold.done');
      ui.holdNum.textContent = '0';
      ui.holdBar.style.width = '100%';
    } else {
      const elapsed = out.holdMs / 1000;
      ui.holdLabel.textContent = t('tracking.hold.label');
      ui.holdNum.textContent = String(Math.max(0, Math.ceil(hold - elapsed)));
      ui.holdBar.style.width = `${Math.min(100, (elapsed / hold) * 100).toFixed(0)}%`;
    }
  }

  function renderHud(out) {
    const tg = st.tracker.target;
    const count = out ? out.count : 0;
    const set = Math.min(tg.sets, Math.floor(count / tg.perSet) + 1);
    const inSet = count >= tg.total ? tg.perSet : count % tg.perSet;
    ui.hudPhase.textContent = tg.sets > 1 ? t('tracking.hud.set', { set, sets: tg.sets }) : (st.spec.mode === 'reps' ? t('tracking.hud.reps') : t('tracking.hud.holds'));
    ui.hudDone.textContent = inSet;
    ui.hudTotal.textContent = tg.perSet;
    let sub = '';
    if (out && out.phase === 'setup') sub = t('tracking.hud.setup');
    else if (out && out.holdMs != null && tg.hold) sub = t('tracking.hud.holdLeft', { s: Math.max(0, tg.hold - out.holdMs / 1000).toFixed(0) });
    else if (st.spec.perSide) sub = t('tracking.hud.bothSides');
    ui.hudSub.textContent = sub;
    if (ui.hudBar.childElementCount !== tg.perSet) ui.hudBar.replaceChildren(...Array.from({ length: tg.perSet }, () => document.createElement('span')));
    Array.from(ui.hudBar.children).forEach((el, i) => el.classList.toggle('done', i < inSet));
  }

  function setKpi(id, v, s) {
    const el = $(id);
    el.querySelector('.v').textContent = v;
    if (s != null) el.querySelector('.s').textContent = s;
  }

  function renderReadouts(out) {
    const metric = T.METRICS[st.spec.metric];
    const unit = metric.unit;
    $('ro-label').textContent = T.metricLabel(st.spec.metric);
    const live = out && out.side ? t('tracking.ro.liveSide', { side: sideText(out.side) }) : t('tracking.ro.live');
    setKpi('ro-value', fmt(out && !out.lowConfidence ? out.value : null, unit), out && out.lowConfidence ? t('tracking.ro.low') : live);
    $('ro-meter').style.width = `${Math.round((out ? out.progress : 0) * 100)}%`;
    $('ro-value').classList.toggle('on', Boolean(out && out.progress >= 1));
    if (st.spec.mode === 'reps') {
      setKpi('ro-rest', fmt(out ? out.rest : null, unit), out && out.phase === 'setup' ? t('tracking.ro.settle') : t('tracking.ro.restSub'));
      const sense = st.spec.dir === 0 ? t('tracking.ro.anyDir') : st.spec.dir > 0 ? t('tracking.ro.more') : t('tracking.ro.less');
      setKpi('ro-goal', fmt(st.spec.delta, unit), goalNote(sense, unit));
    } else if (st.spec.mode === 'hold') {
      setKpi('ro-rest', '—', t('tracking.ro.noRest'));
      setKpi('ro-goal', `${st.spec.dir >= 0 ? '≥' : '≤'} ${fmt(st.spec.threshold, unit)}`, goalNote(t('tracking.ro.whileHold'), unit));
    } else {
      setKpi('ro-rest', '—', t('tracking.ro.noRest'));
      setKpi('ro-goal', t('tracking.ro.youMark'), t('tracking.ro.notSeen'));
    }
    const hold = st.dose.hold;
    const left = out && out.holdMs != null && hold ? Math.max(0, hold - out.holdMs / 1000) : null;
    setKpi('ro-hold', hold ? (left != null ? `${left.toFixed(1)} s` : `${hold} s`) : t('tracking.ro.noHold'),
      hold ? (left != null ? t('tracking.ro.left') : t('tracking.ro.eachRep')) : t('tracking.ro.noHoldSub'));
    $('ro-hold').classList.toggle('on', left != null);
  }

  /** Debajo de la meta: si la fijó el fisioterapeuta, lo dice junto con el límite (ADR-025). */
  function goalNote(sense, unit) {
    if (st.spec.goalFrom !== 'plan') return sense;
    return t('tracking.ro.planGoal', { limit: fmt(st.spec.limit, unit) });
  }

  function renderReps() {
    const reps = st.tracker ? st.tracker.reps : [];
    const unit = T.METRICS[st.spec.metric].unit;
    const hold = st.dose.hold;
    if (!reps.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'empty';
      td.textContent = t('tracking.reps.empty');
      tr.appendChild(td);
      ui.repsBody.replaceChildren(tr);
      return;
    }
    ui.repsBody.replaceChildren(...reps.slice().reverse().map((r) => {
      const tr = document.createElement('tr');
      const cells = [String(r.index), sideText(r.side), r.peak != null ? fmt(r.peak, unit) : '—',
        hold ? `${r.holdSec ?? 0} s ✓` : '—', `${r.seconds} s`];
      cells.forEach((c, i) => {
        const td = document.createElement('td');
        if (i === 0 || i >= 2) td.className = 'num';
        td.textContent = c;
        tr.appendChild(td);
      });
      return tr;
    }));
  }

  function drawPose(image, out) {
    const w = ui.canvas.width;
    const h = ui.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!image) return;
    const focusFn = FOCUS[st.spec.metric] || (() => []);
    const sided = T.METRICS[st.spec.metric].sided;
    const sides = sided ? (out.side ? [S[out.side]] : [S.L, S.R]) : [null];
    const focusSets = sides.map((s) => focusFn(s));
    const focus = new Set(focusSets.flat());
    const atTarget = out.progress >= 1;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(4, w / 220);
    for (const [a, b] of SKELETON) {
      const p = image[a];
      const q = image[b];
      if (!p || !q) continue;
      const on = focus.has(a) && focus.has(b);
      ctx.strokeStyle = on ? (atTarget ? cssVar('--safe') : cssVar('--tape')) : 'rgba(224, 233, 236, 0.55)';
      ctx.globalAlpha = Math.min(p.visibility, q.visibility) < 0.5 ? 0.3 : 1;
      ctx.lineWidth = on ? Math.max(6, w / 150) : Math.max(3, w / 300);
      ctx.beginPath();
      ctx.moveTo(p.x * w, p.y * h);
      ctx.lineTo(q.x * w, q.y * h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (out.lowConfidence || out.value == null) return;
    // El número va junto a la articulación que se mide; el lienzo está espejado, así que el texto se vuelve a girar.
    const pts = focusSets[0].length === 3 ? [focusSets[0][1]] : focusSets[0];
    const anchor = pts.map((i) => image[i]).filter(Boolean);
    if (!anchor.length) return;
    const x = (anchor.reduce((s, p) => s + p.x, 0) / anchor.length) * w;
    const y = (anchor.reduce((s, p) => s + p.y, 0) / anchor.length) * h;
    const text = fmt(out.value, T.METRICS[st.spec.metric].unit);
    const size = Math.round(Math.max(22, w / 32));
    ctx.save();
    ctx.translate(x, y);
    if (ui.viewport.classList.contains('mirror')) ctx.scale(-1, 1);
    ctx.font = `800 ${size}px ${cssVar('--font-mono') || 'monospace'}`;
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(3, 7, 18, 0.8)';
    ctx.fillRect(size * 0.5, -size * 0.7, tw + size * 0.6, size * 1.4);
    ctx.fillStyle = atTarget ? cssVar('--safe') : '#FFFFFF';
    ctx.fillText(text, size * 0.8, 0);
    ctx.restore();
  }

  // ------------------------------------------------------------------ avisos y voz
  let announceTimer = 0;
  let alertTimer = 0;
  function announce(text, { ms = 2600, tone = '' } = {}) {
    clearTimeout(announceTimer);
    ui.announce.textContent = text;
    ui.announce.className = `announce${tone ? ` ${tone}` : ''}`;
    ui.announce.hidden = false;
    announceTimer = setTimeout(hideAnnounce, ms);
    speak(text);
  }
  function hideAnnounce() { ui.announce.hidden = true; }
  function showInfo(text, ms = 0) {
    clearTimeout(alertTimer);
    ui.alertText.textContent = text;
    ui.alertMeta.textContent = '';
    ui.alert.className = 'alert info';
    ui.alert.hidden = false;
    if (ms) alertTimer = setTimeout(hideAlert, ms);
  }
  function showStop(text) {
    clearTimeout(alertTimer);
    ui.alertText.textContent = text;
    ui.alertMeta.textContent = '';
    ui.alert.className = 'alert stop';
    ui.alert.hidden = false;
  }
  function hideAlert() { clearTimeout(alertTimer); ui.alert.hidden = true; }

  function speak(text, urgent = false) {
    if (!ui.voice.checked || !('speechSynthesis' in window)) return;
    try {
      if (urgent) window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = I18N.speechLang();                                 // voz del idioma de la interfaz (ADR-030)
      const voice = I18N.voiceFor(window.speechSynthesis.getVoices());
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (err) { console.warn('Sin voz', err); }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('stage').requestFullscreen();
    } catch { ui.status.textContent = t('tracking.status.noFullscreen'); }
  }

  // ------------------------------------------------------------------ modo paciente (ADR-012)
  function publishLive(out, image) {
    if (!st.item || st.inFlight || st.ended) return;
    const now = performance.now();
    if (now - st.lastSent < 200) return;                        // ~5 por segundo
    st.lastSent = now;
    const points = {};
    if (image) LIVE_POINTS.forEach((i) => { if (image[i]) points[String(i)] = [image[i].x, image[i].y]; });
    const metric = T.METRICS[st.spec.metric];
    st.inFlight = true;
    A.call('patient', 'POST', '/api/live', {
      exercise_id: st.ex.id, source: 'camera', phase: out.phase === 'setup' ? 'setup' : 'tracking',
      reps_done: out.count, reps_total: st.tracker.target.total, points, mirror: true, view: st.view || undefined,
      progress: out.lowConfidence ? 0 : out.progress,
      // La etiqueta viaja con el texto base de tracker.js (dato para el servidor, no se traduce aquí).
      metric: out.value == null || out.lowConfidence ? undefined : { label: metric.label, value: out.value, unit: metric.unit },
    }).catch(() => {}).finally(() => { st.inFlight = false; });
  }

  /**
   * Muro de autenticación diferido (TD-107): sin cuenta (invitado o visita), la rutina libre es una vista previa de una
   * serie; la rutina completa y guardar el progreso piden crear una cuenta. Con el plan de un paciente no aplica.
   */
  function previewEnds() {
    const W = window.AxonWall;
    const sets = st.practice && st.practice.counter ? st.practice.counter.state().sets : st.tracker ? st.tracker.target.sets : 1;
    if (st.item || !W || W.hasAccount() || sets <= 1) return false;
    finish('user_quit');
    announce(t('tracking.preview.end'), { ms: 3500 });
    W.require(t('tracking.wall.fullRoutine'));                 // el motivo ya va traducido: auth-wall.js lo inserta tal cual
    return true;
  }

  // ------------------------------------------------------------------ tutorial y rutina sin cámara (TD-109, TD-110)
  function practiceBtn(text, cls, onClick, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${cls || ''}`.trim();
    b.textContent = text;
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  /** Muestra el panel de práctica con la guía en grande (componente .fig) en lugar del video. */
  function showPractice(mode, { title, text, note, actions }) {
    stopCamera();
    if (st.practice && st.practice.guide) st.practice.guide.stop();
    const guide = GF && st.cues ? GF.render($('practice-guide'), st.ex.id, { hold: st.dose.hold, variant: 'large', autoplay: 'always' }) : null;
    st.practice = Object.assign(st.practice && st.practice.mode === mode ? st.practice : {}, { mode, guide });
    ui.practice.hidden = false;
    ui.viewport.hidden = true;
    $('practice-title').textContent = title;
    $('practice-text').textContent = text;
    $('practice-note').hidden = !note;
    $('practice-note').textContent = note || '';
    $('practice-count').hidden = mode !== 'nocam';
    $('practice-actions').replaceChildren(...actions);
    $('practice-title').focus();
  }

  function hidePractice() {
    if (st.practice && st.practice.guide) st.practice.guide.stop();
    st.practice = null;
    if (ui.practice) ui.practice.hidden = true;
    ui.viewport.hidden = false;
  }

  /** Tutorial (shadowing): la animación en grande para seguirla antes de la evaluación con cámara. Nada se cuenta. */
  function showTutorial() {
    showPractice('tutorial', {
      title: t('tracking.tutorial.title'),
      text: t('tracking.tutorial.text', { dose: doseText() }),
      note: t('tracking.tutorial.note'),
      actions: [
        practiceBtn(t('tracking.tutorial.toCamera'), 'primary', () => { P.markSeen(st.ex.id); startCamera(); }),
        practiceBtn(t('tracking.btn.nocam'), '', () => { P.markSeen(st.ex.id); startNoCamera('declined'); }),
      ],
    });
    setPhase(t('tracking.tutorial.title'), t('tracking.tutorial.phaseSub'));
  }

  /** La cámara no está disponible o no se permitió: la rutina sigue igual, sin cámara (TD-110). */
  function offerNoCamera(kind) {
    const reason = P.reasonFor(kind);
    showPractice('offer', {
      title: t('tracking.offer.title'),
      text: t('tracking.offer.text', { reason: P.REASON_TEXT[reason] }),
      note: P.NO_CAMERA_NOTE,
      actions: [
        practiceBtn(t('tracking.offer.start'), 'primary', () => startNoCamera(kind)),
        practiceBtn(t('tracking.offer.retry'), '', () => startCamera()),
      ],
    });
    setPhase(t('tracking.nocam.phase'), P.REASON_TEXT[reason]);
  }

  function startNoCamera(kind) {
    stopRest();
    st.tracker = null;
    st.startedAt = new Date().toISOString();
    st.ended = false;
    st.saved = false;
    st.symptomIds = [];
    const counter = P.createCounter({ sets: st.dose.sets, reps: st.dose.reps, perSide: st.spec.perSide });
    const reason = P.reasonFor(kind);
    showPractice('nocam', {
      title: t('tracking.nocam.title'),
      text: t('tracking.nocam.text', {
        side: st.spec.perSide ? ` ${t('tracking.nocam.perSide')}` : '',
        hold: st.dose.hold ? `; ${t('tracking.nocam.hold', { s: st.dose.hold })}` : '',
      }),
      note: P.NO_CAMERA_NOTE,
      actions: [
        practiceBtn(t('tracking.nocam.done'), 'primary practice-done', onManualRep, t('tracking.nocam.doneLabel')),
        practiceBtn(t('tracking.nocam.undo'), '', () => { counter.undo(); renderNoCamera(); }, t('tracking.nocam.undoLabel')),
      ],
    });
    Object.assign(st.practice, { counter, reason });
    ui.status.textContent = t('tracking.nocam.status');
    setButtons(true);
    ui.btnRecal.disabled = true;
    ui.btnHold.disabled = true;
    renderNoCamera();
    announce(t('tracking.nocam.announce'), { ms: 3000 });
    setPhase(t('tracking.nocam.phase'), `${doseText()}.`);
  }

  function renderNoCamera() {
    const c = st.practice.counter.state();
    $('practice-count').textContent = t('tracking.nocam.count', c);
  }

  function onManualRep() {
    if (!st.practice || st.practice.mode !== 'nocam' || st.ended) return;
    const r = st.practice.counter.add();
    const c = st.practice.counter.state();
    renderNoCamera();
    if (r.finished) { finish('completed'); return; }
    if (r.setDone && previewEnds()) return;
    if (r.setDone) { announce(t('tracking.ev.setDone', { set: c.set - 1 }), { ms: 3200 }); startRest(); }
    else { stopRest(); speak(String(c.inSet)); }
  }

  function finishNoCamera(reason) {
    if (st.ended) return;
    st.ended = true;
    stopRest();
    const c = st.practice.counter.state();
    if (reason === 'pain_stop') {
      showStop(t('tracking.end.pain'));
      speak(t('tracking.end.pain'), true);
    } else announce(reason === 'completed' ? t('tracking.end.completed') : t('tracking.end.ended'), { ms: 4000, tone: reason === 'completed' ? 'done' : '' });
    $('practice-actions').replaceChildren(practiceBtn(t('tracking.nocam.again'), '', () => setExercise(st.ex.id)));
    setPhase(reason === 'completed' ? t('tracking.nocam.phaseCompleted') : reason === 'pain_stop' ? t('tracking.end.phasePain') : t('tracking.end.phaseEnded'),
      tn('tracking.nocam.repsOf', c.done, { total: c.total }));
    setButtons(false);
    saveNoCamera(reason, c.done);
  }

  /** Se guarda como sesión guiada sin cámara: el servidor la marca `no_camera` y el panel lo destaca (TD-111). */
  async function saveNoCamera(reason, reps) {
    if (!st.item || st.saved) return;
    st.saved = true;
    try {
      const res = await A.call('patient', 'POST', '/api/sessions', {
        exercise_id: st.ex.id, mode: 'guided', source: 'guided', no_camera_reason: st.practice ? st.practice.reason : undefined,
        started_at: st.startedAt || new Date().toISOString(), ended_at: new Date().toISOString(), end_reason: reason,
        reps_done: reps, symptom_report_ids: st.symptomIds,
      });
      $('patient-text').textContent = tn('tracking.save.nocam', reps);
      if (window.AxonPainScale && res && res.session_id) AxonPainScale.render($('eva-track'), { sessionId: res.session_id, exerciseName: st.ex.name });
    } catch (err) {
      $('patient-text').textContent = t('tracking.save.error', { error: err.message });
    }
  }

  async function saveSession(reason, reps) {
    if (!st.item || st.saved) return;
    st.saved = true;
    A.call('patient', 'POST', '/api/live', { exercise_id: st.ex.id, source: 'camera', ended: reason }).catch(() => {});
    try {
      const res = await A.call('patient', 'POST', '/api/sessions', {
        exercise_id: st.ex.id, mode: 'guided', source: 'camera', started_at: st.startedAt || new Date().toISOString(),
        ended_at: new Date().toISOString(), end_reason: reason, reps_done: reps, symptom_report_ids: st.symptomIds,
        voice_turn_ids: st.turnIds,
        // Por repetición (TD-49): recorrido máximo desde la posición inicial, sostén, duración y lado. Nunca video.
        reps: st.tracker.reps.slice(0, 100).map((r) => ({
          index: r.index, side: r.side || undefined, peak: r.peak ?? undefined, holdSec: r.holdSec ?? undefined,
          holdOk: r.holdOk ?? undefined, seconds: r.seconds, overLimit: r.overLimit || undefined,
        })),
      });
      $('patient-text').textContent = tn('tracking.save.done', reps);
      // Dolor al terminar (EVA 0-10, ADR-025): opcional, le llega al fisioterapeuta.
      if (window.AxonPainScale && res && res.session_id) AxonPainScale.render($('eva-track'), { sessionId: res.session_id, exerciseName: st.ex.name });
    } catch (err) {
      $('patient-text').textContent = t('tracking.save.error', { error: err.message });
    }
  }

  /** Respuesta del formulario de molestia: se une a la sesión por id; una alarma la termina por dolor (I-7). */
  function onSymptom(res) {
    if (res.report) st.symptomIds.push(res.report.id);
    if (res.turn) st.turnIds.push(res.turn.id);
    if (res.stop) { finish('pain_stop'); return; }
    if ((st.tracker || (st.practice && st.practice.mode === 'nocam')) && !st.ended) announce(res.message, { ms: 4000 });
  }

  async function bootPatient(exerciseId) {
    if (params.get('plan') !== '1' || !A || !A.load('patient')) return;
    const banner = $('patient-banner');
    banner.hidden = false;
    $('patient-text').textContent = t('tracking.patient.loading');
    try {
      const me = await A.call('patient', 'GET', '/api/me');
      const item = me.plan.find((p) => p.exercise_id === exerciseId);
      if (!item) {
        $('patient-text').textContent = t('tracking.patient.notInPlan');
        return;
      }
      st.item = item;
      st.patient = me.patient;
      ui.select.disabled = true;
      ui.select.title = t('tracking.patient.assigned');
      $('back').href = 'paciente.html';
      $('back').textContent = t('tracking.back.plan');
      setExercise(exerciseId);
      const p = document.createElement('p');
      p.textContent = t('tracking.patient.hello', { alias: me.patient.alias, therapist: me.therapist.name, dose: doseText() });
      $('patient-text').replaceChildren(p);
      // La molestia es un reporte del paciente, no una alerta del sistema: el seguimiento nunca alerta (I-12).
      if (window.AxonSymptom) {
        AxonSymptom.render($('symptom-track'), { exerciseId: st.ex.id, inSession: () => (Boolean(st.tracker) || Boolean(st.practice && st.practice.mode === 'nocam')) && !st.ended,
          current: () => null, turn: true, assistant: me.assistant, onResult: onSymptom });
      }
      A.stream('patient', '/api/me/stream', (msg) => {
        if (msg.kind === 'highlight' && window.AxonTeach) AxonTeach.show(msg);
      });
    } catch (err) {
      $('patient-text').textContent = err.status === 401
        ? t('tracking.patient.expired') : err.message;               // err.message lo escribe el servidor (español)
    }
  }

  // ------------------------------------------------------------------ arranque
  // La primera vez de cada ejercicio, antes de la cámara va el tutorial (TD-109); después, directo.
  ui.btnCamera.addEventListener('click', () => { if (P && !P.seen(st.ex.id) && !st.tracker) showTutorial(); else startCamera(); });
  ui.btnTutorial.addEventListener('click', showTutorial);
  ui.btnNoCam.addEventListener('click', () => startNoCamera('declined'));
  ui.btnStop.addEventListener('click', () => finish('user_quit'));
  ui.btnPain.addEventListener('click', () => finish('pain_stop'));
  ui.btnRecal.addEventListener('click', () => {
    if (!st.tracker) return;
    st.tracker.recalibrate();
    announce(t('tracking.recal.announce'), { ms: 2500 });
  });
  ui.btnHold.addEventListener('click', () => {
    if (!st.tracker || st.ended) return;
    st.tracker.startManualHold(performance.now()).forEach(onEvent);
  });
  ui.btnFull.addEventListener('click', toggleFullscreen);
  if ('speechSynthesis' in window) window.speechSynthesis.getVoices();

  fillSelect();
  const initial = C.get(params.get('ex')) ? params.get('ex') : 'half-squat';
  setExercise(initial);
  bootPatient(initial);
})();
