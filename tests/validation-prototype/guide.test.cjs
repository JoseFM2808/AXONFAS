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
      assert.ok(!pose.body || ['stand', 'supine', 'side', 'quad'].includes(pose.body), `${e.id}: postura desconocida`);
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
        const lowest = G.lowestY(p, guide);
        assert.ok(Math.abs(lowest) < 0.035, `${id}: el contorno más bajo no toca el suelo (${lowest})`);
      }
      const a = p._w[guide.anchor];
      assert.ok(Math.abs(a.x - ctx.anchor.x) < 1e-9 && Math.abs(a.z - ctx.anchor.z) < 1e-9, `${id}: el ancla ${guide.anchor} se desliza`);
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

test('cada figura dice qué se mueve, con segmentos que existen (design system §4)', () => {
  const groups = new Set(['aN', 'aF', 'lN', 'lF', 'feet', 'abs', 'scap']);
  for (const [id, guide] of Object.entries(G.GUIDES)) {
    assert.ok(guide.focus && guide.focus.length, `${id}: sin segmentos activos`);
    for (const k of guide.focus) assert.ok(groups.has(k) || G.SEGMENTS[k], `${id}: segmento desconocido '${k}'`);
    for (const sname of G.focusOf(guide)) {
      if (guide.upper) assert.ok(!/thigh|shin|foot/.test(sname), `${id}: resalta una pierna en una vista de medio cuerpo`);
    }
  }
});

test('la flecha sale del punto que más se mueve y falta solo donde la cámara no ve el movimiento', () => {
  const noArrow = new Set(['abdominal-bracing', 'scapula-setting']);
  for (const [id, guide] of Object.entries(G.GUIDES)) {
    const ctx = G.prepare(guide);
    const m = G.motion(guide, ctx, guide.seq[0][0], G.endPose(guide));
    if (noArrow.has(id)) assert.equal(m, null, `${id}: no debería llevar flecha`);
    else assert.ok(m && m.d >= 0.06, `${id}: sin flecha de movimiento`);
  }
  const ctx = G.prepare(G.GUIDES['hip-abduction']);
  assert.equal(G.motion(G.GUIDES['hip-abduction'], ctx, G.GUIDES['hip-abduction'].seq[0][0], G.endPose(G.GUIDES['hip-abduction'])).key, 'toN',
    'en la abducción, la flecha sigue el pie de la pierna que sube');
});

test('todas las figuras de cuerpo entero se dibujan a la misma escala', () => {
  const scale = (id) => { const g = G.GUIDES[id]; return G.layout(g, G.prepare(g), 600, 400, 1).s; };
  const standing = ['sit-to-stand', 'tandem-stance', 'one-leg-stand', 'calf-raises', 'half-squat', 'hamstring-curl', 'standing-row'];
  const ref = scale(standing[0]);
  for (const id of standing) assert.ok(Math.abs(scale(id) - ref) < 1e-9, `${id}: escala distinta (${scale(id)} vs ${ref})`);
  const lying = ['straight-leg-raise', 'hip-bridge', 'knee-to-chest', 'abdominal-bracing'];
  for (const id of lying) assert.ok(Math.abs(scale(id) - ref) < 1e-9, `${id}: acostado, misma escala que de pie`);
  const upper = ['neck-side-flexion', 'crossover-arm-stretch', 'scapula-setting'];
  const refU = scale(upper[0]);
  for (const id of upper) assert.ok(Math.abs(scale(id) - refU) < 1e-9, `${id}: medio cuerpo, escala distinta`);
  // y la figura cabe en el lienzo, debajo de la franja de las etiquetas
  for (const [id, g] of Object.entries(G.GUIDES)) {
    const ctx = G.prepare(g);
    const lay = G.layout(g, ctx, 600, 400, 1);
    const c = lay.cells[0];
    const top = c.oy + ctx.box.minY * lay.s;
    const left = c.ox + ctx.box.minX * lay.s;
    const right = c.ox + ctx.box.maxX * lay.s;
    assert.ok(top >= 400 * G.FRAME.top - 1, `${id}: la figura invade la franja de etiquetas (${top.toFixed(1)})`);
    assert.ok(left >= 0 && right <= 600, `${id}: la figura se sale por los costados`);
  }
});

test('la figura usa los músculos del mapa y en cada ejercicio se enciende al menos uno del catálogo', () => {
  const DATA = require(path.join(SRC, 'body-map-data.js'));
  const known = new Set([...Object.keys(DATA.anterior), ...Object.keys(DATA.posterior), 'soleus', 'tibialis', 'neutral']);
  for (const set of Object.values(G.SHAPES)) {
    for (const shapes of Object.values(set)) {
      for (const sh of shapes) for (const m of sh.m) assert.ok(known.has(m), `músculo desconocido en la figura: ${m}`);
    }
  }
  for (const e of C.EXERCISES) {
    const guide = G.GUIDES[e.id];
    const ctx = G.prepare(guide);
    const pose = G.endPose(guide);
    const p = G.solvePose(pose, guide, ctx);
    const want = G.musclesFor(e.id, C);
    const lit = G.outlines(p, guide, pose).filter((o) => !o.neutral && o.m.some((m) => want.has(m)));
    assert.ok(lit.length > 0, `${e.id}: ninguno de sus músculos (${[...want].join(', ')}) se ve en la figura`);
  }
});

test('el contorno muscular es una figura completa: tronco, cabeza y, salvo en medio cuerpo, piernas', () => {
  for (const [id, guide] of Object.entries(G.GUIDES)) {
    const ctx = G.prepare(guide);
    const pose = guide.seq[0][0];
    const parts = new Set(G.outlines(G.solvePose(pose, guide, ctx), guide, pose).map((o) => o.part));
    for (const k of ['torso', 'neck', 'head', 'upper', 'fore']) assert.ok(parts.has(k), `${id}: falta ${k}`);
    if (!guide.upper) for (const k of ['thigh', 'shin', 'foot']) assert.ok(parts.has(k), `${id}: falta ${k}`);
  }
});

test('en las tarjetas se anima solo la que se mira; dentro del ejercicio, siempre (TD-59)', () => {
  assert.equal(G.playMode('card'), 'hover', 'galería y plan: quieta hasta el mouse encima o un toque');
  assert.equal(G.playMode('large'), 'auto', 'guía, "Cómo se hace" y vista guiada: siempre animada');
  assert.equal(G.playMode('pip'), 'auto', 'sobre el video del seguimiento y en el aviso de enseñanza');
  assert.equal(G.playMode('card', 'auto'), 'auto', 'una tarjeta sola (vista previa del fisioterapeuta) puede pedir siempre');
  const fs = require('node:fs');
  const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
  assert.ok(!/play: 'hover'/.test(read('app.js') + read('seguimiento.js') + read('patient.js')), 'dentro del ejercicio nunca espera al mouse');
  assert.ok(read('doctor.js').includes("play: 'auto'"), 'la vista previa para enseñar muestra el ejercicio animado');
  const css = read('hud.css');
  assert.ok(css.includes('.fig-play') && css.includes('[data-play="hover"]'), 'botón y estado de la tarjeta en el componente .fig');
});

test('en inglés, cada figura guía tiene sus textos traducidos y la forma de GUIDES no cambia (ADR-030)', () => {
  const I = require(path.join(SRC, 'i18n.js'));
  const file = require.resolve(path.join(SRC, 'guide-figure.js'));
  const EN = require(path.join(SRC, 'i18n', 'library.js')).data.guides.en;
  const spanish = /[áéíóúñ¿¡]|\b(de|del|la|las|el|los|con|sin|y|una?|para|por|que)\b/i;
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(G.GUIDES).sort(), 'una traducción por figura, sin sobrantes');
  for (const [id, g] of Object.entries(G.GUIDES)) {
    assert.deepEqual(Object.keys(EN[id]).sort(), Object.keys(g.cues).sort(), `${id}: mismas fases que en español`);
  }
  I.use('en');
  delete require.cache[file];
  try {
    const GE = require(file);
    for (const [id, g] of Object.entries(GE.GUIDES)) {
      assert.deepEqual(g.cues, G.GUIDES[id].cues, `${id}: GUIDES sigue en español (fuente de verdad)`);
      assert.deepEqual(g.seq, G.GUIDES[id].seq, `${id}: las poses no cambian`);
      const cues = GE.cuesFor(id);
      for (const k of Object.keys(g.cues)) {
        assert.equal(cues[k], EN[id][k], `${id}.${k}`);
        assert.ok(!spanish.test(cues[k]), `${id}.${k}: parece español: ${cues[k]}`);
      }
      assert.ok(cues.view && !spanish.test(cues.view), `${id}: vista en inglés`);
    }
    const texts = new Set();
    const guide = GE.GUIDES['hip-abduction'];
    for (let t = 0; t < GE.timeline(guide, 5).total; t += 97) texts.add(GE.frameAt(guide, 5, t).caption);
    assert.ok(texts.has('Hold 5 s'), 'el sostén dice el tiempo real de la dosis, en inglés');
    assert.ok(texts.has(EN['hip-abduction'].go));
  } finally {
    I.use('es');
    delete require.cache[file];
  }
});
