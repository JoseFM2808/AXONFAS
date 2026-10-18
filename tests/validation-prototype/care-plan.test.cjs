// Tests del "Plan de Cuidados" del día y del dolor al terminar (ADR-025, TD-100).
//   node --test "tests/validation-prototype/*.test.cjs"
// Las fechas son locales: el 2026-10-12 es lunes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'frontend', 'validation-prototype');
const P = require(path.join(SRC, 'care-plan.js'));

const at = (day, hour = 10) => new Date(2026, 9, day, hour);       // octubre de 2026, hora local
const iso = (day, hour = 10) => at(day, hour).toISOString();
const item = (perWeek, days, id = 'half-squat') => ({ exercise_id: id, per_week: perWeek, history: days.map((d) => iso(d)) });
const status = (perWeek, days, today) => P.statusOf(item(perWeek, days), at(today));

test('la semana va de lunes a domingo y la separación depende de la frecuencia', () => {
  assert.equal(P.weekStart(at(18)).getDate(), 12, 'el domingo 18 es de la semana del lunes 12');
  assert.equal(P.weekStart(at(12)).getDate(), 12);
  assert.deepEqual([1, 2, 3, 4, 7].map(P.gapDays), [7, 3, 2, 1, 1]);
});

test('sin sesiones, toca hoy; hecho hoy, queda hecho', () => {
  assert.equal(status(3, [], 14).status, 'today');
  const done = status(3, [14], 14);
  assert.equal(done.status, 'done_today');
  assert.equal(done.weekDone, 1);
});

test('tres veces por semana: un día sí y uno no, y la semana se cierra al cumplir', () => {
  assert.equal(status(3, [12], 13).status, 'rest', 'el martes descansa después del lunes');
  assert.equal(status(3, [12], 13).next.getDate(), 14, 'vuelve a tocar el miércoles');
  assert.equal(status(3, [12], 14).status, 'today');
  assert.equal(status(3, [12, 14, 16], 17).status, 'week_done');
  assert.equal(status(3, [12, 14, 16], 17).next.getDate(), 19, 'la semana nueva empieza el lunes');
});

test('si se atrasó, toca aunque no se cumpla la separación: lo que falta tiene que entrar en la semana', () => {
  // Hizo el sábado 17 y le falta 1 el domingo 18: toca aunque solo pasó un día.
  assert.equal(status(3, [12, 14, 17], 18).status, 'week_done');
  assert.equal(status(3, [12, 17], 18).status, 'today', 'faltan 1 y queda 1 día');
  // El viernes 16, con 0 de 3, vuelve a tocar por separación; el lunes siguiente se reinicia el conteo.
  assert.equal(status(3, [], 16).status, 'today');
  // Dos veces por semana, hecha el viernes 16: la separación de 3 días llegaría el lunes, tarde para esta semana, así
  // que vuelve a tocar el domingo, el último día en que todavía entra.
  const rest = status(2, [16], 17);
  assert.equal(rest.status, 'rest');
  assert.equal(rest.next.getDate(), 18);
  assert.equal(status(2, [16], 18).status, 'today');
});

test('una vez por semana toca de nuevo a los 7 días o al final de la semana', () => {
  const r = status(1, [12], 15);
  assert.equal(r.status, 'week_done');
  assert.equal(status(1, [11], 15).status, 'rest', 'lo hizo el domingo anterior: esta semana toca más adelante');
  assert.equal(status(1, [11], 15).next.getDate(), 18);
  assert.equal(status(1, [11], 18).status, 'today');
});

test('todos los días: hecho hoy o toca hoy, nunca descanso', () => {
  for (let d = 12; d <= 18; d += 1) {
    const s = status(7, [12, 13, 14, 15, 16, 17, 18].filter((x) => x < d), d).status;
    assert.equal(s, 'today', `día ${d}`);
  }
});

test('la agenda separa lo de hoy del resto y no confía en fechas futuras', () => {
  const plan = [item(3, [12], 'half-squat'), item(3, [], 'calf-raises'), item(1, [13], 'bird-dog'),
    { exercise_id: 'clamshell', per_week: 2, history: [iso(20)] }];
  const day = P.agenda(plan, at(13, 18));
  assert.deepEqual(day.today.map((x) => x.exercise_id), ['calf-raises', 'bird-dog', 'clamshell']);
  assert.deepEqual(day.rest.map((x) => x.exercise_id), ['half-squat']);
  assert.equal(day.pending, 2, 'bird-dog ya está hecho hoy');
  assert.equal(day.all.find((x) => x.exercise_id === 'clamshell').weekDone, 0, 'una sesión con fecha futura no cuenta');
});

test('los textos dicen qué toca y cuándo vuelve', () => {
  const now = at(13);
  assert.match(P.statusText(status(3, [12], 13), now), /^Descanso: vuelve a tocar mañana · esta semana: 1 de 3$/);
  assert.match(P.statusText(status(3, [], 13), now), /^Toca hoy/);
  assert.equal(P.statusText(status(1, [12], 13), now), 'Cumpliste la de esta semana');
  assert.equal(P.dayName(at(16), now), 'el viernes');
});

// ------------------------------------------------------------------ páginas
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

test('la vista del paciente muestra primero lo de hoy y pide el dolor al terminar (TD-100)', () => {
  const html = read('paciente.html');
  const js = read('patient.js');
  assert.match(html, /<h2 id="today-title">Hoy toca<\/h2>/);
  assert.match(html, /id="rest-plan"/);
  assert.ok(html.indexOf('care-plan.js') < html.indexOf('patient.js') && html.indexOf('pain-scale.js') < html.indexOf('patient.js'));
  assert.ok(js.includes('AxonCarePlan.agenda(me.plan)'));
  assert.ok(js.includes('askPain(saved.session_id'));
});

test('la cámara y el Prototipo en modo paciente piden el dolor al guardar (TD-100)', () => {
  for (const [page, script, box] of [['seguimiento.html', 'seguimiento.js', 'eva-track'], ['index.html', 'patient-link.js', 'eva-index']]) {
    const html = read(page);
    const js = read(script);
    assert.ok(html.includes('pain-scale.js'), `${page} carga pain-scale.js`);
    assert.ok(html.indexOf('pain-scale.js') < html.indexOf(script), `${page}: antes de ${script}`);
    assert.ok(js.includes(`AxonPainScale.render($('${box}')`), `${script} usa ${box}`);
    assert.ok(js.includes('res.session_id'));
  }
});

test('la escala EVA es accesible: grupo con leyenda, 11 opciones con nombre, estado anunciado y foco (WCAG 2.2 AA)', () => {
  const js = read('pain-scale.js');
  assert.ok(js.includes("node('fieldset', 'eva-group')") && js.includes("node('legend'"));
  assert.ok(js.includes('for (let v = 0; v <= 10; v += 1)'));
  assert.ok(js.includes("radio.type = 'radio'"));
  assert.ok(js.includes("status.setAttribute('role', 'status')"));
  assert.ok(js.includes("p.focus("), 'al reemplazar el formulario el foco no se pierde');
  assert.ok(js.includes("'Ahora no'"), 'es opcional');
  assert.ok(js.includes('/pain'));
  const css = read('hud.css');
  assert.match(css, /\.eva-option:has\(input:focus-visible\)/);
  assert.match(css, /\.eva-option \{[^}]*min-height: 48px/);
});

test('el umbral de dolor alto es el mismo en la API y en el panel', () => {
  const py = fs.readFileSync(path.join(ROOT, 'src', 'backend', 'staging_api.py'), 'utf8');
  const js = read('doctor.js');
  assert.equal(py.match(/^PAIN_HIGH = (\d+)/m)[1], js.match(/const PAIN_HIGH = (\d+)/)[1]);
});

test('el seguimiento usa la meta del plan en modo paciente (TD-99)', () => {
  const js = read('seguimiento.js');
  assert.ok(js.includes('T.withGoal(T.SPECS[st.ex.id]'));
  assert.ok(js.includes("case 'over_limit'"));
  assert.ok(js.includes('overLimit: r.overLimit'));
});
