// Fase 4 · The Impact: pantalla dividida (panel del fisioterapeuta con métricas sintéticas y la nota SOAP que pasa de
// borrador a firmada, y el paciente en su sesión guiada) y la revelación del logo con efecto glassmorphism.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Figure, repPhase, sitToStand } from '../figure';
import type { Phase } from '../timeline';
import { Backdrop, C, Captions, Chip, Glass, LogoMark, PhaseTag, Wordmark, ease, useSceneFade } from '../ui';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
// Pico de flexión de tronco por sesión: datos sintéticos de demostración (ADR-010).
const TRUNK_PEAKS = [44, 41, 39, 35, 33, 30, 28];

const Kpi: React.FC<{ label: string; value: string; color?: string; show: number }> = ({ label, value, color = C.ink, show }) => (
  <div
    style={{
      flex: 1,
      padding: '16px 18px',
      borderRadius: 14,
      background: C.surface,
      border: `1px solid ${C.border}`,
      opacity: show,
      transform: `translateY(${(1 - show) * 14}px)`,
    }}
  >
    <div style={{ fontFamily: C.mono, fontSize: 15, color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase' }}>{label}</div>
    <div style={{ fontFamily: C.display, fontSize: 46, color, lineHeight: 1.15 }}>{value}</div>
  </div>
);

export const Impact: React.FC<{ phase: Phase }> = ({ phase }) => {
  const frame = useCurrentFrame();
  const fade = useSceneFade(phase.frames, 12, 24);
  const [result, tagline] = phase.clips;
  const split = interpolate(frame, [4, 30], [0, 1], { ...clamp, easing: ease });
  const at = (start: number, len = 16) => interpolate(frame, [start, start + len], [0, 1], { ...clamp, easing: ease });
  const r0 = result?.from ?? 60;
  const reveal = (tagline?.from ?? phase.frames - 160) - 24;
  const out = at(reveal, 26);
  const sign = r0 + 150; // el fisioterapeuta firma la nota
  const signed = frame >= sign;

  // Gráfico de tendencia.
  const cw = 520;
  const ch = 150;
  const drawn = at(r0 - 30, 60);
  const pts = TRUNK_PEAKS.map((v, i) => [20 + (i * (cw - 40)) / (TRUNK_PEAKS.length - 1), ch - 14 - ((v - 24) / 24) * (ch - 34)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');

  // Paciente.
  const local = frame;
  const t = repPhase(local, 90);
  const reps = Math.min(10, 4 + Math.floor(local / 90));

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Backdrop />
      <PhaseTag index={4} title={phase.title} />

      <AbsoluteFill style={{ opacity: 1 - out, filter: `blur(${out * 12}px)`, transform: `scale(${1 - 0.04 * out})` }}>
        {/* Fisioterapeuta */}
        <Glass style={{ left: 70, top: 130, width: 860, height: 740, padding: 32, transform: `translateX(${(1 - split) * -80}px)`, opacity: split }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontFamily: C.mono, fontSize: 18, color: C.tape, letterSpacing: 3 }}>THERAPIST DASHBOARD</div>
              <div style={{ fontFamily: C.display, fontSize: 38, color: C.ink, fontWeight: 700 }}>Patient P-07 · sit-to-stand</div>
            </div>
            <Chip color={C.safe} soft={C.safeSoft} style={{ fontSize: 18 }}>
              Live
            </Chip>
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 22 }}>
            <Kpi label="Reps today" value={`${reps}/10`} show={at(20)} />
            <Kpi label="Knee flexion peak" value="88°" color={C.tape} show={at(28)} />
            <Kpi label="Alerts" value="2" color={C.alertInk} show={at(36)} />
          </div>
          <div style={{ marginTop: 22, padding: 18, borderRadius: 14, background: C.surface, border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: C.mono, fontSize: 15, color: C.muted, letterSpacing: 1.5 }}>
              <span>TRUNK FLEXION PEAK PER SESSION</span>
              <span style={{ color: C.hold }}>SYNTHETIC DEMO DATA</span>
            </div>
            <svg width={cw} height={ch} style={{ marginTop: 8, width: '100%' }} viewBox={`0 0 ${cw} ${ch}`} preserveAspectRatio="none">
              <path
                d={line}
                style={{
                  fill: 'none',
                  stroke: C.safe,
                  strokeWidth: 4,
                  strokeDasharray: 900,
                  strokeDashoffset: 900 * (1 - drawn),
                  filter: 'drop-shadow(0 0 6px var(--safe))',
                }}
              />
              {pts.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={6} style={{ fill: C.bg, stroke: C.safe, strokeWidth: 3, opacity: drawn > i / pts.length ? 1 : 0 }} />
              ))}
            </svg>
          </div>
          <div
            style={{
              marginTop: 22,
              padding: '18px 22px',
              borderRadius: 14,
              border: `1.5px solid ${signed ? C.safe : C.hold}`,
              background: signed ? C.safeSoft : C.holdSoft,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              opacity: at(r0 + 20),
            }}
          >
            <div>
              <div style={{ fontFamily: C.display, fontSize: 28, color: C.ink, fontWeight: 700 }}>SOAP note</div>
              <div style={{ fontFamily: C.body, fontSize: 22, color: signed ? C.safe : C.hold }}>
                {signed ? 'Signed by the therapist · FHIR R4 final' : 'Draft · built only from session data'}
              </div>
            </div>
            <div
              style={{
                fontFamily: C.mono,
                fontSize: 18,
                letterSpacing: 1.5,
                padding: '12px 20px',
                borderRadius: 10,
                color: C.bg,
                background: signed ? C.safe : C.tape,
                transform: `scale(${frame >= sign - 8 && frame < sign ? 0.94 : 1})`,
              }}
            >
              {signed ? 'EXPORT FHIR' : 'REVIEW & SIGN'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 22, opacity: at(r0 + 60) }}>
            <Chip style={{ fontSize: 16 }}>Every AI proposal checked by rules</Chip>
            <Chip color={C.safe} soft={C.safeSoft} style={{ fontSize: 16 }}>
              Pseudonymous patient
            </Chip>
          </div>
        </Glass>

        {/* Paciente */}
        <Glass style={{ left: 990, top: 130, width: 860, height: 740, transform: `translateX(${(1 - split) * 80}px)`, opacity: split }}>
          <div style={{ position: 'absolute', left: 32, top: 28 }}>
            <div style={{ fontFamily: C.mono, fontSize: 18, color: C.tape, letterSpacing: 3 }}>PATIENT · AT HOME</div>
            <div style={{ fontFamily: C.display, fontSize: 38, color: C.ink, fontWeight: 700 }}>Today's plan · 2 × 10</div>
          </div>
          <div style={{ position: 'absolute', right: 32, top: 26, textAlign: 'right' }}>
            <div style={{ fontFamily: C.mono, fontSize: 18, color: C.muted, letterSpacing: 3 }}>REPS</div>
            <div style={{ fontFamily: C.display, fontSize: 80, color: C.ink, lineHeight: 1 }}>
              {reps}
              <span style={{ fontSize: 36, color: C.muted }}>/10</span>
            </div>
          </div>
          <div style={{ position: 'absolute', left: 130, top: 140, width: 600, height: 500 }}>
            <Figure pose={sitToStand(t)} width={600} height={500} yaw={34} scale={250} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: 32,
              right: 32,
              bottom: 28,
              padding: '16px 22px',
              borderRadius: 14,
              background: C.tapeSoft,
              border: `1.5px solid ${C.borderBright}`,
              display: 'flex',
              gap: 16,
              alignItems: 'center',
              opacity: at(r0 + 40),
            }}
          >
            <svg width={44} height={44} viewBox="0 0 44 44">
              {[0, 1, 2, 3, 4].map((i) => {
                const h = 8 + 26 * Math.abs(Math.sin(frame / 5 + i * 1.3));
                return <rect key={i} x={2 + i * 9} y={22 - h / 2} width={6} height={h} rx={3} style={{ fill: C.tape }} />;
              })}
            </svg>
            <div style={{ fontFamily: C.body, fontSize: 26, color: C.ink }}>"Nice and steady. Keep your chest up as you stand."</div>
          </div>
        </Glass>
      </AbsoluteFill>

      {/* Logo */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: out }}>
        <Glass
          bright
          style={{
            position: 'relative',
            width: 1240,
            padding: '70px 80px 60px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 22,
            transform: `scale(${0.92 + 0.08 * out})`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(110deg, transparent 30%, var(--tape-soft) 50%, transparent 70%)`,
              transform: `translateX(${interpolate(frame, [reveal + 10, reveal + 70], [-100, 100], clamp)}%)`,
            }}
          />
          <LogoMark size={170} draw={at(reveal, 40)} />
          <Wordmark size={150} spacing={interpolate(frame, [reveal, reveal + 50], [0.4, 0.16], { ...clamp, easing: ease })} />
          <div style={{ fontFamily: C.body, fontSize: 40, color: C.ink2, opacity: at(reveal + 20) }}>
            Redefining physical therapy through <span style={{ color: C.tape }}>intelligent vision</span>
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 14, opacity: at(reveal + 40) }}>
            <Chip style={{ fontSize: 18 }}>AI on AMD Token Factory</Chip>
            <Chip color={C.safe} soft={C.safeSoft} style={{ fontSize: 18 }}>
              Clinic-supervised · B2B2C
            </Chip>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 20, color: C.muted, letterSpacing: 2, marginTop: 6, opacity: at(reveal + 50) }}>
            AMD DEVELOPER HACKATHON · ACT III · github.com/JoseFM2808/AXONFAS
          </div>
        </Glass>
      </AbsoluteFill>
      <Captions clips={phase.clips} />
    </AbsoluteFill>
  );
};
