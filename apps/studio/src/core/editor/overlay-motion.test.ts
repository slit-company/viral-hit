import { mergeTimelineDocuments } from './timeline-merge';
import assert from 'node:assert/strict';
import test from 'node:test';
import { overlayMotionSchema, overlayTransformAt, withOverlayKeyframe, canEditOverlayPose } from './overlay-motion';
import { createTimelineDocument, addOverlayClip, findTimelineClip, normalizeTimelineDocument, splitTimelineClip, trimTimelineClip, resizeTimelineClip, moveTimelineClip, overlayOpacityAt } from './timeline-document';
import { applyEditorOperations } from '../commands/editor-commands';
import { buildTimelineEditCommand } from './timeline-command';
import { setOverlayMotionSchema, updateOverlaySchema } from '../commands/overlay-schema';
import { sequenceSchema, appendSequence } from './sequence';

const fixture = () => {
  const source = addOverlayClip(createTimelineDocument({ projectId: 'motion', name: 'Motion' }), {
    clipId: 'overlay', assetId: 'image', sourceUrl: '/image.png', name: 'Image', startTime: 2, duration: 4,
  });
  const motion = overlayMotionSchema.parse({ version: 1, keyframes: [
    { id: 'a', time: 0, x: .2, y: .3, width: .2, opacity: .2, rotation: -90, easing: 'ease-in' },
    { id: 'b', time: 4, x: .8, y: .7, width: .6, opacity: 1, rotation: 90, easing: 'linear' },
  ] });
  const document = applyEditorOperations(source, [{ type: 'set_overlay_motion', clipId: 'overlay', motion }]).document;
  return { source, document, clip: findTimelineClip(document, 'overlay')!, motion };
};

test('all five transforms interpolate with easing and hold endpoint poses', () => {
  const { clip } = fixture();
  assert.deepEqual(overlayTransformAt(clip, 4), { x: .35000000000000003, y: .39999999999999997, width: .3, opacity: .4, rotation: -45 });
  assert.equal(overlayTransformAt(clip, -10)!.x, .2);
  assert.equal(overlayTransformAt(clip, 99)!.x, .8);
  assert.equal(overlayOpacityAt({ ...clip, fadeIn: 4, fadeOut: 4 }, 4), .2);
  assert.equal(overlayOpacityAt(clip, 6), 0);
});

test('split, trim, move and resize preserve source-relative easing', () => {
  const { document, clip } = fixture();
  const split = splitTimelineClip(document, clip.id, 2, 'right');
  const right = findTimelineClip(split, 'right')!;
  for (const time of [4, 4.5, 5, 5.9]) assert.deepEqual(overlayTransformAt(right, time), overlayTransformAt(clip, time));
  const trimmed = findTimelineClip(trimTimelineClip(document, clip.id, 1, 3), clip.id)!;
  assert.deepEqual(overlayTransformAt(trimmed, 2.5), overlayTransformAt(clip, 3.5));
  const moved = findTimelineClip(moveTimelineClip(split, 'right', 10), 'right')!;
  assert.deepEqual(overlayTransformAt(moved, 10.5), overlayTransformAt(clip, 4.5));
  const extended = findTimelineClip(resizeTimelineClip(split, 'right', 6), 'right')!;
  assert.equal(extended.inPoint, 2); assert.equal(extended.outPoint, 8);
  assert.deepEqual(overlayTransformAt(extended, 9), overlayTransformAt(clip, 6));
});

test('motion changes invalidate exports and use incremental editor operations; clearing remains portable', () => {
  const { source, document, clip } = fixture();
  const rendered = { ...document, lastRenderAssetId: 'render', lastRenderUrl: '/render.mp4' };
  assert.throws(() => applyEditorOperations(rendered, [{ type: 'update_overlay', clipId: clip.id, patch: { x: .5 } }]), /atTime/);
  const next = applyEditorOperations(rendered, [{ type: 'update_overlay', clipId: clip.id, atTime: 4, patch: { x: .6 } }]).document;
  assert.equal(next.lastRenderAssetId, null);
  const changed = findTimelineClip(next, clip.id)!;
  assert.equal(changed.motion!.keyframes.length, 3);
  assert.equal(overlayTransformAt(changed, 4)!.x, .6);
  assert.equal(buildTimelineEditCommand(rendered, next).type, 'editor.apply');
  assert.equal(buildTimelineEditCommand(source, document).type, 'editor.apply');
  const cleared = applyEditorOperations(document, [{ type: 'set_overlay_motion', clipId: clip.id, motion: null }]).document;
  assert.equal(findTimelineClip(cleared, clip.id)!.motion, undefined);
  assert.equal(buildTimelineEditCommand(document, cleared).type, 'editor.apply');
});

test('strict transport and timeline reject malformed, excessive, and misplaced motion', () => {
  const { clip, motion, document } = fixture();
  assert.throws(() => overlayMotionSchema.parse({ ...motion, expression: 'eval(code)' }));
  assert.throws(() => overlayMotionSchema.parse({ ...motion, keyframes: [...motion.keyframes].reverse() }));
  assert.throws(() => overlayMotionSchema.parse({ ...motion, keyframes: [motion.keyframes[0], { ...motion.keyframes[1], id: 'a' }] }));
  assert.throws(() => overlayMotionSchema.parse({ ...motion, keyframes: Array.from({ length: 33 }, (_, i) => ({ ...motion.keyframes[0], id: `${i}`, time: i })) }));
  assert.throws(() => updateOverlaySchema.parse({ type: 'update_overlay', clipId: clip.id, atTime: Infinity, patch: { x: 0 } }));
  assert.ok(setOverlayMotionSchema.safeParse({ type: 'set_overlay_motion', clipId: clip.id, motion }).success);
  assert.throws(() => normalizeTimelineDocument({ ...document, tracks: document.tracks.map(track => ({ ...track, kind: track.kind === 'overlay' ? 'video' : track.kind })) }));
  const inserted = withOverlayKeyframe(clip, 4);
  assert.equal(withOverlayKeyframe({ ...clip, motion: inserted }, 4).keyframes[1].id, inserted.keyframes[1].id);
});

test('version 5 migration preserves overlays and captions without inventing animation', () => {
  const { source } = fixture();
  const captioned = applyEditorOperations(source, [{ type: 'upsert_caption', clipId: 'caption', text: 'Keep me', startTime: 0, duration: 2 }, { type: 'update_caption', clipId: 'caption', patch: { fontScale: .05 } }]).document;
  const migrated = normalizeTimelineDocument({ ...captioned, schemaVersion: 5 });
  assert.equal(migrated.schemaVersion, 6);
  assert.deepEqual(findTimelineClip(migrated, 'overlay')!.overlay, findTimelineClip(captioned, 'overlay')!.overlay);
  assert.deepEqual(findTimelineClip(migrated, 'caption')!.caption, findTimelineClip(captioned, 'caption')!.caption);
  assert.equal(findTimelineClip(migrated, 'overlay')!.motion, undefined);
});

test('portable sequences carry animation only on image overlay tracks', () => {
  const { motion } = fixture();
  const raw = { schemaVersion: 1, title: 'Animated mark', assets: { image: { assetId: 'image', kind: 'image' } }, tracks: [{ id: 'overlay', kind: 'overlay', name: 'Mark', clips: [{ id: 'mark', type: 'media', source: 'image', startTime: 0, duration: 4, motion }] }] };
  const sequence = sequenceSchema.parse(raw);
  const document = appendSequence(createTimelineDocument({ projectId: 'motion', name: 'Story' }), sequence, { image: { assetId: 'image', kind: 'image', publicUrl: '/image.png', name: 'Mark', duration: null } }, 'run');
  assert.deepEqual(findTimelineClip(document, 'run-mark')!.motion, motion);
  assert.equal(sequenceSchema.safeParse({ ...raw, tracks: [{ ...raw.tracks[0], kind: 'video' }] }).success, false);
});

test('independent keyframe inserts merge chronologically; concurrent same-time inserts need review', () => {
  const { document, clip } = fixture();
  const change = (time: number, x: number) => applyEditorOperations(document, [{ type: 'update_overlay', clipId: clip.id, atTime: time, patch: { x } }]).document;
  const merged = mergeTimelineDocuments({ base: document, local: change(3, .4), remote: change(5, .6) });
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(findTimelineClip(merged.document, clip.id)!.motion!.keyframes.map(frame => frame.time), [0, 1, 3, 4]);
  const conflict = mergeTimelineDocuments({ base: document, local: change(3, .4), remote: change(3, .6) });
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(findTimelineClip(conflict.document, clip.id)!.motion!.keyframes[1].x, .4);
});

test('full keyframe lists allow existing-pose edits and locked overlays reject changes', () => {
  const { document, clip, motion } = fixture();
  const full = { ...clip, motion: { version: 1 as const, keyframes: Array.from({ length: 32 }, (_, i) => ({ ...motion.keyframes[0], id: `${i}`, time: i / 10 })) } };
  assert.equal(canEditOverlayPose(full, 2.1), true);
  assert.equal(canEditOverlayPose(full, 2.15), false);
  const locked = { ...document, tracks: document.tracks.map(track => ({ ...track, locked: true })) };
  assert.throws(() => applyEditorOperations(locked, [{ type: 'set_overlay_motion', clipId: clip.id, motion: null }]), /could not be applied/);
  assert.throws(() => applyEditorOperations(locked, [{ type: 'update_overlay', clipId: clip.id, atTime: 3, patch: { x: .5 } }]), /could not be applied/);
});
