// AXONFAS · figura de sentarse y pararse generada con código: esqueleto 3D con ángulos anatómicos, proyectado con una
// cámara en tres cuartos (como guide-figure.js). Dibuja los 8 puntos clave del motor (hombros, caderas, rodillas y
// tobillos) más cabeza, codos y muñecas, y la guía de corrección del gemelo digital (twin.js) durante una alerta.
import React from 'react';
import { C } from './ui';

type V3 = { x: number; y: number; z: number };
export type Pose = Record<string, V3>;

const L = { shank: 0.43, thigh: 0.45, trunk: 0.52, neck: 0.1, head: 0.11, upper: 0.29, fore: 0.26 };
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * t: 0 sentado → 1 de pie. lean: flexión de tronco extra (compensación). valgus: desplazamiento medial de la rodilla
 * derecha (0 a 1).
 */
export function sitToStand(t: number, lean = 0, valgus = 0): Pose {
  const knee = 90 * (1 - t); // flexión de rodilla
  const shankTilt = 14 * Math.sin(Math.PI * t); // la tibia va hacia adelante al despegar
  const back = knee - shankTilt; // muslo respecto a la vertical (hacia atrás): tibia + muslo = flexión de rodilla
  const trunk = 12 * (1 - t) + 30 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + lean; // tronco hacia adelante
  const pose: Pose = {};
  for (const side of [-1, 1]) {
    const k = side === 1 ? 'R' : 'L';
    const ax = 0.13 * side;
    const ankle = { x: ax, y: 0.08, z: 0 };
    const kneeP = {
      x: 0.12 * side - (side === 1 ? valgus * 0.07 : 0),
      y: ankle.y + L.shank * Math.cos(rad(shankTilt)),
      z: L.shank * Math.sin(rad(shankTilt)),
    };
    const hip = {
      x: 0.11 * side,
      y: kneeP.y + L.thigh * Math.cos(rad(back)),
      z: kneeP.z - L.thigh * Math.sin(rad(back)),
    };
    pose[`${k}ankle`] = ankle;
    pose[`${k}toe`] = { x: ax * 1.05, y: 0.02, z: 0.16 };
    pose[`${k}knee`] = kneeP;
    pose[`${k}hip`] = hip;
  }
  const mid = { x: 0, y: (pose.Lhip.y + pose.Rhip.y) / 2, z: (pose.Lhip.z + pose.Rhip.z) / 2 };
  const sh = { x: 0, y: mid.y + L.trunk * Math.cos(rad(trunk)), z: mid.z + L.trunk * Math.sin(rad(trunk)) };
  for (const side of [-1, 1]) {
    const k = side === 1 ? 'R' : 'L';
    const s = { x: 0.2 * side, y: sh.y, z: sh.z };
    // Brazos hacia adelante, como pide la prueba para equilibrarse.
    const reach = 35 + 30 * Math.sin(Math.PI * t);
    const elbow = {
      x: 0.21 * side,
      y: s.y - L.upper * Math.cos(rad(reach + trunk * 0.4)),
      z: s.z + L.upper * Math.sin(rad(reach + trunk * 0.4)),
    };
    pose[`${k}shoulder`] = s;
    pose[`${k}elbow`] = elbow;
    pose[`${k}wrist`] = { x: 0.17 * side, y: elbow.y - 0.05, z: elbow.z + L.fore };
  }
  const neck = { x: 0, y: sh.y + L.neck * Math.cos(rad(trunk * 0.7)), z: sh.z + L.neck * Math.sin(rad(trunk * 0.7)) };
  pose.head = { x: 0, y: neck.y + L.head, z: neck.z + 0.02 };
  pose.neck = neck;
  pose.shmid = sh;
  return pose;
}

/** Ciclo suave de repeticiones: 0 → 1 → 0 cada `period` fotogramas, con una pausa abajo. */
export function repPhase(frame: number, period: number) {
  const p = (frame % period) / period;
  const active = Math.min(1, Math.max(0, (p - 0.08) / 0.84));
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * active);
}

export function project(p: V3, yaw: number, scale: number, cx: number, floor: number) {
  const c = Math.cos(rad(yaw));
  const s = Math.sin(rad(yaw));
  const x = p.x * c + p.z * s;
  const depth = -p.x * s + p.z * c;
  return { x: cx + x * scale, y: floor - p.y * scale, depth };
}

const BONES: [string, string][] = [
  ['Lshoulder', 'Rshoulder'],
  ['Lhip', 'Rhip'],
  ['Lshoulder', 'Lhip'],
  ['Rshoulder', 'Rhip'],
  ['Lhip', 'Lknee'],
  ['Lknee', 'Lankle'],
  ['Rhip', 'Rknee'],
  ['Rknee', 'Rankle'],
  ['Lankle', 'Ltoe'],
  ['Rankle', 'Rtoe'],
  ['Lshoulder', 'Lelbow'],
  ['Lelbow', 'Lwrist'],
  ['Rshoulder', 'Relbow'],
  ['Relbow', 'Rwrist'],
  ['shmid', 'neck'],
];
const KEY = ['Lshoulder', 'Rshoulder', 'Lhip', 'Rhip', 'Lknee', 'Rknee', 'Lankle', 'Rankle'];
const VALGUS_BONES = new Set(['Rhip-Rknee', 'Rknee-Rankle']);
const TRUNK_BONES = new Set(['Lshoulder-Lhip', 'Rshoulder-Rhip', 'Lshoulder-Rshoulder']);

export type FigureProps = {
  pose: Pose;
  width: number;
  height: number;
  yaw?: number;
  scale?: number;
  alert?: 'valgus' | 'trunk' | null;
  guide?: number; // 0..1, aparición de la guía de corrección
  chair?: boolean;
  dim?: boolean; // sin color (escena del problema)
  landmarks?: boolean;
};

export const Figure: React.FC<FigureProps> = ({
  pose,
  width,
  height,
  yaw = 28,
  scale = 520,
  alert = null,
  guide = 0,
  chair = true,
  dim = false,
  landmarks = true,
}) => {
  const floor = height * 0.9;
  const cx = width * 0.5;
  const P = (k: string) => project(pose[k], yaw, scale, cx, floor);
  const bone = dim ? C.muted : C.tape;
  const joint = dim ? C.ink2 : C.safe;
  const alertBones = alert === 'valgus' ? VALGUS_BONES : alert === 'trunk' ? TRUNK_BONES : new Set<string>();
  const sorted = [...BONES].sort((a, b) => P(b[0]).depth + P(b[1]).depth - (P(a[0]).depth + P(a[1]).depth));
  const head = P('head');
  const seat = project({ x: 0, y: 0.5, z: -0.26 }, yaw, scale, cx, floor);
  const seatBack = project({ x: 0, y: 0.96, z: -0.5 }, yaw, scale, cx, floor);
  const legBack = project({ x: 0, y: 0.08, z: -0.5 }, yaw, scale, cx, floor);
  const legFront = project({ x: 0, y: 0.08, z: -0.05 }, yaw, scale, cx, floor);
  const hip = P('Rhip');
  const ankle = P('Rankle');
  const knee = P('Rknee');
  // Punto objetivo de la rodilla: sobre la línea cadera-tobillo (guía del gemelo digital).
  const tk = { x: hip.x + (ankle.x - hip.x) * 0.5, y: hip.y + (ankle.y - hip.y) * 0.5 };
  const sh = { x: (P('Lshoulder').x + P('Rshoulder').x) / 2, y: (P('Lshoulder').y + P('Rshoulder').y) / 2 };
  const mh = { x: (P('Lhip').x + P('Rhip').x) / 2, y: (P('Lhip').y + P('Rhip').y) / 2 };
  const trunkLen = Math.hypot(sh.x - mh.x, sh.y - mh.y);

  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      <defs>
        <marker id="axon-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" style={{ fill: C.safe }} />
        </marker>
      </defs>
      <line x1={width * 0.12} x2={width * 0.88} y1={floor} y2={floor} style={{ stroke: C.figFloor, strokeWidth: 2 }} />
      {chair && (
        <g style={{ stroke: C.figProp, strokeWidth: 10, strokeLinecap: 'round', fill: 'none', opacity: 0.9 }}>
          <path d={`M${legFront.x} ${legFront.y} L${seat.x + (legFront.x - legBack.x) * 0.5} ${seat.y} L${seat.x - (legFront.x - legBack.x) * 0.6} ${seat.y}`} />
          <path d={`M${legBack.x} ${legBack.y} L${seat.x - (legFront.x - legBack.x) * 0.6} ${seat.y} L${seatBack.x} ${seatBack.y}`} />
        </g>
      )}
      {sorted.map(([a, b]) => {
        const pa = P(a);
        const pb = P(b);
        const id = `${a}-${b}`;
        const isAlert = alertBones.has(id);
        const color = isAlert ? C.alert : bone;
        return (
          <line
            key={id}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            style={{
              stroke: color,
              strokeWidth: isAlert ? 10 : 7,
              strokeLinecap: 'round',
              filter: dim ? undefined : `drop-shadow(0 0 8px ${color})`,
            }}
          />
        );
      })}
      <circle cx={head.x} cy={head.y} r={0.085 * scale} style={{ fill: 'none', stroke: bone, strokeWidth: 6 }} />
      {landmarks &&
        Object.keys(pose)
          .filter((k) => k !== 'neck' && k !== 'head' && k !== 'shmid')
          .map((k) => {
            const p = P(k);
            const key = KEY.includes(k);
            return (
              <circle
                key={k}
                cx={p.x}
                cy={p.y}
                r={key ? 10 : 7}
                style={{ fill: C.bg, stroke: key ? joint : bone, strokeWidth: 4 }}
              />
            );
          })}
      {alert === 'valgus' && guide > 0 && (
        <g style={{ opacity: guide }}>
          <line
            x1={hip.x}
            y1={hip.y}
            x2={ankle.x}
            y2={ankle.y}
            style={{ stroke: C.safe, strokeWidth: 4, strokeDasharray: '12 10' }}
          />
          <line
            x1={knee.x}
            y1={knee.y}
            x2={knee.x + (tk.x - knee.x) * guide}
            y2={knee.y + (tk.y - knee.y) * guide}
            markerEnd="url(#axon-arrow)"
            style={{ stroke: C.safe, strokeWidth: 6 }}
          />
        </g>
      )}
      {alert === 'trunk' && guide > 0 && (
        <g style={{ opacity: guide }}>
          <line
            x1={mh.x}
            y1={mh.y}
            x2={mh.x}
            y2={mh.y - trunkLen}
            style={{ stroke: C.safe, strokeWidth: 4, strokeDasharray: '12 10' }}
          />
        </g>
      )}
    </svg>
  );
};
