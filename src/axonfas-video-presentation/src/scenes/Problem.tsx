// Fase 1 · The Problem: la rehabilitación tradicional en gris (sensores con cables, notas a mano, observación subjetiva)
// y un barrido cian hacia la interfaz limpia cuando entra la segunda frase.
import React from 'react';
import { AbsoluteFill, interpolate, random, useCurrentFrame } from 'remotion';
import { Figure, project, sitToStand } from '../figure';
import type { Phase } from '../timeline';
import { Backdrop, C, Captions, Glass, PhaseTag, ease, useSceneFade } from '../ui';

const PAINS = [
  { title: 'Subjective observation', sub: '"Looks fine to me."' },
  { title: 'Cumbersome sensors', sub: 'Straps, cables, calibration' },
  { title: 'Manual notes', sub: 'Written up days later' },
];

const Scribble: React.FC<{ y: number; w: number; seed: number; draw: number }> = ({ y, w, seed, draw }) => {
  let d = `M0 ${y}`;
  for (let x = 0; x <= w; x += 14) {
    d += ` Q${x + 7} ${y - 8 - random(`${seed}-${x}`) * 10} ${x + 14} ${y + random(`${seed}-b-${x}`) * 6}`;
  }
  return (
    <path
      d={d}
      style={{
        fill: 'none',
        stroke: C.muted,
        strokeWidth: 3,
        strokeLinecap: 'round',
        strokeDasharray: w * 2.2,
        strokeDashoffset: w * 2.2 * (1 - draw),
      }}
    />
  );
};

export const Problem: React.FC<{ phase: Phase }> = ({ phase }) => {
  const frame = useCurrentFrame();
  const fade = useSceneFade(phase.frames, 10, 14);
  const turn = phase.clips[1]?.from ?? phase.frames - 90; // la segunda frase trae el barrido
  const sweep = interpolate(frame, [turn - 6, turn + 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });

  // Figura casi de pie, oscilando lento: la "sesión" de siempre.
  const t = 0.82 + 0.06 * Math.sin(frame / 22);
  const pose = sitToStand(t);
  const W = 640;
  const H = 700;
  const yaw = 32;
  const scale = 350;
  const at = (k: string, dy = 0) => {
    const p = project(pose[k], yaw, scale, W / 2, H * 0.9);
    return { x: p.x, y: p.y + dy };
  };
  const sensors = [
    { a: 'Rknee', b: 'Rhip', f: 0.5 },
    { a: 'Rknee', b: 'Rankle', f: 0.45 },
    { a: 'Lknee', b: 'Lhip', f: 0.5 },
    { a: 'Lshoulder', b: 'Lhip', f: 0.4 },
  ].map((s) => {
    const A = at(s.a);
    const B = at(s.b);
    return { x: A.x + (B.x - A.x) * s.f, y: A.y + (B.y - A.y) * s.f };
  });
  const box = { x: W - 40, y: H * 0.42 };
  const wobble = (i: number) => Math.sin(frame / 9 + i) * 6;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill style={{ filter: 'grayscale(1) brightness(0.8)' }}>
        <Backdrop grid={false} drift={false} />
        <PhaseTag index={1} title={phase.title} />

        <div style={{ position: 'absolute', left: 120, top: 110, width: W, height: H }}>
          <Figure pose={pose} width={W} height={H} yaw={yaw} scale={scale} dim landmarks={false} chair={false} />
          <svg width={W + 200} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            {sensors.map((s, i) => (
              <g key={i}>
                <path
                  d={`M${s.x} ${s.y} C ${s.x + 120} ${s.y + 60 + wobble(i)}, ${box.x - 120} ${box.y - 80 + wobble(i + 2)}, ${box.x} ${box.y + i * 16}`}
                  style={{ fill: 'none', stroke: C.figProp, strokeWidth: 3 }}
                />
                <rect x={s.x - 22} y={s.y - 15} width={44} height={30} rx={5} style={{ fill: C.surface2, stroke: C.muted, strokeWidth: 3 }} />
                <rect x={s.x - 36} y={s.y - 4} width={72} height={8} style={{ fill: C.figProp }} />
              </g>
            ))}
            <rect x={box.x} y={box.y - 30} width={120} height={120} rx={10} style={{ fill: C.surface, stroke: C.muted, strokeWidth: 3 }} />
            <text x={box.x + 60} y={box.y + 38} textAnchor="middle" style={{ fill: C.muted, fontFamily: C.mono, fontSize: 22 }}>
              DAQ
            </text>
          </svg>
        </div>

        <Glass style={{ right: 150, top: 150, width: 600, height: 560, padding: 40, transform: 'rotate(2deg)' }}>
          <div style={{ fontFamily: C.mono, fontSize: 22, color: C.muted, letterSpacing: 2 }}>SESSION NOTES · PAPER</div>
          <svg width={520} height={300} style={{ marginTop: 26 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Scribble
                key={i}
                y={30 + i * 46}
                w={i % 3 === 2 ? 300 : 460}
                seed={i}
                draw={interpolate(frame, [20 + i * 14, 50 + i * 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
              />
            ))}
          </svg>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 10 }}>
            <span style={{ fontFamily: C.display, fontSize: 88, color: C.muted }}>?°</span>
            <span style={{ fontFamily: C.body, fontSize: 30, color: C.muted }}>knee angle, by eye</span>
          </div>
        </Glass>

        <div style={{ position: 'absolute', left: 140, right: 140, top: 770, display: 'flex', gap: 28, justifyContent: 'center' }}>
          {PAINS.map((p, i) => {
            const r = interpolate(frame, [40 + i * 50, 62 + i * 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
            return (
              <div
                key={p.title}
                style={{
                  opacity: r,
                  transform: `translateY(${(1 - r) * 24}px)`,
                  padding: '14px 26px',
                  borderRadius: 14,
                  border: `1.5px solid ${C.muted}`,
                  background: C.surface,
                  minWidth: 380,
                }}
              >
                <div style={{ fontFamily: C.display, fontSize: 30, color: C.ink }}>{p.title}</div>
                <div style={{ fontFamily: C.body, fontSize: 22, color: C.muted }}>{p.sub}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* Barrido cian: detrás queda la interfaz limpia de AXONFAS. */}
      <AbsoluteFill style={{ clipPath: `inset(0 ${(1 - sweep) * 100}% 0 0)` }}>
        <Backdrop />
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontFamily: C.display,
              fontWeight: 700,
              fontSize: 120,
              color: C.ink,
              letterSpacing: '-0.01em',
              opacity: interpolate(frame, [turn + 10, turn + 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            }}
          >
            Smarter. <span style={{ color: C.tape, textShadow: '0 0 30px var(--tape-soft)' }}>Frictionless.</span>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 26, letterSpacing: 6, color: C.muted, textTransform: 'uppercase' }}>
            Just a camera and a browser
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
      {sweep > 0 && sweep < 1 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${sweep * 100}%`,
            width: 6,
            background: C.tape,
            boxShadow: '0 0 40px 12px var(--tape-soft), var(--accent-glow)',
          }}
        />
      )}
      <Captions clips={phase.clips} />
    </AbsoluteFill>
  );
};
