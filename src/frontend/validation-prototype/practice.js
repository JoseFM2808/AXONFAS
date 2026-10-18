/* AXONFAS · modo tutorial y rutina sin cámara del seguimiento (TD-109, TD-110, TD-111, ADR-029).
 *
 * Tutorial (shadowing): antes de la primera captura de un ejercicio, la guía animada en grande para seguirla y aprender
 * la técnica; después se pasa a la cámara. Sin cámara: si la persona rechaza el permiso, no hay cámara o elige no usarla,
 * la rutina sigue con la guía en grande marcando el ritmo y un conteo manual. Esa sesión se guarda con `source: 'guided'`
 * y el servidor la marca `no_camera` (03): no hay métricas cinemáticas ni detección postural, y el panel lo dice.
 * Funciones puras en Node y navegador; el dibujo lo hace seguimiento.js.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonPractice = api;
}(typeof self !== 'undefined' ? self : this, (root) => {
  'use strict';

  const SEEN_KEY = 'axonfas.tutorial';
  // Motivo que se guarda con la sesión según lo que pasó con la cámara (pose-camera.js → onFail).
  const REASON = { declined: 'declined', denied: 'denied', notFound: 'unavailable', unsupported: 'unavailable',
    model: 'unavailable', failed: 'unavailable' };
  const REASON_TEXT = {
    declined: 'Elegiste hacerla sin cámara.',
    denied: 'No diste permiso para usar la cámara.',
    unavailable: 'No se pudo usar la cámara en este equipo.',
  };
  const NO_CAMERA_NOTE = 'Sin cámara no se miden ángulos ni se detectan fallos de postura: solo cuenta lo que marques.';

  const reasonFor = (kind) => REASON[kind] || 'unavailable';

  /**
   * Conteo manual: { sets, reps, perSide } → add() suma una repetición, undo() la quita. Con perSide, cada serie lleva
   * reps por lado (el doble de toques). state() → { done, total, set, sets, perSet, inSet, finished }.
   * add() devuelve { setDone, finished } para anunciar el descanso o el final.
   */
  function createCounter({ sets = 1, reps = 1, perSide = false } = {}) {
    const S = Math.max(1, Math.floor(sets)), perSet = Math.max(1, Math.floor(reps)) * (perSide ? 2 : 1);
    const total = S * perSet;
    let done = 0;
    const state = () => ({
      done, total, sets: S, perSet,
      // Al cerrar una serie ya se muestra la siguiente en 0 (como el seguimiento con cámara); al final, la última llena.
      set: Math.min(S, Math.floor(done / perSet) + 1),
      inSet: done >= total ? perSet : done % perSet, finished: done >= total,
    });
    return {
      add() {
        if (done >= total) return { setDone: false, finished: true };
        done += 1;
        return { setDone: done % perSet === 0 && done < total, finished: done >= total };
      },
      undo() { if (done > 0) done -= 1; return state(); },
      state,
    };
  }

  /** ¿Ya vio el tutorial de este ejercicio en este equipo? (solo comodidad: si no hay almacenamiento, se vuelve a mostrar). */
  function seen(exerciseId, store = root.localStorage) {
    try { return (JSON.parse(store.getItem(SEEN_KEY) || '[]') || []).includes(exerciseId); } catch { return false; }
  }
  function markSeen(exerciseId, store = root.localStorage) {
    try {
      const list = JSON.parse(store.getItem(SEEN_KEY) || '[]') || [];
      if (!list.includes(exerciseId)) store.setItem(SEEN_KEY, JSON.stringify(list.concat(exerciseId).slice(-50)));
    } catch { /* sin almacenamiento */ }
  }

  return { SEEN_KEY, REASON_TEXT, NO_CAMERA_NOTE, reasonFor, createCounter, seen, markSeen };
}));
