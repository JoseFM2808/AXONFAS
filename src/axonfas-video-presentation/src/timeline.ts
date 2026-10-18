// AXONFAS · línea de tiempo: las 4 fases del guion y cuánto dura cada una según su voz en off.
// Cada fase dura lo que su audio (más entrada y salida), nunca menos que su duración base del guion. Si todavía no hay
// voz generada (`py video.py voice`), se estima con 2.6 palabras por segundo y el video sale sin audio.
import script from '../script/voiceover.json';

export type PhaseId = 'problem' | 'capture' | 'brain' | 'impact';

export type Clip = {
  text: string;
  file: string | null; // ruta dentro de public/ o null si no hay audio
  from: number; // fotograma dentro de la fase
  frames: number;
};

export type Phase = {
  id: PhaseId;
  title: string;
  from: number; // fotograma dentro del video
  frames: number;
  clips: Clip[];
};

export type Timeline = { fps: number; frames: number; phases: Phase[]; voice: string | null };

export type Manifest = {
  backend: string;
  voice: string;
  clips: { phase: string; index: number; file: string; seconds: number }[];
};

const WORDS_PER_SECOND = 2.6;

export const VIDEO = { fps: script.fps, width: script.width, height: script.height };

export function buildTimeline(manifest: Manifest | null): Timeline {
  const fps = script.fps;
  const sec = (s: number) => Math.round(s * fps);
  let cursor = 0;
  const phases: Phase[] = script.phases.map((p) => {
    const lines = p.lines.map((line, i) => {
      const m = manifest?.clips.find((c) => c.phase === p.id && c.index === i);
      const seconds = m ? m.seconds : line.text.split(/\s+/).length / WORDS_PER_SECOND;
      return { text: line.text, file: m ? m.file : null, seconds };
    });
    const voiced =
      lines.reduce((sum, l) => sum + l.seconds, 0) + script.gapSeconds * (lines.length - 1);
    const needed = script.leadInSeconds + voiced + script.tailSeconds;
    const base = p.baseEnd - p.baseStart;
    const total = Math.max(base, needed);
    // El tiempo que sobra se reparte antes, entre y después de las frases (la entrada, como mucho 2 s más).
    const slot = (total - needed) / (lines.length + 1);
    let t = script.leadInSeconds + Math.min(slot, 2);
    const clips = lines.map((l) => {
      const clip = { text: l.text, file: l.file, from: sec(t), frames: sec(l.seconds) };
      t += l.seconds + script.gapSeconds + slot;
      return clip;
    });
    const phase: Phase = { id: p.id as PhaseId, title: p.title, from: cursor, frames: sec(total), clips };
    cursor += phase.frames;
    return phase;
  });
  return { fps, frames: cursor, phases, voice: manifest ? `${manifest.backend} · ${manifest.voice}` : null };
}
