// AXONFAS · composición única del video. La duración sale de la voz en off (public/voiceover/manifest.json, que genera
// `py video.py voice`); sin ese archivo se usa la duración base del guion y el video sale sin audio.
import React from 'react';
import { CalculateMetadataFunction, Composition, staticFile } from 'remotion';
import './design-system/tokens.css';
import { AxonfasVideo, type VideoProps } from './Video';
import { VIDEO, buildTimeline, type Manifest } from './timeline';

const calculateMetadata: CalculateMetadataFunction<VideoProps> = async () => {
  let manifest: Manifest | null = null;
  try {
    const res = await fetch(staticFile('voiceover/manifest.json'));
    if (res.ok) manifest = (await res.json()) as Manifest;
  } catch {
    manifest = null;
  }
  const timeline = buildTimeline(manifest);
  return { durationInFrames: timeline.frames, props: { timeline } };
};

export const Root: React.FC = () => (
  <Composition
    id="AXONFAS"
    component={AxonfasVideo}
    width={VIDEO.width}
    height={VIDEO.height}
    fps={VIDEO.fps}
    durationInFrames={buildTimeline(null).frames}
    defaultProps={{ timeline: buildTimeline(null) }}
    calculateMetadata={calculateMetadata}
  />
);
