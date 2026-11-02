import type { InputVideoTrack, VideoSampleSink } from 'mediabunny';
import type { getTimelineClipSource, TimelineClip } from './timeline-document';
import { compositeTransitionFrame } from './transition-canvas';
import { findOutgoingClip, transitionProgress } from './transitions';

export type BaseVisualRecord = {
  clip: TimelineClip;
  source: ReturnType<typeof getTimelineClipSource>;
  videoTrack: InputVideoTrack | null;
  imageBitmap: ImageBitmap | null;
};

export function drawImageWithContain(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  width: number,
  height: number
) {
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

/**
 * Paints the base visual track for one export frame, including entry transitions
 * over the previous clip's held last frame. Records are sorted by start time.
 */
export function createBaseVisualPainter({
  records,
  sinks,
  width,
  height,
}: {
  records: readonly BaseVisualRecord[];
  sinks: ReadonlyMap<string, VideoSampleSink>;
  width: number;
  height: number;
}) {
  let layers: { outgoing: HTMLCanvasElement; incoming: HTMLCanvasElement; scratch: HTMLCanvasElement } | null = null;
  const surface = () => {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  const draw = async (context: CanvasRenderingContext2D, record: BaseVisualRecord, sourceTime: number) => {
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    if (record.imageBitmap) {
      drawImageWithContain(context, record.imageBitmap, record.imageBitmap.width, record.imageBitmap.height, width, height);
      return;
    }
    const sample = await sinks.get(record.clip.id)?.getSample(sourceTime);
    if (!sample) return;
    sample.drawWithFit(context, { fit: 'contain' });
    sample.close();
  };
  const heldTime = (record: BaseVisualRecord) => record.source.outPoint - 0.000_001;
  return async (context: CanvasRenderingContext2D, timelineTime: number) => {
    const active = [...records]
      .reverse()
      .find((record) => timelineTime >= record.clip.startTime && timelineTime < record.clip.startTime + record.clip.duration);
    if (!active) return;
    const sourceTime = Math.min(heldTime(active), active.source.inPoint + (timelineTime - active.clip.startTime));
    const progress = transitionProgress(active.clip, timelineTime);
    if (progress === null || !active.clip.transition) {
      await draw(context, active, sourceTime);
      return;
    }
    layers ??= { outgoing: surface(), incoming: surface(), scratch: surface() };
    const outgoingContext = layers.outgoing.getContext('2d')!;
    const previous = findOutgoingClip(records, active.clip);
    if (previous) await draw(outgoingContext, previous, heldTime(previous));
    else {
      outgoingContext.fillStyle = '#000';
      outgoingContext.fillRect(0, 0, width, height);
    }
    await draw(layers.incoming.getContext('2d')!, active, sourceTime);
    compositeTransitionFrame(context, active.clip.transition.kind, progress, layers.outgoing, layers.incoming, width, height, layers.scratch);
  };
}
