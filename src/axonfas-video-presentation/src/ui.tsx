// AXONFAS · piezas compartidas de las escenas. Todos los colores son tokens de docs/design-system/tokens.css
// (video.py copia el archivo a src/design-system/ antes de cada comando).
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont as loadDisplay } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadBody } from '@remotion/google-fonts/Outfit';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import type { Clip } from './timeline';

// Las tres familias de --font-display, --font-body y --font-mono.
loadDisplay('normal', { weights: ['500', '700'], subsets: ['latin'] });
loadBody('normal', { weights: ['300', '400', '600'], subsets: ['latin'] });
loadMono('normal', { weights: ['400', '700'], subsets: ['latin'] });

export const C = {
  bg: 'var(--bg)',
  bgGradient: 'var(--bg-gradient)',
  surface: 'var(--surface)',
  surface2: 'var(--surface-2)',
  border: 'var(--surface-border)',
  borderBright: 'var(--surface-border-bright)',
  ink: 'var(--ink)',
  ink2: 'var(--ink-secondary)',
  muted: 'var(--muted)',
  tape: 'var(--tape)',
  tapeSoft: 'var(--tape-soft)',
  glow: 'var(--accent-glow)',
  safe: 'var(--safe)',
  safeSoft: 'var(--safe-soft)',
  alert: 'var(--alert)',
  alertInk: 'var(--alert-ink)',
  alertSoft: 'var(--alert-soft)',
  alertGlow: 'var(--alert-glow)',
  hold: 'var(--hold)',
  holdSoft: 'var(--hold-soft)',
  stage: 'var(--stage)',
  figBg: 'var(--fig-bg)',
  figGrid: 'var(--fig-grid)',
  figGhost: 'var(--fig-ghost)',
  figProp: 'var(--fig-prop)',
  figFloor: 'var(--fig-floor)',
  muscle: 'var(--muscle)',
  display: 'var(--font-display)',
  body: 'var(--font-body)',
  mono: 'var(--font-mono)',
  radius: 'var(--radius)',
  radiusLg: 'var(--radius-lg)',
  radiusSm: 'var(--radius-sm)',
  shadow: 'var(--shadow)',
  shadowLg: 'var(--shadow-lg)',
} as const;

export const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** 0→1 entre dos fotogramas, con la curva de entrada del HUD. */
export function useRamp(from: number, duration: number, easing = ease) {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, from + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
}

/** Opacidad de entrada y salida de una escena entera. */
export function useSceneFade(frames: number, fadeIn = 12, fadeOut = 12) {
  const frame = useCurrentFrame();
  return interpolate(frame, [0, fadeIn, frames - fadeOut, frames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/** Fondo espacial con la malla táctica de las figuras. */
export const Backdrop: React.FC<{ grid?: boolean; drift?: boolean }> = ({ grid = true, drift = true }) => {
  const frame = useCurrentFrame();
  const shift = drift ? (frame * 0.4) % 60 : 0;
  return (
    <AbsoluteFill style={{ background: C.bgGradient, backgroundColor: C.bg }}>
      {grid && (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${C.figGrid} 1px, transparent 1px), linear-gradient(90deg, ${C.figGrid} 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
            backgroundPosition: `${shift}px ${shift}px`,
            maskImage: 'radial-gradient(circle at 50% 40%, black 30%, transparent 85%)',
          }}
        />
      )}
    </AbsoluteFill>
  );
};

/** Panel de vidrio (glassmorphism) del HUD. */
export const Glass: React.FC<{
  style?: React.CSSProperties;
  bright?: boolean;
  children?: React.ReactNode;
}> = ({ style, bright, children }) => (
  <div
    style={{
      background: `linear-gradient(160deg, ${C.surface2}, ${C.surface})`,
      border: `1.5px solid ${bright ? C.borderBright : C.border}`,
      borderRadius: C.radiusLg,
      boxShadow: bright ? `${C.shadowLg}, ${C.glow}` : C.shadow,
      backdropFilter: 'blur(14px)',
      position: 'absolute',
      overflow: 'hidden',
      ...style,
    }}
  >
    {children}
  </div>
);

export const Chip: React.FC<{
  color?: string;
  soft?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ color = C.tape, soft = C.tapeSoft, children, style }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 20px',
      borderRadius: 999,
      border: `1.5px solid ${color}`,
      background: soft,
      color,
      fontFamily: C.mono,
      fontSize: 22,
      letterSpacing: 1,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    <span style={{ width: 10, height: 10, borderRadius: 99, background: color, boxShadow: `0 0 12px ${color}` }} />
    {children}
  </div>
);

/** Rótulo de la fase arriba a la izquierda y aviso de Staging arriba a la derecha. */
export const PhaseTag: React.FC<{ index: number; title: string }> = ({ index, title }) => {
  const r = useRamp(4, 18);
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 56,
          left: 72,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          opacity: r,
          transform: `translateX(${(1 - r) * -30}px)`,
          fontFamily: C.mono,
          fontSize: 24,
          letterSpacing: 4,
          color: C.tape,
          textTransform: 'uppercase',
        }}
      >
        <span style={{ color: C.muted }}>{String(index).padStart(2, '0')}</span>
        <span style={{ width: 48, height: 2, background: C.tape, boxShadow: C.glow }} />
        {title}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 52,
          right: 72,
          opacity: r,
          fontFamily: C.mono,
          fontSize: 18,
          letterSpacing: 2,
          color: C.hold,
          border: `1.5px solid ${C.hold}`,
          background: C.holdSoft,
          borderRadius: 999,
          padding: '8px 18px',
          textTransform: 'uppercase',
        }}
      >
        Staging · synthetic data
      </div>
    </>
  );
};

/** Subtítulos: una frase por clip de voz, en la misma ventana de tiempo que su audio. */
export const Captions: React.FC<{ clips: Clip[] }> = ({ clips }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hold = Math.round(0.25 * fps);
  const active = clips.find((c) => frame >= c.from - 4 && frame < c.from + c.frames + hold);
  if (!active) return null;
  const local = frame - active.from;
  const o = interpolate(local, [-4, 4, active.frames + hold - 6, active.frames + hold], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 56,
        display: 'flex',
        justifyContent: 'center',
        opacity: o,
        transform: `translateY(${(1 - o) * 12}px)`,
      }}
    >
      <div
        style={{
          maxWidth: 1760,
          padding: '14px 32px',
          borderRadius: C.radius,
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          border: `1px solid ${C.border}`,
          color: C.ink,
          fontFamily: C.body,
          fontSize: 36,
          lineHeight: 1.3,
          textAlign: 'center',
          textShadow: '0 2px 10px var(--bg)',
        }}
      >
        {active.text}
      </div>
    </div>
  );
};

/** Esquinas del visor de la cámara. */
export const Brackets: React.FC<{ w: number; h: number; color?: string; size?: number }> = ({
  w,
  h,
  color = C.tape,
  size = 44,
}) => {
  const s = { stroke: color, strokeWidth: 4, fill: 'none', filter: `drop-shadow(0 0 6px ${color})` } as const;
  return (
    <svg width={w} height={h} style={{ position: 'absolute', inset: 0 }}>
      <path d={`M2 ${size} V2 H${size}`} style={s} />
      <path d={`M${w - size} 2 H${w - 2} V${size}`} style={s} />
      <path d={`M2 ${h - size} V${h - 2} H${size}`} style={s} />
      <path d={`M${w - size} ${h - 2} H${w - 2} V${h - size}`} style={s} />
    </svg>
  );
};

/** Marca de AXONFAS: una pierna seguida por la cámara (cadera, rodilla y tobillo) que forma la A. */
export const LogoMark: React.FC<{ size: number; draw?: number; glow?: boolean }> = ({ size, draw = 1, glow = true }) => {
  const len = 260;
  const line = {
    stroke: C.tape,
    strokeWidth: 9,
    strokeLinecap: 'round' as const,
    fill: 'none',
    strokeDasharray: len,
    strokeDashoffset: len * (1 - draw),
    filter: glow ? 'drop-shadow(0 0 10px var(--tape))' : undefined,
  };
  const node = (cx: number, cy: number, d: number) => (
    <circle
      cx={cx}
      cy={cy}
      r={13 * Math.min(1, Math.max(0, (draw - d) * 4))}
      style={{ fill: C.bg, stroke: C.safe, strokeWidth: 6, filter: glow ? 'drop-shadow(0 0 8px var(--safe))' : undefined }}
    />
  );
  return (
    <svg width={size} height={size} viewBox="0 0 200 200">
      <circle cx={100} cy={100} r={92} style={{ fill: 'none', stroke: C.borderBright, strokeWidth: 3 }} />
      <path d="M100 38 L52 160" style={line} />
      <path d="M100 38 L148 160" style={line} />
      <path d="M72 110 L128 110" style={{ ...line, strokeWidth: 6, stroke: C.ink2 }} />
      {node(100, 38, 0)}
      {node(76, 99, 0.3)}
      {node(52, 160, 0.5)}
      {node(148, 160, 0.6)}
    </svg>
  );
};

export const Wordmark: React.FC<{ size: number; spacing?: number; style?: React.CSSProperties }> = ({
  size,
  spacing = 0.18,
  style,
}) => (
  <div
    style={{
      fontFamily: C.display,
      fontWeight: 700,
      fontSize: size,
      letterSpacing: `${spacing}em`,
      color: C.ink,
      textShadow: '0 0 30px var(--tape-soft)',
      ...style,
    }}
  >
    AXON<span style={{ color: C.tape }}>FAS</span>
  </div>
);
