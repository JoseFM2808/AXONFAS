// Fase 2 · The Capture: AXONFAS se presenta y el HUD de la cámara se enciende. El esqueleto de sentarse y pararse
// cuenta repeticiones, el mapa muscular muestra la carga estimada y, en una repetición, el motor de reglas marca valgo de
// rodilla y el gemelo digital dibuja la guía de corrección (twin.js). El video nunca sale del navegador (ADR-003).
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { BodyMap, sitToStandLoads } from '../bodymap';
import { Figure, repPhase, sitToStand } from '../figure';
import type { Phase } from '../timeline';
import { Backdrop, Brackets, C, Captions, Chip, Glass, LogoMark, PhaseTag, Wordmark, ease, useSceneFade } from '../ui';

const PERIOD = 96; // fotogramas por repetición
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const Gauge: React.FC<{ label: string; value: number; max: number; unit: string; color: string; note?: string }> = ({
  label,
  value,
  max,
  unit,
  color,
  note,
}) => {
  const f = Math.min(1, value / max);
  const r = 64;
  const arc = Math.PI * r;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
      <svg width={160} height={96}>
        <path d={`M16 88 A${r} ${r} 0 0 1 144 88`} style={{ fill: 'none', stroke: C.surface2, strokeWidth: 14, strokeLinecap: 'round' }} />
        <path
          d={`M16 88 A${r} ${r} 0 0 1 144 88`}
          style={{
            fill: 'none',
            stroke: color,
            strokeWidth: 14,
            strokeLinecap: 'round',
            strokeDasharray: arc,
            strokeDashoffset: arc * (1 - f),
            filter: `drop-shadow(0 0 8px ${color})`,
          }}
        />
      </svg>
      <div>
        <div style={{ fontFamily: C.mono, fontSize: 18, color: C.muted, letterSpacing: 2, textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontFamily: C.display, fontSize: 56, color: C.ink, lineHeight: 1.05 }}>
          {Math.round(value)}
          <span style={{ fontSize: 30, color: C.muted }}>{unit}</span>
        </div>
        {note && <div style={{ fontFamily: C.body, fontSize: 18, color: color }}>{note}</div>}
      </div>
    </div>
  );
};

export const Capture: React.FC<{ phase: Phase }> = ({ phase }) => {
  const frame = useCurrentFrame();
  const fade = useSceneFade(phase.frames, 12, 12);
  const [meet, platform, , noWear] = phase.clips;
  const hudIn = (platform?.from ?? 110) + 50;

  // Intro del logo.
  const logoDraw = interpolate(frame, [6, 50], [0, 1], { ...clamp, easing: ease });
  const logoOut = interpolate(frame, [hudIn - 30, hudIn], [0, 1], { ...clamp, easing: ease });
  const tracking = interpolate(frame, [10, 60], [0.6, 0.18], { ...clamp, easing: ease });

  // HUD.
  const hud = interpolate(frame, [hudIn - 10, hudIn + 20], [0, 1], { ...clamp, easing: ease });
  const local = Math.max(0, frame - hudIn);
  const rep = Math.floor(local / PERIOD);
  const t = repPhase(local, PERIOD);
  // La 3.ª repetición del HUD trae valgo de rodilla derecha: el motor alerta y el gemelo guía la corrección.
  const alertRep = 2;
  const inAlertRep = rep === alertRep;
  const valgus = inAlertRep ? Math.sin(Math.PI * t) : 0;
  const alertOn = inAlertRep && valgus > 0.45;
  const guide = inAlertRep ? interpolate(valgus, [0.45, 0.8], [0, 1], clamp) : 0;
  const pose = sitToStand(t, 0, valgus);
  const reps = Math.min(10, rep + (t > 0.98 ? 1 : 0) + 3);
  const knee = 90 * (1 - t);
  const trunk = 12 * (1 - t) + 30 * Math.sin(Math.PI * Math.min(1, t * 1.15));
  const chipsIn = noWear?.from ?? phase.frames - 150;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Backdrop />
      <PhaseTag index={2} title={phase.title} />

      {/* Presentación */}
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 30,
          opacity: 1 - logoOut,
          transform: `scale(${1 - 0.15 * logoOut})`,
        }}
      >
        <LogoMark size={220} draw={logoDraw} />
        <Wordmark size={150} spacing={tracking} style={{ opacity: interpolate(frame, [meet?.from ?? 20, (meet?.from ?? 20) + 16], [0, 1], clamp) }} />
        <div
          style={{
            fontFamily: C.body,
            fontSize: 38,
            color: C.ink2,
            opacity: interpolate(frame, [platform?.from ?? 90, (platform?.from ?? 90) + 16], [0, 1], clamp),
          }}
        >
          AI-assisted computer vision for <span style={{ color: C.tape }}>supervised home physiotherapy</span>
        </div>
      </AbsoluteFill>

      {/* Escenario de la cámara */}
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 120,
          width: 1060,
          height: 740,
          opacity: hud,
          transform: `translateY(${(1 - hud) * 40}px) scale(${0.96 + 0.04 * hud})`,
          borderRadius: 20,
          background: C.stage,
          border: `1.5px solid ${alertOn ? C.alert : C.border}`,
          boxShadow: alertOn ? C.alertGlow : C.shadowLg,
          overflow: 'hidden',
        }}
      >
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${C.figGrid} 1px, transparent 1px), linear-gradient(90deg, ${C.figGrid} 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        />
        <div style={{ position: 'absolute', left: 140, top: 50, width: 780, height: 680 }}>
          <Figure pose={pose} width={780} height={680} yaw={-52} scale={330} alert={alertOn ? 'valgus' : null} guide={guide} />
        </div>
        <Brackets w={1060} h={740} color={alertOn ? C.alert : C.tape} />
        <div style={{ position: 'absolute', left: 32, top: 26, display: 'flex', gap: 14 }}>
          <Chip color={C.safe} soft={C.safeSoft}>Pose · in-browser</Chip>
          <Chip>Video stays on this device</Chip>
        </div>
        <div style={{ position: 'absolute', right: 34, top: 24, textAlign: 'right' }}>
          <div style={{ fontFamily: C.mono, fontSize: 20, color: C.muted, letterSpacing: 3 }}>REPS</div>
          <div style={{ fontFamily: C.display, fontSize: 96, color: C.ink, lineHeight: 1 }}>
            {reps}
            <span style={{ fontSize: 44, color: C.muted }}>/10</span>
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 32,
            bottom: 28,
            fontFamily: C.mono,
            fontSize: 20,
            color: C.muted,
            letterSpacing: 2,
          }}
        >
          SIT-TO-STAND · 33 LANDMARKS · ONLY 2D COORDINATES LEAVE THE BROWSER
        </div>
        {alertOn && (
          <div
            style={{
              position: 'absolute',
              right: 30,
              bottom: 26,
              padding: '16px 24px',
              borderRadius: 14,
              background: C.alertSoft,
              border: `2px solid ${C.alert}`,
              boxShadow: C.alertGlow,
              maxWidth: 470,
            }}
          >
            <div style={{ fontFamily: C.display, fontSize: 34, color: C.alertInk, fontWeight: 700 }}>Right knee caving in</div>
            <div style={{ fontFamily: C.body, fontSize: 24, color: C.ink }}>Push your knee out, over your toes</div>
            <div style={{ fontFamily: C.mono, fontSize: 16, color: C.ink2, marginTop: 6, letterSpacing: 1 }}>
              RULE ENGINE · PELVIS FRAME · NOT THE AI
            </div>
          </div>
        )}
      </div>

      {/* Telemetría y mapa muscular */}
      <Glass
        style={{
          left: 1180,
          top: 120,
          width: 660,
          height: 740,
          padding: 34,
          opacity: hud,
          transform: `translateX(${(1 - hud) * 60}px)`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Gauge label="Knee flexion" value={knee} max={110} unit="°" color={C.tape} />
          <Gauge
            label="Trunk flexion"
            value={trunk}
            max={70}
            unit="°"
            color={trunk > 40 ? C.hold : C.safe}
            note="Threshold = your baseline + therapist margin"
          />
        </div>
        <div style={{ height: 1, background: C.border, margin: '22px 0' }} />
        <div style={{ fontFamily: C.mono, fontSize: 18, color: C.tape, letterSpacing: 2 }}>BODY MAP · ESTIMATED LOAD</div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
          <BodyMap loads={sitToStandLoads(t)} width={330} height={350} />
        </div>
        <div style={{ fontFamily: C.body, fontSize: 18, color: C.muted, marginTop: 20, textAlign: 'center' }}>
          Educational estimate from joint angles, not a measurement
        </div>
      </Glass>

      {/* No hace falta nada más */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 876,
          display: 'flex',
          justifyContent: 'center',
          gap: 18,
        }}
      >
        {['No wearables', 'Standard webcam', 'Digital twin · correction guide'].map((label, i) => {
          const r = interpolate(frame, [chipsIn + i * 8, chipsIn + i * 8 + 14], [0, 1], { ...clamp, easing: ease });
          return (
            <div key={label} style={{ opacity: r, transform: `translateY(${(1 - r) * 16}px)` }}>
              <Chip color={i === 2 ? C.safe : C.tape} soft={i === 2 ? C.safeSoft : C.tapeSoft}>
                {label}
              </Chip>
            </div>
          );
        })}
      </div>
      <Captions clips={phase.clips} />
    </AbsoluteFill>
  );
};
