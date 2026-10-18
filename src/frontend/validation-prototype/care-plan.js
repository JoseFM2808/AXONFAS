/* AXONFAS · "Plan de Cuidados" del día (ADR-025, TD-100). Reglas fijas y sin IA: con la frecuencia `per_week` de cada
 * ejercicio del plan y las sesiones completadas (`history`, que trae GET /api/me), decide qué toca hoy en la hora local
 * del paciente. Es una agenda, no una regla de seguridad: el paciente puede hacer un ejercicio otro día y la sesión se
 * guarda igual. Los números son de partida, no clínicos (TD-104). El mismo archivo corre en el navegador
 * (window.AxonCarePlan) y en Node (tests).
 *
 * - La semana va de lunes a domingo.
 * - Hecho hoy → "done_today". Cumplida la frecuencia de la semana → "week_done".
 * - Si no, toca hoy cuando pasaron al menos floor(7 / per_week) días desde la última vez (1 vez → 7 días, 2 → 3, 3 → 2,
 *   4 a 7 → 1), o cuando lo que falta ya no entra en los días que le quedan a la semana. Si no toca, "rest" con el día
 *   en que vuelve a tocar.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AxonCarePlan = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  /** Medianoche local del día de `d`. */
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  /** Días de calendario entre dos fechas locales (sin errores por cambio de horario). */
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  /** Lunes de la semana de `d`. */
  function weekStart(d) {
    const day = startOfDay(d);
    return addDays(day, -((day.getDay() + 6) % 7));
  }

  /** Separación mínima en días entre dos sesiones de un ejercicio que se hace `perWeek` veces por semana. */
  const gapDays = (perWeek) => Math.max(1, Math.floor(7 / Math.min(7, Math.max(1, perWeek))));

  /** Estado de un ejercicio del plan hoy. item: { exercise_id, per_week, history: [ISO de sesiones completadas] }. */
  function statusOf(item, now) {
    const today = startOfDay(now);
    const monday = weekStart(now);
    const perWeek = Math.min(7, Math.max(1, Number(item.per_week) || 1));
    const days = (item.history || []).map((x) => new Date(x)).filter((d) => !Number.isNaN(d.getTime()) && d <= now)
      .map(startOfDay).sort((a, b) => a - b);
    const weekDone = days.filter((d) => d >= monday).length;
    const last = days.length ? days[days.length - 1] : null;
    const base = { item, exercise_id: item.exercise_id, perWeek, weekDone, remaining: Math.max(0, perWeek - weekDone) };
    if (last && daysBetween(last, today) === 0) return Object.assign(base, { status: 'done_today' });
    if (weekDone >= perWeek) return Object.assign(base, { status: 'week_done', next: addDays(monday, 7) });
    const gap = gapDays(perWeek);
    const since = last ? daysBetween(last, today) : Infinity;
    const daysLeft = 7 - daysBetween(monday, today);           // contando hoy: lunes 7 … domingo 1
    if (since >= gap || base.remaining >= daysLeft) return Object.assign(base, { status: 'today' });
    // Vuelve a tocar al cumplirse la separación, o antes si después ya no entraría lo que falta en la semana.
    const byGap = addDays(last, gap);
    const byDeadline = addDays(monday, 7 - base.remaining);
    return Object.assign(base, { status: 'rest', next: byGap < byDeadline ? byGap : byDeadline });
  }

  /** Agenda del día: { today: [...], rest: [...], all: [...] }. "today" incluye lo hecho hoy, para ver el avance. */
  function agenda(plan, now = new Date()) {
    const all = (plan || []).map((item) => statusOf(item, now));
    return {
      all,
      today: all.filter((x) => x.status === 'today' || x.status === 'done_today'),
      rest: all.filter((x) => x.status === 'rest' || x.status === 'week_done'),
      pending: all.filter((x) => x.status === 'today').length,
    };
  }

  /** "hoy", "mañana" o el día de la semana. */
  function dayName(date, now = new Date()) {
    const n = daysBetween(now, date);
    if (n <= 0) return 'hoy';
    if (n === 1) return 'mañana';
    return `el ${WEEKDAYS[date.getDay()]}`;
  }

  /** Texto corto del estado, para la tarjeta del paciente. */
  function statusText(x, now = new Date()) {
    const week = `esta semana: ${x.weekDone} de ${x.perWeek}`;
    switch (x.status) {
      case 'done_today': return `Hecho hoy · ${week}`;
      case 'today': return `Toca hoy · ${week}`;
      case 'week_done': return x.perWeek === 1 ? 'Cumpliste la de esta semana' : `Cumpliste las ${x.perWeek} de esta semana`;
      default: return `Descanso: vuelve a tocar ${dayName(x.next, now)} · ${week}`;
    }
  }

  return { agenda, statusOf, statusText, dayName, gapDays, weekStart, WEEKDAYS };
});
