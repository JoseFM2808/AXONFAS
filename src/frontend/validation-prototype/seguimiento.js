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
  const S = T.SIDES;
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
    holdBadge: $('hold-badge'), holdLabel: $('hold-label'), holdNum: $('hold-num'), holdBar: $('hold-bar'),
  };
  const ctx = ui.canvas.getContext('2d');

  const st = {
    camOpts: null, camMeasures: null, setup: null, view: null, lastCheck: 0,
    ex: null, spec: null, dose: null, tracker: null, map: null,
    cam: null, lowStreak: 0, lastMap: 0,
    startedAt: null, ended: false, lastPartialSpoken: 0, lastShortSpoken: 0, guides: [], cues: null, holdFlashUntil: 0,
    patient: null, item: null, lastSent: 0, inFlight: false, saved: false, frames: 0, lowFrames: 0, lastOut: null,
  };

  const cssCache = {};
  const cssVar = (name) => (cssCache[name] ??= getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  const fmt = (v, unit) => (v == null || !Number.isFinite(v) ? '—' : `${unit === 'cm' ? v.toFixed(1) : Math.round(v)}${unit === '%' ? ' %' : unit === 'cm' ? ' cm' : '°'}`);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const sideText = (side) => (side === 'L' ? 'izquierda' : side === 'R' ? 'derecha' : side === '+' ? 'un lado' : side === '-' ? 'otro lado' : '—');

  // ------------------------------------------------------------------ ejercicio
  function fillSelect() {
    ui.select.innerHTML = '';
    C.THEMES.forEach((theme) => {
      const group = document.createElement('optgroup');
      group.label = theme.name;
      C.EXERCISES.filter((e) => e.theme === theme.id).forEach((e) => {
        const o = document.createElement('option');
        o.value = e.id;
        o.textContent = `${e.name}${T.SPECS[e.id].quality === 'limited' ? ' · seguimiento aproximado' : ''}`;
        group.appendChild(o);
      });
      ui.select.appendChild(group);
    });
  }

  function doseText() {
    const d = st.dose;
    const tg = T.targetFor(st.spec, d);
    const what = st.spec.mode === 'reps' ? `${plural(d.sets, 'serie', 'series')} de ${d.reps}${st.spec.perSide ? ' por lado' : ''}`
      : `${plural(d.reps, 'vez', 'veces')}${st.spec.perSide ? ' por lado' : ''}`;
    return `${what}${d.hold ? ` · sostener ${d.hold} s` : ''} (${tg.total} en total)`;
  }

  function setExercise(id) {
    stopCamera();
    st.ex = C.get(id) || C.get('half-squat');
    st.spec = T.SPECS[st.ex.id];
    st.dose = st.item ? { sets: st.item.sets, reps: st.item.reps, hold: st.item.hold_seconds }
      : { sets: st.ex.dose.sets, reps: st.ex.dose.reps, hold: st.ex.dose.hold };
    st.tracker = null;
    st.ended = false;
    ui.select.value = st.ex.id;
    document.title = `AXONFAS · Seguimiento · ${st.ex.name}`;
    $('ex-title').textContent = st.ex.name;
    $('ex-goal').textContent = st.ex.goal;
    const lim = $('ex-limited');
    lim.hidden = st.spec.quality !== 'limited';
    lim.textContent = st.spec.quality === 'limited' ? `Seguimiento aproximado: ${st.spec.note}` : '';
    $('ph-title').textContent = st.spec.mode === 'manual' ? 'La cámara te acompaña; tú marcas cada sostén' : 'Sigue tu ejercicio con la cámara';
    $('ph-camera').textContent = `Cámara: ${st.spec.camera}`;
    $('how-position').textContent = `Posición: ${st.ex.position}`;
    $('how-camera').textContent = st.spec.camera;
    $('how-dose').textContent = `${doseText()}. ${st.item ? 'La fijó tu fisioterapeuta.' : `Fuente: ${st.ex.dose.text}`}`;
    const list = (el, items) => { el.replaceChildren(...items.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; })); };
    list($('how-steps'), st.ex.steps);
    list($('how-prec'), st.ex.precautions);
    const src = $('how-source');
    src.replaceChildren('Fuente: ');
    const a = document.createElement('a');
    a.href = st.ex.source.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `${st.ex.source.org} · ${st.ex.source.title}`;
    src.append(a, ` (${st.ex.sourceName})`);
    st.map = B.render($('live-map'), { intensities: B.estimateLoad(st.ex, null, 0) });
    mountGuides();
    // 1 · Dónde va la cámara (ADR-015): alternativas con la calidad de la medida de este ejercicio
    st.camMeasures = CS.measuresFor(st.ex.id, 'track', T);
    st.camOpts = CS.renderOptions($('cam-setup'), st.camMeasures.measures, { hint: st.spec.camera });
    st.view = null;
    ui.btnHold.hidden = st.spec.mode !== 'manual';
    ui.placeholder.hidden = false;
    ui.hud.hidden = true;
    ui.holdBadge.hidden = true;
    hideAlert();
    renderReadouts(null);
    renderReps();
    if ($('tips')) $('tips').innerHTML = '';
    setPhase('Esperando la cámara', 'Toca "Usar la cámara" para empezar.');
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
      unsupported: 'Este navegador no permite la cámara aquí: ábrelo desde http://localhost o con el QR (HTTPS).',
    });
    if (!run) return;
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
    setPhase('Prepara la cámara', `${CS.VIEWS[chosen].how}. ${st.spec.camera}`);
    announce('Coloca la cámara: que se vea todo lo necesario', { ms: 3000 });
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
      el.insertAdjacentHTML('beforeend', '<button class="btn" type="button" data-cam-skip>Empezar ya</button>');
    }
    if (r.ready) finishSetup(r);
  }

  function finishSetup(r) {
    if (!st.setup) return;
    st.view = r && r.view ? r.view : null;
    st.setup = null;
    $('cam-check').hidden = true;
    const q = st.view ? CS.qualityOf(st.camMeasures.measures, st.view)[0] : null;
    ui.status.textContent = st.view ? `Cámara ${CS.VIEWS[st.view].short}: ${q.label.toLowerCase()} ${q.text}. El video no sale de este equipo.`
      : 'Cámara activa. El video no sale de este equipo.';
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
    const first = st.spec.mode === 'reps' ? 'Ponte en la posición inicial y quédate quieto'
      : st.spec.mode === 'hold' ? 'Ponte en posición: el tiempo cuenta mientras la sostienes'
        : 'Ponte en posición y toca Sostener en cada repetición';
    announce(`${st.view ? 'Posición lista. ' : ''}${first}`, { ms: 3500 });
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
      if (st.lowStreak === LOW_FRAMES_BEFORE_HINT) showInfo(`No te veo bien. ${st.spec.camera}`);
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
      case 'ready': announce('Listo. Empieza', { ms: 1800 }); break;
      case 'hold_start': if (e.seconds) speak('Sostén'); break;
      case 'hold_done':
        st.holdFlashUntil = performance.now() + 1500;
        speak(st.spec.mode === 'reps' ? 'Bien. Baja despacio' : 'Bien. Suelta');
        break;
      case 'hold_short': {
        const now = performance.now();
        showInfo(`Sostuviste ${e.seconds} s de ${e.needed || tg.hold} s: esa no contó. Mantén la posición hasta que la cuenta llegue a 0.`, 4000);
        if (now - st.lastShortSpoken > 5000) { st.lastShortSpoken = now; speak('No contó. Sostén hasta llegar a cero'); }
        break;
      }
      case 'hold_lost': showInfo('Dejé de verte: ese sostén no contó.', 2500); break;
      case 'partial': {
        const now = performance.now();
        showInfo('Un poco más: llega hasta llenar la barra.', 2200);
        if (now - st.lastPartialSpoken > 6000) { st.lastPartialSpoken = now; speak('Un poco más'); }
        break;
      }
      case 'rep': {
        const n = e.index % tg.perSet || tg.perSet;
        if (e.index < tg.total && n < tg.perSet) speak(String(n));
        renderReps();
        break;
      }
      case 'set_done': announce(`Serie ${e.set} lista. Descansa y sigue`, { ms: 3200 }); break;
      default: break;
    }
  }

  function finish(reason) {
    if (st.setup) {                                       // todavía preparando la cámara: solo se apaga
      stopCamera();
      setButtons(false);
      ui.placeholder.hidden = false;
      setPhase('Esperando la cámara', 'Toca "Usar la cámara" para empezar.');
      return;
    }
    if (!st.tracker || st.ended) return;
    st.ended = true;
    ui.holdBadge.hidden = true;
    st.tracker.end();
    stopCamera();
    const reps = st.tracker.reps.length;
    if (reason === 'pain_stop') {
      hideAnnounce();
      showStop('Sesión detenida. Si el dolor sigue, contacta a tu fisioterapeuta.');
      speak('Sesión detenida. Si el dolor sigue, contacta a tu fisioterapeuta.', true);
    } else if (reason === 'completed') {
      announce('¡Listo! Ejercicio completado', { ms: 5000, tone: 'done' });
    } else {
      announce('Sesión terminada', { ms: 2500 });
    }
    setPhase(reason === 'completed' ? 'Completado' : reason === 'pain_stop' ? 'Detenido por dolor' : 'Terminado',
      `${plural(reps, 'repetición', 'repeticiones')} de ${st.tracker.target.total}.`);
    ui.status.textContent = 'Cámara apagada.';
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
      title: 'Sugerencias para la próxima', note: 'Consejos de uso calculados con reglas a partir de esta sesión.',
      empty: 'Todo salió bien: no hay nada que mejorar en el uso de la cámara.' });
  }

  function setButtons(active) {
    ui.btnPain.disabled = !active;
    ui.btnStop.disabled = !active;
    ui.btnRecal.disabled = !active || st.spec.mode !== 'reps';
    ui.btnHold.disabled = !active;
    ui.btnCamera.textContent = active ? '📹 Reiniciar' : '📹 Usar la cámara';
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
    if (out.phase === 'setup') setPhase('Posición inicial', `${c.start || 'Ponte en la posición inicial'}. Quédate quieto 1 segundo.`);
    else if (st.spec.mode === 'reps') {
      if (out.state !== 'up') setPhase(c.go || st.ex.name, 'Hasta llenar la barra.');
      else if (left != null) setPhase(`Sostén: ${left} s`, 'No bajes hasta que la cuenta llegue a 0.');
      else if (out.holdDone || !hold) setPhase(c.back || 'Vuelve a la posición inicial', 'Vuelve hasta vaciar la barra: ahí cuenta.');
      else setPhase(c.go || st.ex.name, 'Vuelve a llenar la barra para seguir sosteniendo.');
    } else if (st.spec.mode === 'hold') {
      setPhase(left != null ? `Sostén: ${left} s` : (c.go || 'Sostén la posición'), `Cuenta mientras la mantienes: ${hold} s cada vez.`);
    } else {
      setPhase(left != null ? `Sostén: ${left} s` : 'Toca "Sostener"', left != null ? (c.go || '') : 'La cámara confirma que sigues en posición hasta el final.');
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
      ui.holdLabel.textContent = st.spec.mode === 'reps' ? '¡Bien! Ahora baja' : '¡Bien! Suelta';
      ui.holdNum.textContent = '0';
      ui.holdBar.style.width = '100%';
    } else {
      const elapsed = out.holdMs / 1000;
      ui.holdLabel.textContent = 'Sostén';
      ui.holdNum.textContent = String(Math.max(0, Math.ceil(hold - elapsed)));
      ui.holdBar.style.width = `${Math.min(100, (elapsed / hold) * 100).toFixed(0)}%`;
    }
  }

  function renderHud(out) {
    const tg = st.tracker.target;
    const count = out ? out.count : 0;
    const set = Math.min(tg.sets, Math.floor(count / tg.perSet) + 1);
    const inSet = count >= tg.total ? tg.perSet : count % tg.perSet;
    ui.hudPhase.textContent = tg.sets > 1 ? `Serie ${set} de ${tg.sets}` : (st.spec.mode === 'reps' ? 'Repeticiones' : 'Sostenes');
    ui.hudDone.textContent = inSet;
    ui.hudTotal.textContent = tg.perSet;
    let sub = '';
    if (out && out.phase === 'setup') sub = 'quieto: tomando referencia';
    else if (out && out.holdMs != null && tg.hold) sub = `sostén ${Math.max(0, tg.hold - out.holdMs / 1000).toFixed(0)} s`;
    else if (st.spec.perSide) sub = 'cuentan ambos lados';
    ui.hudSub.textContent = sub;
    if (ui.hudBar.childElementCount !== tg.perSet) ui.hudBar.innerHTML = '<span></span>'.repeat(tg.perSet);
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
    $('ro-label').textContent = metric.label;
    const side = out && out.side ? ` · ${sideText(out.side)}` : '';
    setKpi('ro-value', fmt(out && !out.lowConfidence ? out.value : null, unit), out && out.lowConfidence ? 'no te veo bien' : `en vivo${side}`);
    $('ro-meter').style.width = `${Math.round((out ? out.progress : 0) * 100)}%`;
    $('ro-value').classList.toggle('on', Boolean(out && out.progress >= 1));
    if (st.spec.mode === 'reps') {
      setKpi('ro-rest', fmt(out ? out.rest : null, unit), out && out.phase === 'setup' ? 'quédate quieto…' : 'referencia de esta sesión');
      const sense = st.spec.dir === 0 ? 'hacia cualquier lado' : st.spec.dir > 0 ? 'más que la posición inicial' : 'menos que la posición inicial';
      setKpi('ro-goal', fmt(st.spec.delta, unit), sense);
    } else if (st.spec.mode === 'hold') {
      setKpi('ro-rest', '—', 'no hace falta referencia');
      setKpi('ro-goal', `${st.spec.dir >= 0 ? '≥' : '≤'} ${fmt(st.spec.threshold, unit)}`, 'mientras sostienes');
    } else {
      setKpi('ro-rest', '—', 'no hace falta referencia');
      setKpi('ro-goal', 'Tú lo marcas', 'la cámara no ve este músculo');
    }
    const hold = st.dose.hold;
    const left = out && out.holdMs != null && hold ? Math.max(0, hold - out.holdMs / 1000) : null;
    setKpi('ro-hold', hold ? (left != null ? `${left.toFixed(1)} s` : `${hold} s`) : 'No', hold ? (left != null ? 'quedan' : 'cada repetición') : 'este ejercicio no se sostiene');
    $('ro-hold').classList.toggle('on', left != null);
  }

  function renderReps() {
    const reps = st.tracker ? st.tracker.reps : [];
    const unit = T.METRICS[st.spec.metric].unit;
    const hold = st.dose.hold;
    if (!reps.length) {
      ui.repsBody.innerHTML = '<tr><td colspan="5" class="empty">Todavía no hay repeticiones.</td></tr>';
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
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('es'));
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : 'es-PE';
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (err) { console.warn('Sin voz', err); }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('stage').requestFullscreen();
    } catch { ui.status.textContent = 'Este navegador no permitió la pantalla completa.'; }
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
      metric: out.value == null || out.lowConfidence ? undefined : { label: metric.label, value: out.value, unit: metric.unit },
    }).catch(() => {}).finally(() => { st.inFlight = false; });
  }

  async function saveSession(reason, reps) {
    if (!st.item || st.saved) return;
    st.saved = true;
    A.call('patient', 'POST', '/api/live', { exercise_id: st.ex.id, source: 'camera', ended: reason }).catch(() => {});
    try {
      await A.call('patient', 'POST', '/api/sessions', {
        exercise_id: st.ex.id, mode: 'guided', source: 'camera', started_at: st.startedAt || new Date().toISOString(),
        ended_at: new Date().toISOString(), end_reason: reason, reps_done: reps,
        // Por repetición (TD-49): recorrido máximo desde la posición inicial, sostén, duración y lado. Nunca video.
        reps: st.tracker.reps.slice(0, 100).map((r) => ({
          index: r.index, side: r.side || undefined, peak: r.peak ?? undefined, holdSec: r.holdSec ?? undefined,
          holdOk: r.holdOk ?? undefined, seconds: r.seconds,
        })),
      });
      $('patient-text').textContent = `Sesión guardada y enviada a tu fisioterapeuta (${plural(reps, 'repetición', 'repeticiones')}). Puedes volver a tu plan.`;
    } catch (err) {
      $('patient-text').textContent = `No se pudo guardar la sesión: ${err.message}`;
    }
  }

  async function bootPatient(exerciseId) {
    if (params.get('plan') !== '1' || !A || !A.load('patient')) return;
    const banner = $('patient-banner');
    banner.hidden = false;
    $('patient-text').textContent = 'Cargando tu plan…';
    try {
      const me = await A.call('patient', 'GET', '/api/me');
      const item = me.plan.find((p) => p.exercise_id === exerciseId);
      if (!item) {
        $('patient-text').textContent = 'Este ejercicio no está en tu plan: puedes probarlo, pero la sesión no se guarda.';
        return;
      }
      st.item = item;
      st.patient = me.patient;
      ui.select.disabled = true;
      ui.select.title = 'Lo asignó tu fisioterapeuta';
      $('back').href = 'paciente.html';
      $('back').textContent = '← Volver a mi plan';
      setExercise(exerciseId);
      const p = document.createElement('p');
      p.textContent = `Hola, ${me.patient.alias}. Plan de ${me.therapist.name}: ${doseText()}. Tu fisioterapeuta ve en vivo tu `
        + 'esqueleto y tus repeticiones, nunca el video. Al terminar, la sesión se guarda sola.';
      $('patient-text').replaceChildren(p);
      A.stream('patient', '/api/me/stream', (msg) => {
        if (msg.kind === 'highlight' && window.AxonTeach) AxonTeach.show(msg);
      });
    } catch (err) {
      $('patient-text').textContent = err.status === 401
        ? 'Tu cuenta de este equipo ya no es válida. Vuelve a afiliarte desde la página de paciente.' : err.message;
    }
  }

  // ------------------------------------------------------------------ arranque
  ui.btnCamera.addEventListener('click', startCamera);
  ui.btnStop.addEventListener('click', () => finish('user_quit'));
  ui.btnPain.addEventListener('click', () => finish('pain_stop'));
  ui.btnRecal.addEventListener('click', () => {
    if (!st.tracker) return;
    st.tracker.recalibrate();
    announce('Quédate quieto en la posición inicial', { ms: 2500 });
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
