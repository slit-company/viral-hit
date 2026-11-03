import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineDocument, splitTimelineClip, trimTimelineClip, type TimelineDocument } from './timeline-document';
import { applyEditorOperations } from '../commands/editor-commands';
import { setTimelineClipSpeed, sourceTimeAt, timelineTimeAt } from './clip-speed';
import { rampOperations } from '../remix/rebuild';

function base(): TimelineDocument {
  let document = createTimelineDocument({ projectId: 'speed', name: 'Speed' });
  document = applyEditorOperations(document, [
    { type: 'add_clip', clipId: 'a', assetId: 'video-a', sourceUrl: '/a.mp4', name: 'A', sourceType: 'video', sourceDuration: 4, startTime: 0 },
    { type: 'add_clip', clipId: 'b', assetId: 'video-b', sourceUrl: '/b.mp4', name: 'B', sourceType: 'video', sourceDuration: 3, startTime: 4 },
  ]).document;
  return document;
}
const clip = (document: TimelineDocument, id: string) => document.tracks.flatMap(track => track.clips).find(item => item.id === id)!;

test('speed changes a clip length from its source range and moves the clips after it', () => {
  const fast = setTimelineClipSpeed(base(), 'a', 2);
  assert.deepEqual([clip(fast, 'a').duration, clip(fast, 'a').speed, clip(fast, 'b').startTime, fast.duration], [2, 2, 2, 5]);
  const slow = setTimelineClipSpeed(fast, 'a', 0.5);
  assert.deepEqual([clip(slow, 'a').duration, clip(slow, 'b').startTime, slow.duration], [8, 8, 11]);
  const normal = setTimelineClipSpeed(slow, 'a', 1);
  assert.equal('speed' in clip(normal, 'a'), false);
  assert.equal(clip(normal, 'b').startTime, 4);
  assert.throws(() => setTimelineClipSpeed(base(), 'a', 5), /0.25× to 4×/);
});

test('trims and splits of a sped clip keep timeline and source time in step', () => {
  const fast = setTimelineClipSpeed(base(), 'a', 2);
  assert.equal(clip(trimTimelineClip(fast, 'a', 1, 3), 'a').duration, 1);
  const split = splitTimelineClip(fast, 'a', 2, 'a2');
  assert.deepEqual([clip(split, 'a').duration, clip(split, 'a2').startTime, clip(split, 'a2').duration, clip(split, 'a2').speed], [1, 1, 1, 2]);
  const sped = clip(fast, 'a');
  assert.equal(sourceTimeAt(sped, sped.inPoint, 1.5), 3);
  assert.equal(timelineTimeAt(sped, sped.inPoint, 3), 1.5);
});

test('a reference speed-up becomes a 2× second half, a slow-down a 0.5× second half', () => {
  assert.deepEqual(rampOperations('s', 'up', 4, 10), [
    { type: 'trim_clip', clipId: 's', inPoint: 0, outPoint: 6 }, { type: 'split_clip', clipId: 's', sourceTime: 2, rightClipId: 's-ramp' }, { type: 'set_clip_speed', clipId: 's-ramp', speed: 2 },
  ]);
  assert.equal(rampOperations('s', 'up', 4, 5)?.at(-1)?.type === 'set_clip_speed' && (rampOperations('s', 'up', 4, 5)!.at(-1) as { speed: number }).speed, 1.5);
  assert.equal(rampOperations('s', 'up', 4, 4.2), null);
  assert.equal(rampOperations('s', null, 4, 10), null);
  let document = createTimelineDocument({ projectId: 'ramp', name: 'Ramp' });
  document = applyEditorOperations(document, [{ type: 'add_clip', clipId: 's', assetId: 'v', sourceUrl: '/v.mp4', name: 'V', sourceType: 'video', sourceDuration: 10, startTime: 0 }, ...rampOperations('s', 'down', 4, 10)!]).document;
  assert.deepEqual([clip(document, 's').duration, clip(document, 's-ramp').duration, clip(document, 's-ramp').speed, document.duration], [2, 2, 0.5, 4]);
});
