// Tests de la figura de referencia de cada ejercicio (TD-44, ADR-014).
//   node --test "tests/validation-prototype/*.test.cjs"
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src', 'frontend', 'validation-prototype');
const G = require(path.join(SRC, 'guide-figure.js'));
const C = require(path.join(SRC, 'catalog.js'));

const POINTS = ['hip', 'sh', 'head', 'elN', 'wrN', 'elF', 'wrF', 'knN', 'anN', 'toN', 'knF', 'anF', 'toF'];
const sample = (guide, hold, fn) => {
  const total = G.timeline(guide, hold).total;
  for (let t = 0; t < total; t += 97) fn(G.frameAt(guide, hold, t), t);
};

test('cada ejercicio del catálogo tiene su figura de referencia', () => {
  for (const e of C.EXERCISES) {
    const g = G.GUIDES[e.id];
    assert.ok(g, `${e.id}: sin figura`);
    assert.ok(g.cues.start && g.cues.go && g.cues.back, `${e.id}: faltan textos de inicio, movimiento o vuelta`);
    assert.ok(g.seq.length >= 3, `${e.id}: al menos inicio, movimiento y vuelta`);
    for (const [pose, ms, cap] of g.seq) {
      assert.ok(ms === 'hold' || ms > 0, `${e.id}: duración inválida`);
      assert.ok(cap === 'hold' || g.cues[cap], `${e.id}: falta el texto '${cap}'`);
      assert.ok(Number.isFinite(pose.torso), `${e.id}: pose sin tronco`);
    }
    assert.ok(G.VIEW_LABEL[g.view], `${e.id}: vista desconocida`);
  }
  assert.equal(Object.keys(G.GUIDES).length, C.EXERCISES.length, 'hay figuras de ejercicios que no existen');
});

test('la figura queda apoyada en el suelo y el punto de apoyo no se desliza', () => {
  for (const [id, guide] of Object.entries(G.GUIDES)) {
    const ctx = G.prepare(guide);
    sample(guide, 5, (f) => {
      const p = G.solvePose(f.pose, guide, ctx);
      for (const k of POINTS) if (p[k]) assert.ok(Number.isFinite(p[k].x) && Number.isFinite(p[k].y), `${id}: ${k} no es un número`);
      if (!guide.upper) {
        const lowest = Math.max(...POINTS.filter((k) => p[k]).map((k) => p[k].y), p.head.y + G.L.head);
        assert.ok(Math.abs(lowest) < 1e-9, `${id}: el punto más bajo no toca el suelo (${lowest})`);
      }
      assert.ok(Math.abs(p[guide.anchor].x - ctx.anchorX) < 1e-9, `${id}: el ancla ${guide.anchor} se mueve`);
    });
  }
});

test('las manos que se apoyan en la silla o la mesa no se despegan', () => {
  for (const id of ['tandem-stance', 'one-leg-stand', 'calf-raises', 'half-squat', 'hamstring-curl', 'pendulum']) {
    const guide = G.GUIDES[id];
    const ctx = G.prepare(guide);
    sample(guide, 5, (f, t) => {
      const p = G.solvePose(f.pose, guide, ctx);
      for (const s of ['N', 'F']) {
        if (f.pose[`ik${s}`] !== 'prop') continue;
        const target = ctx.hands[s];
        const d = Math.hypot(p[`wr${s}`].x - target.x, p[`wr${s}`].y - target.y);
        assert.ok(d < 0.04, `${id} t=${t}: la mano ${s} quedó a ${d.toFixed(3)} m del apoyo`);
      }
    });
  }
});

test('el movimiento del ejercicio se ve en la figura', () => {
  const at = (id, which) => {
    const guide = G.GUIDES[id];
    const ctx = G.prepare(guide);
    return G.solvePose(which === 'start' ? guide.seq[0][0] : G.endPose(guide), guide, ctx);
  };
  const ang = (a, b, c) => {
    const u = { x: a.x - b.x, y: a.y - b.y }, v = { x: c.x - b.x, y: c.y - b.y };
    return (Math.acos((u.x * v.x + u.y * v.y) / Math.hypot(u.x, u.y) / Math.hypot(v.x, v.y)) * 180) / Math.PI;
  };
  // sentadilla: la rodilla se flexiona; puente: la cadera sube; elevación de talones: el tobillo sube
  assert.ok(180 - ang(at('half-squat', 'end').hip, at('half-squat', 'end').knN, at('half-squat', 'end').anN) > 50);
  assert.ok(at('hip-bridge', 'end').hip.y < at('hip-bridge', 'start').hip.y - 0.15, 'el puente sube la cadera');
  assert.ok(at('calf-raises', 'end').anN.y < at('calf-raises', 'start').anN.y - 0.05, 'los talones suben');
  assert.ok(at('hip-abduction', 'end').anN.y < at('hip-abduction', 'start').anN.y - 0.3, 'la pierna de arriba sube');
});

test('el sostén de la dosis aparece en la animación', () => {
  const guide = G.GUIDES['hip-abduction'];
  const steps = G.timeline(guide, 5).steps;
  assert.equal(steps.find((s) => s.cap === 'hold').ms, 3000, 'se anima hasta 3 s');
  const texts = new Set();
  sample(guide, 5, (f) => texts.add(f.caption));
  assert.ok(texts.has('Sostén 5 s'), 'el texto dice el tiempo real de la dosis');
  assert.equal(G.timeline(G.GUIDES['calf-raises'], 0).steps.find((s) => s.cap === 'hold').ms, 500);
});
