/* AXONFAS · motor de reglas del prototipo de validación (TD-28).
 *
 * Funciones puras sobre los 33 puntos de MediaPipe Pose. Implementa en el navegador la regla de compensación de
 * .ai-context/01-logic.md: línea base con las 3 primeras repeticiones, umbrales = línea base + margen del terapeuta, y
 * evaluación solo cuando la rodilla alcanzó el rango pedido. El mismo archivo corre en el navegador (window.AxonEngine)
 * y en Node (require) para tests/validation-prototype/. No guarda ni envía nada.
 *
 * Coordenadas: worldLandmarks de MediaPipe, en metros, con x hacia la derecha de la imagen, y hacia abajo y z hacia la
 * cámara negativa. Supone la cámara nivelada y el paciente de frente o en ligera diagonal.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LM = { L_SHOULDER: 11, R_SHOULDER: 12, L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28 };
  const KEY_POINTS = [11, 12, 23, 24, 25, 26, 27, 28];
  const UP = { x: 0, y: -1, z: 0 };

  // Valores de partida para probar con fisioterapeutas (TD-06). No son clínicos: el terapeuta los ajusta.
  const DEFAULTS = {
    calibrationReps: 3,     // 01 · Lógica: línea base = primeras 3 repeticiones
    seatedFlexDeg: 65,      // rodilla con esta flexión o más = sentado
    standingFlexDeg: 25,    // rodilla con esta flexión o menos = de pie (promedio de las dos)
    kneeSlackDeg: 10,       // de pie exige además CADA rodilla bajo standingFlexDeg + esto
    standHeightRatio: 0.85, // de pie exige la cadera a esta altura sobre los tobillos (fracción del largo de la pierna)
    feetLevelRatio: 0.15,   // y los dos pies en el suelo: diferencia de altura entre tobillos bajo esta fracción
    trunkMarginDeg: 15,     // X: grados de tronco por encima de la línea base
    valgusMarginDeg: 10,    // Y: grados de valgo por encima de la línea base
    romTargetDeg: null,     // flexión de rodilla pedida; null = línea base menos romSlackDeg
    romSlackDeg: 10,
    maxReps: 10,            // total, incluidas las de calibración
    minConfidence: 0.6,     // visibilidad mínima de los puntos clave para evaluar (TD-25)
    maxLowConfidenceRatio: 0.2, // una repetición con más frames dudosos no sirve para calibrar
    disabled: {},           // compensaciones que no se evalúan porque la cámara no las ve bien (ADR-015)
  };

  const deg = (rad) => (rad * 180) / Math.PI;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const norm = (a) => Math.sqrt(dot(a, a));
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;

  function angleBetween(a, b) {
    const n = norm(a) * norm(b);
    return n === 0 ? 0 : deg(Math.acos(clamp(dot(a, b) / n, -1, 1)));
  }

  /** Ángulo en el vértice b del triángulo a-b-c, en grados. */
  const angleAt = (a, b, c) => angleBetween(sub(a, b), sub(c, b));

  /**
   * Proxy de valgo: desplazamiento medial de la rodilla respecto de la línea cadera-tobillo, medido solo en el eje x
   * (no le afecta que el muslo apunte a la cámara al estar sentado) y expresado en grados contra la longitud de la
   * pierna. Positivo = rodilla hacia la línea media (valgo); negativo = hacia afuera (varo).
   */
  function valgusProxy(hip, knee, ankle, otherHip) {
    const dy = ankle.y - hip.y;
    const t = Math.abs(dy) < 1e-6 ? 0.5 : clamp((knee.y - hip.y) / dy, 0, 1);
    const lineX = hip.x + (ankle.x - hip.x) * t;
    const medialSign = Math.sign(otherHip.x - hip.x) || 1;
    const medial = (knee.x - lineX) * medialSign;
    const shank = norm(sub(knee, ankle)) || 1;
    return deg(Math.atan2(medial, shank));
  }

  /**
   * Ángulos de un frame. `world`: 33 puntos 3D. `visibilitySource`: puntos con `visibility` (los 2D de MediaPipe);
   * si falta, se usa la de `world`.
   */
  function computeAngles(world, visibilitySource) {
    const vis = visibilitySource || world;
    const confidence = Math.min(...KEY_POINTS.map((i) => (vis[i] && Number.isFinite(vis[i].visibility) ? vis[i].visibility : 0)));
    const p = (i) => world[i];
    const kneeL = 180 - angleAt(p(LM.L_HIP), p(LM.L_KNEE), p(LM.L_ANKLE));
    const kneeR = 180 - angleAt(p(LM.R_HIP), p(LM.R_KNEE), p(LM.R_ANKLE));
    const hipMid = mid(p(LM.L_HIP), p(LM.R_HIP));
    const shoulderMid = mid(p(LM.L_SHOULDER), p(LM.R_SHOULDER));
    // Pararse de verdad: la cadera sube a la altura de estar de pie y los dos pies siguen en el suelo. Con una pierna
    // estirada estando sentado, el promedio de las rodillas baja casi igual, pero el tobillo levantado se acerca a la
    // cadera y la altura no sube (TD-55).
    const legL = norm(sub(p(LM.L_HIP), p(LM.L_KNEE))) + norm(sub(p(LM.L_KNEE), p(LM.L_ANKLE)));
    const legR = norm(sub(p(LM.R_HIP), p(LM.R_KNEE))) + norm(sub(p(LM.R_KNEE), p(LM.R_ANKLE)));
    const leg = (legL + legR) / 2 || 1;
    const ankleY = (p(LM.L_ANKLE).y + p(LM.R_ANKLE).y) / 2;
    return {
      kneeL, kneeR, knee: (kneeL + kneeR) / 2,
      hipHeight: (ankleY - hipMid.y) / leg,
      feetLevel: Math.abs(p(LM.L_ANKLE).y - p(LM.R_ANKLE).y) / leg,
      trunk: angleBetween(sub(shoulderMid, hipMid), UP),
      valgusL: valgusProxy(p(LM.L_HIP), p(LM.L_KNEE), p(LM.L_ANKLE), p(LM.R_HIP)),
      valgusR: valgusProxy(p(LM.R_HIP), p(LM.R_KNEE), p(LM.R_ANKLE), p(LM.L_HIP)),
      confidence,
    };
  }

  /** Severidad 1-3 según cuánto supera el umbral. Escala de partida, a validar (TD-06). */
  function severityFor(excessDeg) {
    return excessDeg < 5 ? 1 : excessDeg < 10 ? 2 : 3;
  }

  /**
   * Sesión de sentarse-pararse. `update(frame)` recibe { t, world, visibility } y devuelve el estado del frame y los
   * eventos nuevos. Una repetición va de levantarse de la silla a volver a sentarse habiendo llegado a estar de pie.
   */
  function createSession(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    const s = {
      phase: 'calibrating', // calibrating | exercising | ended
      endReason: null,      // completed | pain_stop | user_quit (03 · session.end_reason)
      posture: null,        // seated | standing (null hasta el primer frame confiable)
      seatedPeak: 0,        // flexión máxima de rodilla mientras está sentado
      lowStreak: 0,         // frames dudosos seguidos fuera de una repetición (la subida que no se vio)
      rep: null,
      reps: [],
      events: [],
      baseline: null,
    };

    const romTarget = () => (cfg.romTargetDeg != null ? cfg.romTargetDeg
      : s.baseline ? s.baseline.knee - cfg.romSlackDeg : null);

    /** De pie de verdad: las dos rodillas estiradas, la cadera arriba y los dos pies en el suelo. */
    const standingNow = (a) => a.knee <= cfg.standingFlexDeg
      && a.kneeL <= cfg.standingFlexDeg + cfg.kneeSlackDeg && a.kneeR <= cfg.standingFlexDeg + cfg.kneeSlackDeg
      && a.hipHeight >= cfg.standHeightRatio && a.feetLevel <= cfg.feetLevelRatio;

    function thresholds() {
      if (!s.baseline) return null;
      return {
        romTarget: romTarget(),
        trunk: s.baseline.trunk + cfg.trunkMarginDeg,
        valgusL: s.baseline.valgusL + cfg.valgusMarginDeg,
        valgusR: s.baseline.valgusR + cfg.valgusMarginDeg,
      };
    }

    function startRep(t) {
      s.rep = {
        index: s.reps.length + 1, calibration: s.phase === 'calibrating', start: t, end: null,
        kneeRom: s.seatedPeak, peakTrunk: -Infinity, peakValgusL: -Infinity, peakValgusR: -Infinity,
        reachedStanding: false, romReached: null, events: [], flagged: {}, maxFeetLevel: 0, maxHipHeight: 0,
        // Si la persona empezó a levantarse cuando no se la veía bien, esos frames son parte de esta repetición.
        frames: s.lowStreak, lowConfidenceFrames: s.lowStreak,
      };
    }

    function finishRep(t) {
      const rep = s.rep;
      s.rep = null;
      rep.end = t;
      rep.lowConfidenceRatio = rep.frames ? rep.lowConfidenceFrames / rep.frames : 1;
      rep.validForCalibration = rep.lowConfidenceRatio <= cfg.maxLowConfidenceRatio && Number.isFinite(rep.peakTrunk);
      delete rep.flagged;
      if (s.phase === 'calibrating') {
        if (!rep.validForCalibration) return { rep, discarded: true };     // se repite: no cuenta para la base
        s.reps.push(rep);
        if (s.reps.length >= cfg.calibrationReps) {
          s.baseline = {
            knee: mean(s.reps.map((r) => r.kneeRom)),
            trunk: mean(s.reps.map((r) => r.peakTrunk)),
            valgusL: mean(s.reps.map((r) => r.peakValgusL)),
            valgusR: mean(s.reps.map((r) => r.peakValgusR)),
          };
          s.phase = 'exercising';
        }
      } else {
        s.reps.push(rep);
      }
      if (s.reps.length >= cfg.maxReps) end('completed');
      return { rep, discarded: false };
    }

    const r1 = (v) => Math.round(v * 10) / 10;

    /**
     * Un evento por tipo y lado en cada repetición. La alerta sale en el primer frame que cruza el umbral; después el
     * mismo evento guarda el pico de la repetición y su severidad se recalcula con ese pico.
     */
    function check(rep, type, side, value, threshold, t) {
      const key = type + (side || '');
      const open = rep.flagged[key];
      if (open) {
        if (value > open.peak) Object.assign(open, { peak: r1(value), severity: severityFor(value - threshold) });
        return null;
      }
      if (!(value > threshold)) return null;
      const event = {
        type, side, rep: rep.index, t, value: r1(value), peak: r1(value), threshold: r1(threshold),
        severity: severityFor(value - threshold), alertLatencyMs: null,
      };
      rep.flagged[key] = event;
      rep.events.push(event);
      s.events.push(event);
      return event;
    }

    function update(frame) {
      const out = { angles: null, newEvents: [], completed: null, aborted: null, lowConfidence: false };
      if (s.phase === 'ended') return Object.assign(out, snapshot());
      const a = computeAngles(frame.world, frame.visibility);
      out.angles = a;
      out.lowConfidence = a.confidence < cfg.minConfidence;
      if (s.rep) {
        s.rep.frames += 1;
        if (out.lowConfidence) s.rep.lowConfidenceFrames += 1;
      } else if (out.lowConfidence) {
        s.lowStreak += 1;
      }
      if (out.lowConfidence) return Object.assign(out, snapshot());   // no se evalúa lo que no se ve bien (TD-25)

      if (s.posture === null) {
        s.posture = a.knee >= cfg.seatedFlexDeg ? 'seated' : 'standing';
        s.seatedPeak = a.knee;
      }
      if (s.posture === 'seated') {
        if (a.knee >= cfg.seatedFlexDeg) {
          s.seatedPeak = Math.max(s.seatedPeak, a.knee);
        } else {
          s.posture = 'standing';
          startRep(frame.t);
        }
      } else if (a.knee >= cfg.seatedFlexDeg) {
        s.posture = 'seated';
        if (s.rep) {
          if (s.rep.reachedStanding) out.completed = finishRep(frame.t);
          else {
            // Se volvió a sentar sin pararse: no cuenta. Se dice por qué: una pierna en el aire o no llegó arriba.
            out.aborted = { reason: s.rep.maxFeetLevel > cfg.feetLevelRatio ? 'one_leg' : 'not_standing',
              hipHeight: Math.round(s.rep.maxHipHeight * 100) / 100, calibration: s.rep.calibration };
            s.rep = null;
          }
        }
        s.seatedPeak = a.knee;
      }
      s.lowStreak = 0;

      const rep = s.rep;
      if (rep) {
        rep.maxFeetLevel = Math.max(rep.maxFeetLevel, a.feetLevel);
        rep.maxHipHeight = Math.max(rep.maxHipHeight, a.hipHeight);
        if (standingNow(a)) rep.reachedStanding = true;
        rep.peakTrunk = Math.max(rep.peakTrunk, a.trunk);
        rep.peakValgusL = Math.max(rep.peakValgusL, a.valgusL);
        rep.peakValgusR = Math.max(rep.peakValgusR, a.valgusR);
        const th = thresholds();
        if (s.phase === 'exercising' && th) {
          rep.romReached = rep.kneeRom >= th.romTarget;
          if (rep.romReached) {                                       // regla de 01: rango pedido Y compensación
            // Lo que la cámara no ve bien desde su posición no se evalúa (ADR-015): mejor sin alerta que una falsa.
            const off = cfg.disabled || {};
            [off.trunk ? null : check(rep, 'trunk_flexion', null, a.trunk, th.trunk, frame.t),
              off.valgus ? null : check(rep, 'knee_valgus', 'left', a.valgusL, th.valgusL, frame.t),
              off.valgus ? null : check(rep, 'knee_valgus', 'right', a.valgusR, th.valgusR, frame.t)]
              .forEach((e) => e && out.newEvents.push(e));
          }
        }
      }
      return Object.assign(out, snapshot());
    }

    function end(reason) {
      if (s.phase === 'ended') return;
      s.phase = 'ended';
      s.endReason = reason;
      s.rep = null;
    }

    function snapshot() {
      return {
        phase: s.phase, endReason: s.endReason, posture: s.posture, baseline: s.baseline, thresholds: thresholds(),
        repInProgress: s.rep ? { index: s.rep.index, calibration: s.rep.calibration } : null,
        repsDone: s.reps.length, calibrationDone: Math.min(s.reps.length, cfg.calibrationReps),
      };
    }

    return {
      update, end, snapshot,
      setConfig(partial) { Object.assign(cfg, partial); },
      get config() { return Object.assign({}, cfg); },
      get reps() { return s.reps.slice(); },
      get events() { return s.events.slice(); },
    };
  }

  return { LM, KEY_POINTS, DEFAULTS, computeAngles, valgusProxy, severityFor, createSession };
});
