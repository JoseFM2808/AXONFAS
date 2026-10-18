// Gemelo digital del Prototipo: espejo con guía de corrección (TD-101). Solo poses sintéticas (ADR-010).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const W = require(path.join(SRC, 'twin.js'));

/** Puntos 2D normalizados (y hacia abajo): de pie, con la rodilla izquierda desplazada `shiftL` hacia la línea media. */
function image({ shiftL = 0, lean = 0 } = {}) {
  const pts = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const put = (i, x, y) => { pts[i] = { x, y, visibility: 0.95 }; };
  put(23, 0.55, 0.5); put(24, 0.45, 0.5);                 // izquierda del paciente a la derecha de la imagen
  put(25, 0.55 - shiftL, 0.7); put(26, 0.45, 0.7);
  put(27, 0.55, 0.9); put(28, 0.45, 0.9);
  put(11, 0.58 + lean, 0.2); put(12, 0.42 + lean, 0.2);
  return pts;
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('sin alerta no hay guía; con una alerta desconocida tampoco', () => {
  assert.deepEqual(W.guides(image(), null), []);
  assert.deepEqual(W.guides(image(), 'otra_cosa'), []);
  assert.deepEqual(W.guides(null, 'trunk_flexion'), []);
});

test('valgo: la línea objetivo va de cadera a tobillo y la flecha lleva la rodilla a esa línea', () => {
  const [target, arrow] = W.guides(image({ shiftL: 0.04 }), 'knee_valgus_left');
  assert.equal(target.kind, 'target');
  assert.deepEqual([target.from.x, target.from.y, target.to.x, target.to.y], [0.55, 0.5, 0.55, 0.9]);
  assert.equal(arrow.kind, 'arrow');
  near(arrow.from.x, 0.51, 1e-9, 'la flecha sale de la rodilla');
  near(arrow.to.x, 0.55, 1e-9, 'y llega a la línea cadera-tobillo');
  assert.equal(arrow.to.y, arrow.from.y, 'a la misma altura');
});

test('la guía de la rodilla derecha usa los puntos 24, 26 y 28', () => {
  const [target] = W.guides(image(), 'knee_valgus_right');
  assert.deepEqual([target.from.x, target.to.x], [0.45, 0.45]);
});

test('tronco: la línea objetivo es el mismo tronco en vertical y la flecha sale de los hombros', () => {
  const [target, arrow] = W.guides(image({ lean: 0.1 }), 'trunk_flexion');
  near(target.from.x, 0.5, 1e-9, 'desde el centro de la cadera');
  near(target.to.x, 0.5, 1e-9, 'vertical');
  const len = Math.hypot(0.1, 0.3);
  near(0.5 - target.to.y, len, 1e-9, 'mismo largo de tronco');
  near(arrow.from.x, 0.6, 1e-9, 'desde el centro de los hombros');
  assert.deepEqual(arrow.to, target.to);
});

test('sin los puntos necesarios no se inventa una guía', () => {
  const pts = image();
  pts[25] = null;
  assert.deepEqual(W.guides(pts, 'knee_valgus_left'), []);
});

test('los segmentos en alerta son los de la compensación', () => {
  assert.ok(W.isAlertBone('knee_valgus_left', 25, 23) && W.isAlertBone('knee_valgus_left', 25, 27));
  assert.ok(!W.isAlertBone('knee_valgus_left', 24, 26));
  assert.ok(W.isAlertBone('trunk_flexion', 12, 24) && !W.isAlertBone('trunk_flexion', 23, 25));
  assert.ok(!W.isAlertBone(null, 23, 25));
});

test('el gemelo solo dibuja: sin red, sin texto en el canvas y con colores de los tokens', () => {
  const js = read('twin.js');
  assert.ok(!/fetch\(|XMLHttpRequest|AxonApi/.test(js), 'nada sale del navegador');
  assert.ok(!/fillText|strokeText/.test(js), 'sin texto: el espejo lo invertiría');
  for (const token of ['--tape', '--alert', '--safe', '--muted', '--ink']) assert.ok(js.includes(`'${token}'`), token);
  const app = read('app.js');
  assert.ok(app.includes('AxonTwin.draw(') && !/#56B6E6|#F07A6F/.test(app), 'el Prototipo dibuja con el gemelo, sin colores fijos');
  const html = read('index.html');
  const twin = html.indexOf('<script src="twin.js">');
  assert.ok(twin > 0 && twin < html.indexOf('<script src="app.js">'), 'twin.js antes de app.js');
});
