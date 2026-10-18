// AXONFAS · el video completo: las 4 fases en orden, con la voz en off de cada frase en su lugar de la línea de tiempo.
import React from 'react';
import { AbsoluteFill, Sequence, staticFile } from 'remotion';
import { Audio } from '@remotion/media';
import { Brain } from './scenes/Brain';
import { Capture } from './scenes/Capture';
import { Impact } from './scenes/Impact';
import { Problem } from './scenes/Problem';
import type { Phase, PhaseId, Timeline } from './timeline';
import { C } from './ui';

export type VideoProps = { timeline: Timeline };

const SCENES: Record<PhaseId, React.FC<{ phase: Phase }>> = {
  problem: Problem,
  capture: Capture,
  brain: Brain,
  impact: Impact,
};

export const AxonfasVideo: React.FC<VideoProps> = ({ timeline }) => (
  <AbsoluteFill style={{ background: C.bg, fontFamily: C.body }}>
    {timeline.phases.map((phase) => {
      const Scene = SCENES[phase.id];
      return (
        <Sequence key={phase.id} from={phase.from} durationInFrames={phase.frames} name={phase.title}>
          <Scene phase={phase} />
          {phase.clips.map((clip, i) =>
            clip.file ? (
              <Sequence key={i} from={clip.from} durationInFrames={clip.frames + 6} name={`voice ${phase.id}-${i}`}>
                <Audio src={staticFile(clip.file)} />
              </Sequence>
            ) : null,
          )}
        </Sequence>
      );
    })}
  </AbsoluteFill>
);
