import type { EditorOperation } from '../commands/editor-commands';
import type { TimelineTransition } from '../editor/transition-contract';
import { cameraKeyframes } from './camera-keyframes';
import type { RemixAssignment, RemixText } from './contract';

const round = (value: number) => Math.round(value * 1000) / 1000;
const MOVES: ReadonlySet<string> = new Set(['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down']);

/**
 * The editor shows one caption at a time, so text that is on screen together becomes one caption (top to
 * bottom) and changes whenever any of it appears or disappears.
 */
export function captionIntervals(texts: readonly RemixText[]): RemixText[] {
  const times = [...new Set(texts.flatMap(item => [item.start, item.end]))].sort((a, b) => a - b), result: RemixText[] = [];
  for (let index = 0; index + 1 < times.length; index++) {
    const start = times[index], end = times[index + 1];
    const active = texts.filter(item => item.start < end - 1e-6 && item.end > start + 1e-6).sort((a, b) => a.box.y - b.box.y);
    if (!active.length || end - start < 0.1) continue;
    const text = active.map(item => item.text).join('\n'), previous = result.at(-1);
    if (previous && previous.text === text && Math.abs(previous.end - start) < 1e-6) { previous.end = end; continue; }
    const left = Math.min(...active.map(item => item.box.x)), top = Math.min(...active.map(item => item.box.y));
    const box = { x: left, y: top, width: Math.max(...active.map(item => item.box.x + item.box.width)) - left, height: Math.max(...active.map(item => item.box.y + item.box.height)) - top };
    result.push({ start, end, text, box, lines: active.reduce((sum, item) => sum + item.lines, 0) });
  }
  return result;
}

/**
 * A shot that speeds up (or slows down) in the reference plays its second half at 2× (or 0.5×) on video material:
 * trim to the source it needs, split at the shot's middle and speed up the second part. Material too short for 2×
 * gets the fastest rate it can fill, and below 1.25× the ramp is left out.
 */
export function rampOperations(clipId: string, ramp: 'up' | 'down' | null, length: number, available: number): EditorOperation[] | null {
  if (!ramp || length < 0.5) return null;
  const half = round(length / 2), rate = ramp === 'down' ? 0.5 : Math.min(2, round((available - half) / half));
  if (ramp === 'up' && rate < 1.25) return null;
  const end = round(half + half * rate);
  return [{ type: 'trim_clip', clipId, inPoint: 0, outPoint: end }, { type: 'split_clip', clipId, sourceTime: half, rightClipId: clipId + '-ramp' }, { type: 'set_clip_speed', clipId: clipId + '-ramp', speed: rate }];
}

type Camera = { frameAspect: number; imageAspects: ReadonlyMap<string, number> };
/**
 * Editor operations that place each shot at the reference's cut time after `offset`, plus the soundtrack.
 * With camera, a still in a moving shot also gets a covering overlay with that move; with texts, the
 * reference's on-screen text becomes editable captions at the same times and heights.
 */
export function remixOperations({ assignments, offset, idPrefix, transition, soundtrack, camera = null, texts = [], speed = false }: {
  assignments: readonly RemixAssignment[]; offset: number; idPrefix: string; transition: TimelineTransition | null;
  soundtrack: { assetId: string; duration: number } | null; camera?: Camera | null; texts?: readonly RemixText[]; speed?: boolean;
}): EditorOperation[] {
  const operations: EditorOperation[] = [];
  assignments.forEach(({ shot, material, length }, index) => {
    const clipId = `${idPrefix}-shot-${index + 1}`;
    const startTime = round(offset + shot.start);
    if (material.kind === 'image') {
      operations.push({ type: 'add_clip', clipId, assetId: material.assetId, sourceUrl: '', name: material.name, sourceType: 'image', sourceDuration: length, startTime });
      const aspect = camera?.imageAspects.get(material.assetId), motion = camera && aspect && shot.camera && MOVES.has(shot.camera.kind) ? cameraKeyframes(shot.camera, length, aspect, camera.frameAspect) : null;
      if (motion) {
        const first = motion.keyframes[0];
        operations.push({ type: 'add_overlay', clipId: clipId + '-camera', assetId: material.assetId, sourceUrl: '', name: `${material.name} · ${shot.camera!.kind}`, startTime, duration: length, sourceType: 'image', x: first.x, y: first.y, width: first.width, opacity: 1, rotation: 0 });
        operations.push({ type: 'set_overlay_motion', clipId: clipId + '-camera', motion });
      }
    } else {
      operations.push({ type: 'add_clip', clipId, assetId: material.assetId, sourceUrl: '', name: material.name, sourceType: 'video', sourceDuration: material.duration!, startTime });
      const ramp = speed ? rampOperations(clipId, shot.speed?.ramp ?? null, length, material.duration!) : null;
      if (ramp) operations.push(...ramp);
      else if (length < material.duration! - 0.001) operations.push({ type: 'trim_clip', clipId, inPoint: 0, outPoint: length });
    }
    if (transition && index > 0) operations.push({ type: 'set_transition', clipId, transition });
  });
  captionIntervals(texts).slice(0, 60).forEach((item, index) => {
    const clipId = `${idPrefix}-text-${index + 1}`, duration = round(item.end - item.start);
    if (duration <= 0) return;
    operations.push({ type: 'upsert_caption', clipId, text: item.text, startTime: round(offset + item.start), duration });
    // Same height and width on screen; captions are positioned by their distance from the bottom.
    operations.push({ type: 'update_caption', clipId, patch: {
      bottomOffset: Math.min(0.9, Math.max(0.02, round(1 - item.box.y - item.box.height))),
      maxWidth: Math.min(0.98, Math.max(0.25, round(item.box.width * 1.15))),
      fontScale: Math.min(0.12, Math.max(0.015, round(item.box.height / Math.max(1, item.lines) / 1.25))),
    } });
  });
  if (soundtrack) operations.push({ type: 'add_clip', clipId: `${idPrefix}-soundtrack`, assetId: soundtrack.assetId, sourceUrl: '', name: 'Reference soundtrack', sourceType: 'audio', sourceDuration: soundtrack.duration, startTime: round(offset), audioRole: 'music' });
  return operations;
}
