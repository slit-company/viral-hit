import { XFADE_TRANSITION_NAMES } from './transition-contract';
import { listTimelineTransitions } from './transitions';
import type { TimelineDocument } from './timeline-document';

export type TransitionRenderSource = {
  filePath: string;
  sourceType: 'image' | 'video';
  /** Effective source range, including an active take. */
  inPoint: number;
  outPoint: number;
};

const time = (value: number) => Math.max(0, value).toFixed(3);

/**
 * Each transition renders as a short xfade segment laid over the base composition
 * during its window. The outgoing side holds its last visible frame (black after a
 * gap) and mixing happens in planar RGB, matching the browser compositor.
 */
export function buildTransitionFilters({
  document,
  sources,
  firstInputIndex,
  width,
  height,
  visualLabel,
  frameRate = 30,
}: {
  document: TimelineDocument;
  sources: ReadonlyMap<string, TransitionRenderSource>;
  firstInputIndex: number;
  width: number;
  height: number;
  visualLabel: string;
  frameRate?: number;
}) {
  const inputArgs: string[] = [];
  const filters: string[] = [];
  const fit =
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${frameRate},format=gbrp`;
  let label = visualLabel;
  let inputIndex = firstInputIndex;
  let count = 0;
  for (const span of listTimelineTransitions(document)) {
    const incoming = sources.get(span.incoming.id);
    if (!incoming) continue;
    const outgoing = span.outgoing ? (sources.get(span.outgoing.id) ?? null) : null;
    const seconds = time(span.duration);
    count += 1;
    const outgoingIndex = inputIndex++;
    if (!outgoing) {
      inputArgs.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${frameRate}:d=${seconds}`);
      filters.push(`[${outgoingIndex}:v]format=gbrp,setsar=1,settb=AVTB[tfrom${count}]`);
    } else if (outgoing.sourceType === 'image') {
      inputArgs.push('-loop', '1', '-framerate', String(frameRate), '-t', seconds, '-i', outgoing.filePath);
      filters.push(`[${outgoingIndex}:v]${fit},trim=duration=${seconds},setpts=PTS-STARTPTS,settb=AVTB[tfrom${count}]`);
    } else {
      const seek = Math.max(0, outgoing.outPoint - 0.5);
      const lead = time(outgoing.outPoint - seek);
      inputArgs.push('-ss', time(seek), '-t', time(outgoing.outPoint - seek + 0.25), '-i', outgoing.filePath);
      filters.push(
        `[${outgoingIndex}:v]trim=end=${lead},setpts=PTS-STARTPTS,${fit},` +
          `tpad=stop_mode=clone:stop_duration=${seconds},trim=start=${lead},setpts=PTS-STARTPTS,` +
          `trim=duration=${seconds},settb=AVTB[tfrom${count}]`
      );
    }
    const incomingIndex = inputIndex++;
    if (incoming.sourceType === 'image') {
      inputArgs.push('-loop', '1', '-framerate', String(frameRate), '-t', seconds, '-i', incoming.filePath);
      filters.push(`[${incomingIndex}:v]${fit},trim=duration=${seconds},setpts=PTS-STARTPTS,settb=AVTB[tto${count}]`);
    } else {
      inputArgs.push('-ss', time(incoming.inPoint), '-t', time(span.duration + 0.25), '-i', incoming.filePath);
      filters.push(
        `[${incomingIndex}:v]trim=duration=${seconds},setpts=PTS-STARTPTS,${fit},` +
          `tpad=stop_mode=clone:stop_duration=${seconds},trim=duration=${seconds},settb=AVTB[tto${count}]`
      );
    }
    filters.push(
      `[tfrom${count}][tto${count}]xfade=transition=${XFADE_TRANSITION_NAMES[span.kind]}:duration=${seconds}:offset=0,` +
        `format=yuv420p,setpts=PTS-STARTPTS+${time(span.start)}/TB[tmix${count}]`
    );
    const next = `withtransition${count}`;
    filters.push(
      `[${label}][tmix${count}]overlay=0:0:eof_action=pass:` +
        `enable='between(t,${time(span.start)},${time(span.start + span.duration)})'[${next}]`
    );
    label = next;
  }
  return { inputArgs, filters, output: label, count };
}
