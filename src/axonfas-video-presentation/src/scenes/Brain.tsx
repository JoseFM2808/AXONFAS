// Fase 3 · The Brain: la arquitectura real. En el navegador, la pose 2D y el motor de reglas (las alertas, nunca la IA,
// ADR-004); al servidor solo llegan coordenadas (ADR-003). Los 3 agentes (clinical.py, coach.py, soap.py) proponen dentro
// del sobre del fisioterapeuta (ADR-005) con la IA de AMD Token Factory (ADR-018). La nota SOAP sale como documento FHIR
// R4 y el fisioterapeuta la firma. La pila de la MI300X está lista pero todavía no corre (TD-34): se dibuja punteada.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import type { Phase } from '../timeline';
import { Backdrop, C, Captions, PhaseTag, ease, useSceneFade } from '../ui';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
type Pt = [number, number];

const Node: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  color?: string;
  show: number;
  pulse?: number;
  dashed?: boolean;
}> = ({ x, y, w, h, title, sub, color = C.tape, show, pulse = 0, dashed }) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      width: w,
      height: h,
      opacity: show,
      transform: `scale(${0.9 + 0.1 * show})`,
      borderRadius: 16,
      border: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
      background: `linear-gradient(160deg, ${C.surface2}, ${C.surface})`,
      boxShadow: pulse > 0 ? `0 0 ${12 + 30 * pulse}px ${color}` : C.shadow,
      padding: '14px 20px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 4,
    }}
  >
    <div style={{ fontFamily: C.display, fontWeight: 700, fontSize: 28, color: C.ink, lineHeight: 1.1 }}>{title}</div>
    {sub && <div style={{ fontFamily: C.mono, fontSize: 17, color, letterSpacing: 0.5, lineHeight: 1.3 }}>{sub}</div>}
  </div>
);

const Edge: React.FC<{ pts: Pt[]; show: number; frame: number; color?: string; packets?: number; speed?: number; back?: boolean }> = ({
  pts,
  show,
  frame,
  color = C.tape,
  packets = 3,
  speed = 0.018,
  back,
}) => {
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = segs.reduce((a, b) => a + b, 0);
  const at = (u: number): Pt => {
    let d = u * total;
    for (let i = 0; i < segs.length; i++) {
      if (d <= segs[i]) {
        const f = d / segs[i];
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
      }
      d -= segs[i];
    }
    return pts[pts.length - 1];
  };
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  return (
    <g>
      <path
        d={d}
        style={{
          fill: 'none',
          stroke: color,
          strokeOpacity: 0.55,
          strokeWidth: 3,
          strokeDasharray: total,
          strokeDashoffset: total * (1 - show),
        }}
      />
      {show >= 1 &&
        Array.from({ length: packets }, (_, i) => {
          let u = (frame * speed + i / packets) % 1;
          if (back) u = 1 - u;
          const [x, y] = at(u);
          return <circle key={i} cx={x} cy={y} r={7} style={{ fill: color, filter: `drop-shadow(0 0 8px ${color})` }} />;
        })}
    </g>
  );
};

export const Brain: React.FC<{ phase: Phase }> = ({ phase }) => {
  const frame = useCurrentFrame();
  const fade = useSceneFade(phase.frames, 10, 14);
  const [arch, rules, agents] = phase.clips;
  const a0 = arch?.from ?? 18;
  const r0 = rules?.from ?? 150;
  const g0 = agents?.from ?? 260;
  const zoom = interpolate(frame, [0, 36], [1.3, 1], { ...clamp, easing: ease });
  const blur = interpolate(frame, [0, 30], [10, 0], clamp);
  const at = (start: number, len = 16) => interpolate(frame, [start, start + len], [0, 1], { ...clamp, easing: ease });
  const beat = 0.5 + 0.5 * Math.sin(frame / 6); // latido común de los nodos que trabajan
  const alertBeat = frame >= r0 ? 0.5 + 0.5 * Math.sin(frame / 4) : 0;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Backdrop />
      <PhaseTag index={3} title={phase.title} />
      <AbsoluteFill style={{ transform: `scale(${zoom})`, filter: `blur(${blur}px)` }}>
        {/* Grupos */}
        <div
          style={{
            position: 'absolute',
            left: 70,
            top: 140,
            width: 500,
            height: 740,
            borderRadius: 24,
            border: `1.5px solid ${C.border}`,
            background: C.tapeSoft,
            opacity: at(a0, 14),
          }}
        >
          <div style={{ fontFamily: C.mono, fontSize: 20, color: C.tape, letterSpacing: 3, padding: '18px 24px' }}>
            PATIENT'S BROWSER · AT HOME
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 640,
            top: 380,
            width: 640,
            height: 500,
            borderRadius: 24,
            border: `2.5px dashed ${C.safe}`,
            background: C.safeSoft,
            opacity: at(g0, 14),
          }}
        >
          <div style={{ fontFamily: C.mono, fontSize: 19, color: C.safe, letterSpacing: 2, padding: '16px 24px' }}>
            SAFETY ENVELOPE · SET BY THE THERAPIST
          </div>
        </div>

        <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
          <Edge pts={[[320, 296], [320, 336]]} show={at(a0 + 10)} frame={frame} packets={1} />
          <Edge pts={[[320, 436], [320, 476]]} show={at(a0 + 16)} frame={frame} packets={1} />
          <Edge pts={[[320, 576], [320, 616]]} show={at(r0)} frame={frame} color={C.alert} packets={1} speed={0.04} />
          <Edge pts={[[570, 386], [640, 386], [640, 280], [700, 280]]} show={at(a0 + 24)} frame={frame} />
          <Edge pts={[[870, 330], [870, 380]]} show={at(g0)} frame={frame} packets={2} />
          <Edge pts={[[1260, 500], [1330, 500], [1330, 280], [1400, 280]]} show={at(g0 + 20)} frame={frame} packets={3} speed={0.022} />
          <Edge pts={[[1400, 300], [1350, 300], [1350, 520], [1260, 520]]} show={at(g0 + 26)} frame={frame} packets={3} speed={0.022} color={C.safe} />
          <Edge pts={[[1260, 776], [1350, 776], [1350, 540], [1400, 540]]} show={at(g0 + 40)} frame={frame} packets={2} />
          <Edge pts={[[1620, 600], [1620, 650]]} show={at(g0 + 52)} frame={frame} packets={1} color={C.safe} />
        </svg>

        <div
          style={{
            position: 'absolute',
            left: 584,
            top: 186,
            width: 200,
            opacity: at(a0 + 30),
            fontFamily: C.mono,
            fontSize: 16,
            lineHeight: 1.35,
            color: C.ink2,
            textAlign: 'center',
          }}
        >
          2D COORDINATES ONLY
          <br />
          <span style={{ color: C.safe }}>NEVER VIDEO</span>
        </div>

        {/* En casa */}
        <Node x={100} y={210} w={440} h={86} title="Webcam" sub="Video stays in the browser" show={at(a0)} />
        <Node x={100} y={336} w={440} h={100} title="MediaPipe Pose · 2D" sub="33 landmarks · pose-camera.js" show={at(a0 + 8)} pulse={beat * 0.3} />
        <Node
          x={100}
          y={476}
          w={440}
          h={100}
          title="Rule engine"
          sub="Deterministic · engine.js"
          color={frame >= r0 ? C.alert : C.tape}
          show={at(a0 + 14)}
          pulse={alertBeat * 0.8}
        />
        <Node x={100} y={616} w={440} h={100} title="Safety alert" sub="Target < 250 ms · digital twin guide" color={C.alert} show={at(r0 + 6)} pulse={alertBeat} />
        <Node x={100} y={756} w={440} h={96} title="Level 1 triage" sub="Red flags · fixed rules, no AI" color={C.hold} show={at(r0 + 16)} />

        {/* Servidor y agentes */}
        <Node x={700} y={230} w={340} h={100} title="AXONFAS API" sub="Staging · synthetic data" show={at(a0 + 30)} pulse={beat * 0.3} />
        <Node x={680} y={450} w={580} h={100} title="Clinical agent" sub="clinical.py · proposes {param, old, new, reason}" show={at(g0 + 8)} pulse={beat * 0.5} />
        <Node x={680} y={590} w={580} h={100} title="Coach agent" sub="coach.py · situational voice cues" show={at(g0 + 16)} pulse={beat * 0.5} />
        <Node x={680} y={730} w={580} h={100} title="Report agent" sub="soap.py · SOAP draft from session data" show={at(g0 + 24)} pulse={beat * 0.5} />

        {/* IA de AMD y salida clínica */}
        <Node x={1400} y={200} w={440} h={140} title="AMD Token Factory" sub="DeepSeek-V4-Flash · live today" show={at(g0 + 18)} pulse={beat} />
        <Node x={1400} y={480} w={440} h={120} title="FHIR R4 document" sub="SOAP note as a Bundle · Observation" color={C.safe} show={at(g0 + 40)} />
        <Node x={1400} y={650} w={440} h={100} title="Therapist signs" sub="Draft until reviewed" color={C.safe} show={at(g0 + 52)} />
        <Node
          x={1400}
          y={782}
          w={440}
          h={100}
          title="AMD Instinct MI300X stack"
          sub="Ready, not live yet · vLLM · Whisper"
          color={C.hold}
          dashed
          show={at(g0 + 70) * 0.85}
        />

        {frame >= r0 && (
          <div
            style={{
              position: 'absolute',
              left: 830,
              top: 146,
              opacity: at(r0 + 4),
              fontFamily: C.display,
              fontWeight: 700,
              fontSize: 30,
              color: C.alertInk,
              letterSpacing: 1,
            }}
          >
            Alerts: rules only. Never the AI.
          </div>
        )}
      </AbsoluteFill>
      <Captions clips={phase.clips} />
    </AbsoluteFill>
  );
};
