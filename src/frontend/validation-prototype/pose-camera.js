/* AXONFAS · cámara y MediaPipe Pose en el navegador, compartidos por el Prototipo (app.js) y el seguimiento de la
 * galería (seguimiento.js) (TD-50). Carga el modelo una sola vez, abre la cámara con avisos claros y corre el bucle:
 * un resultado por cada frame nuevo del video. El video nunca sale de este equipo (ADR-003).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonPoseCamera = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const MP_VERSION = '1.1.0';
  const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

  // Avisos en el idioma actual (i18n/session.js, claves pose.*), leídos en el momento (ADR-030).
  const I18N = (typeof self !== 'undefined' && self.AxonI18n) || require('./i18n.js');
  const t = I18N.t;
  const TEXT = {
    get loading() { return t('pose.loading'); },
    get modelError() { return t('pose.modelError'); },
    get asking() { return t('pose.asking'); },
    get denied() { return t('pose.denied'); },
    get notFound() { return t('pose.notFound'); },
    get failed() { return t('pose.failed'); },
    get active() { return t('pose.active'); },
  };

  let loading = null;

  /** Carga MediaPipe y el modelo una sola vez por página: GPU del navegador si se puede; si no, CPU. */
  function loadLandmarker() {
    if (!loading) {
      loading = (async () => {
        const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
        const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
        const options = (delegate) => ({ baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', numPoses: 1 });
        try {
          return await vision.PoseLandmarker.createFromOptions(fileset, options('GPU'));
        } catch (gpuError) {
          console.warn('GPU no disponible para MediaPipe, uso CPU', gpuError);
          return vision.PoseLandmarker.createFromOptions(fileset, options('CPU'));
        }
      })();
      loading.catch(() => { loading = null; });              // si falló la red, el siguiente intento vuelve a cargar
    }
    return loading;
  }

  function cameraError(err) {
    if (err && err.name === 'NotAllowedError') return TEXT.denied;
    if (err && err.name === 'NotFoundError') return TEXT.notFound;
    return TEXT.failed;
  }

  /**
   * Abre el modelo y la cámara y ajusta el lienzo a la forma del video (vertical en celular), espejado.
   * opts: video, canvas, viewport, status(texto), unsupported (qué decir si el navegador no permite la cámara aquí) y
   * onFail(kind) con kind = 'unsupported' | 'model' | 'denied' | 'notFound' | 'failed', para seguir sin cámara (TD-110).
   * Devuelve un "run" (ver createRun) o null si algo falló, después de avisarlo por status.
   */
  async function open({ video, canvas, viewport, status, unsupported, onFail }) {
    const say = status || (() => {});
    const fail = (kind) => { if (onFail) onFail(kind); return null; };
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!media || !media.getUserMedia) { say(unsupported || TEXT.failed); return fail('unsupported'); }
    say(TEXT.loading);
    let landmarker;
    try {
      landmarker = await loadLandmarker();
    } catch (err) {
      console.error(err);
      say(TEXT.modelError);
      return fail('model');
    }
    say(TEXT.asking);
    let stream;
    try {
      stream = await media.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    } catch (err) {
      say(cameraError(err));
      return fail(err && err.name === 'NotAllowedError' ? 'denied' : err && err.name === 'NotFoundError' ? 'notFound' : 'failed');
    }
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    viewport.style.setProperty('--src-ratio', `${canvas.width} / ${canvas.height}`);
    viewport.classList.add('mirror');
    say(TEXT.active);
    return createRun({ landmarker, stream, video });
  }

  /**
   * Bucle de detección. start(onResult) llama onResult({ image, world, t }) una vez por cada frame nuevo del video
   * (image y world son null si no se ve a nadie). stop() corta el bucle y apaga la cámara. raf, cancel y now se pueden
   * reemplazar en los tests.
   */
  function createRun({ landmarker, stream, video, raf, cancel, now }) {
    const request = raf || ((fn) => requestAnimationFrame(fn));
    const cancelFrame = cancel || ((id) => cancelAnimationFrame(id));
    const clock = now || (() => performance.now());
    let id = 0;
    let last = -1;
    let running = false;
    let onResult = () => {};
    function tick() {
      if (!running) return;
      id = request(tick);
      if (video.readyState < 2 || video.currentTime === last) return;
      last = video.currentTime;
      const t = clock();
      const result = landmarker.detectForVideo(video, t);
      try {
        onResult({
          image: (result.landmarks && result.landmarks[0]) || null,
          world: (result.worldLandmarks && result.worldLandmarks[0]) || null,
          t,
        });
      } finally {
        if (typeof result.close === 'function') result.close();
      }
    }
    return {
      landmarker,
      start(fn) {
        onResult = fn;
        if (running) return;
        running = true;
        last = -1;
        tick();
      },
      stop() {
        running = false;
        cancelFrame(id);
        if (stream) stream.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
      },
      get running() { return running; },
    };
  }

  return { MP_VERSION, MODEL_URL, TEXT, loadLandmarker, open, createRun, cameraError };
}));
