import type { CSSProperties } from 'react';
import { getTimelineClipSource, type TimelineClip, type TimelineDocument } from '@/core/editor/timeline-document';
import { radialMaskStops, transitionFrame, type TransitionLayer } from '@/core/editor/transition-contract';
import { listTimelineTransitions } from '@/core/editor/transitions';

/** Mount the held frame early so it is decoded before the cut arrives. */
const PRELOAD_SECONDS = 1.5;

export function transitionLayerStyle(layer: TransitionLayer, additive: boolean): CSSProperties {
  const style: CSSProperties = { opacity: layer.weight };
  if (layer.dx || layer.dy || layer.scale !== 1) {
    style.transform = `translate(${layer.dx * 100}%, ${layer.dy * 100}%) scale(${layer.scale})`;
  }
  if (layer.mask.kind === 'rect') {
    const { top, right, bottom, left } = layer.mask;
    style.clipPath = `inset(${top * 100}% ${right * 100}% ${bottom * 100}% ${left * 100}%)`;
  } else if (layer.mask.kind === 'radial') {
    const stops = radialMaskStops(layer.mask.offset).map((stop) => `rgba(0,0,0,${stop.alpha.toFixed(3)}) ${(stop.radius * 100).toFixed(1)}%`);
    style.maskImage = style.WebkitMaskImage = `radial-gradient(circle farthest-corner at 50% 50%, ${stops.join(', ')})`;
  }
  if (additive) style.mixBlendMode = 'plus-lighter';
  return style;
}

function HeldFrame({ clip, style }: { clip: TimelineClip; style: CSSProperties }) {
  const source = getTimelineClipSource(clip);
  const className = 'pointer-events-none absolute inset-0 size-full object-contain';
  if (clip.sourceType === 'image') return <img src={source.sourceUrl} alt="" aria-hidden="true" className={className} style={style} />;
  const held = Math.max(source.inPoint, source.outPoint - 0.001);
  return <video key={`${source.sourceUrl}#${held}`} src={source.sourceUrl} muted playsInline preload="auto" aria-hidden="true"
    className={className} style={style} onLoadedMetadata={(event) => { event.currentTarget.currentTime = held; }} />;
}

/** Preview layers for a base-track transition at `time`; the playing clip is the incoming layer. */
export function transitionPreview(document: TimelineDocument, activeClipId: string | undefined, time: number) {
  const span = listTimelineTransitions(document)
    .find((candidate) => time >= candidate.start - PRELOAD_SECONDS && time < candidate.start + candidate.duration);
  if (!span) return { incomingStyle: undefined, outgoing: null, veil: null };
  const playing = time >= span.start && span.incoming.id === activeClipId;
  const frame = transitionFrame(span.kind, (time - span.start) / span.duration);
  const additive = frame.blend === 'add';
  return {
    incomingStyle: playing ? ({ position: 'relative', zIndex: 1, ...transitionLayerStyle(frame.incoming, additive) } satisfies CSSProperties) : undefined,
    outgoing: span.outgoing
      ? <HeldFrame clip={span.outgoing} style={playing ? transitionLayerStyle(frame.outgoing, additive) : { opacity: 0 }} />
      : null,
    veil: playing && frame.white > 0
      ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] bg-white" style={{ opacity: Math.min(1, frame.white), mixBlendMode: 'plus-lighter' }} />
      : null,
  };
}
