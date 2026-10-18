// AXONFAS · mapa muscular simplificado, dibujado aquí (no reutiliza polígonos de terceros). Mismo estilo que el mapa del
// prototipo: tokens --muscle-* en reposo y --fig-active según la carga ESTIMADA (educativa, no es una medición; ADR-013).
import React from 'react';
import { C } from './ui';

export type Loads = Partial<Record<'quads' | 'glutes' | 'hams' | 'calves' | 'abs' | 'lowback' | 'chest' | 'delts', number>>;

const muscle = (load: number | undefined): React.CSSProperties =>
  load && load > 0.02
    ? {
        fill: 'var(--fig-active)',
        fillOpacity: `calc(var(--muscle-active-min) + var(--muscle-active-range) * ${load.toFixed(3)})` as unknown as number,
        stroke: 'var(--fig-active)',
        strokeOpacity: 0.9,
        strokeWidth: 1.5,
        filter: `drop-shadow(0 0 ${(6 + 8 * load).toFixed(1)}px var(--tape))`,
      }
    : {
        fill: C.muscle,
        fillOpacity: 'var(--muscle-fill)' as unknown as number,
        stroke: C.muscle,
        strokeOpacity: 'var(--muscle-edge)' as unknown as number,
        strokeWidth: 1.5,
      };

const neutral: React.CSSProperties = {
  fill: C.muscle,
  fillOpacity: 'var(--muscle-neutral-fill)' as unknown as number,
  stroke: C.muscle,
  strokeOpacity: 'var(--muscle-edge)' as unknown as number,
  strokeWidth: 1.5,
};

/** Una vista (frente o espalda) en un viewBox de 120 × 260. */
const View: React.FC<{ back?: boolean; loads: Loads }> = ({ back, loads }) => {
  const mirror = (d: string) => (
    <>
      <path d={d} />
      <path d={d} transform="translate(120 0) scale(-1 1)" />
    </>
  );
  return (
    <svg viewBox="0 0 120 260" width="100%" height="100%">
      <g style={neutral}>
        <circle cx={60} cy={20} r={14} />
        {mirror('M30 228 Q34 246 44 250 L50 250 Q50 238 46 228 Z')}
        {mirror('M14 130 Q12 142 16 148 L22 146 Q22 136 20 128 Z')}
      </g>
      {back ? (
        <>
          <g style={muscle(loads.delts)}>{mirror('M26 50 Q18 54 18 66 L30 68 Q32 56 40 50 Z')}</g>
          <g style={muscle(loads.lowback)}>{mirror('M50 92 L58 92 L58 122 L48 122 Q46 108 50 92 Z')}</g>
          <g style={muscle(loads.lowback ? loads.lowback * 0.3 : 0)}>{mirror('M42 50 L58 46 L58 90 L40 88 Q36 70 42 50 Z')}</g>
          <g style={muscle(loads.glutes)}>{mirror('M36 124 Q34 146 42 154 Q54 156 58 148 L58 124 Z')}</g>
          <g style={muscle(loads.hams)}>{mirror('M38 158 Q36 186 42 204 L54 204 Q58 184 56 158 Z')}</g>
          <g style={muscle(loads.calves)}>{mirror('M38 210 Q34 222 40 230 L52 230 Q56 220 52 210 Z')}</g>
        </>
      ) : (
        <>
          <g style={muscle(loads.delts)}>{mirror('M26 50 Q18 54 18 66 L30 68 Q32 56 40 50 Z')}</g>
          <g style={muscle(loads.chest)}>{mirror('M40 50 L58 48 L58 72 Q44 76 36 68 Z')}</g>
          <g style={muscle(loads.abs)}>{mirror('M46 78 L58 78 L58 122 L48 122 Q44 100 46 78 Z')}</g>
          <g style={muscle(loads.quads)}>{mirror('M36 128 Q32 160 40 202 L54 202 Q58 166 56 128 Z')}</g>
          <g style={neutral}>{mirror('M40 204 Q40 212 46 214 Q54 212 54 204 Z')}</g>
          <g style={muscle(loads.calves ? loads.calves * 0.6 : 0)}>{mirror('M40 216 Q38 224 42 228 L50 228 Q54 222 52 216 Z')}</g>
        </>
      )}
      <g style={{ fill: 'none', stroke: C.muted, strokeOpacity: 0.35, strokeWidth: 1.2 }}>
        <path d="M46 34 L30 46 L16 70 L12 128 M74 34 L90 46 L104 70 L108 128 M34 46 L38 124 L34 210 L32 248 M86 46 L82 124 L86 210 L88 248" />
      </g>
    </svg>
  );
};

export const BodyMap: React.FC<{ loads: Loads; width: number; height: number }> = ({ loads, width, height }) => (
  <div style={{ display: 'flex', gap: 24, width, height }}>
    {(['Front', 'Back'] as const).map((label) => (
      <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, width: '100%' }}>
          <View back={label === 'Back'} loads={loads} />
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 18, color: C.muted, letterSpacing: 2, textTransform: 'uppercase' }}>{label}</div>
      </div>
    ))}
  </div>
);

/** Carga estimada de sentarse y pararse según la fase del movimiento (0 sentado → 1 de pie). */
export function sitToStandLoads(t: number, lean = 0): Loads {
  const effort = Math.sin(Math.PI * Math.min(1, t * 1.1));
  return {
    quads: effort,
    glutes: 0.9 * effort,
    hams: 0.45 * effort,
    calves: 0.3 * effort,
    abs: 0.25 * effort,
    lowback: Math.min(1, 0.35 * effort + lean / 40),
  };
}
