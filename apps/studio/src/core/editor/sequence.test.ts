import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceSchema, appendSequence, inspectSequence, type SequenceMedia } from './sequence';
import { createTimelineDocument, addSourceClip } from './timeline-document';
import { findCaptionAtTime, updateCaptionTransform, upsertCaptionCue } from './captions';
const media: Record<string, SequenceMedia> = { picture: { assetId: 'image', kind: 'image', publicUrl: '/image', name: 'Picture', duration: null } };
const raw = () => ({ schemaVersion: 1, title: 'My sequence', assets: { picture: { assetId: 'image', kind: 'image' } }, tracks: [
  { id: 'visual', name: 'Visual', kind: 'video', clips: [{ id: 'shot', type: 'media', source: 'picture', startTime: 0, duration: 3 }] },
  { id: 'text', name: 'Text', kind: 'caption', clips: [{ id: 'headline', type: 'caption', text: 'EDIT ME', startTime: 0, duration: 3 }] },
] });
test('editable sequence appends separate tracks and preserves preceding edits and timing', () => {
  const base = addSourceClip(createTimelineDocument({ projectId: 'project', name: 'Existing' }), { assetId: 'existing', sourceUrl: '/existing', name: 'Existing', sourceType: 'image', sourceDuration: 2 });
  base.tracks[0].locked = true; base.tracks.find(track => track.kind === 'caption')!.locked = true;
  const before = structuredClone(base), sequence = sequenceSchema.parse(raw()), result = appendSequence(base, sequence, media, 'prepared');
  assert.deepEqual(base, before); assert.deepEqual(result.tracks.slice(0, base.tracks.length), base.tracks);
  assert.equal(result.duration, 5); assert.equal(result.tracks.flatMap(track => track.clips).find(clip => clip.id === 'prepared-shot')!.startTime, 2);
  assert.equal(findCaptionAtTime(result, 2.5)?.text, 'EDIT ME'); assert.equal(findCaptionAtTime(result, 1), null);
  const transformed = updateCaptionTransform(result, 'prepared-headline', { fontScale: 0.04 });
  const edited = upsertCaptionCue(transformed, { clipId: 'prepared-headline', text: 'CHANGED', startTime: 2, endTime: 5 });
  assert.equal(findCaptionAtTime(edited, 2.5)?.text, 'CHANGED'); assert.equal(findCaptionAtTime(edited, 2.5)?.caption?.fontScale, 0.04);
  assert.equal(edited.tracks.flatMap(track => track.clips).filter(clip => clip.id === 'prepared-headline').length, 1);
  assert.throws(() => appendSequence(result, sequence, media, 'prepared'), /already present/);
});
test('sequence contract rejects lossy or unsafe inputs rather than silently dropping them', () => {
  for (const value of [
    { ...raw(), script: 'execute' },
    { ...raw(), assets: { picture: { assetId: 'image', kind: 'image', path: '/host/file' } } },
    { ...raw(), tracks: [{ ...raw().tracks[0], clips: [{ ...raw().tracks[0].clips[0], keyframes: [] }] }] },
    { ...raw(), tracks: [{ ...raw().tracks[0], kind: 'audio' }] },
    { ...raw(), tracks: [raw().tracks[0], raw().tracks[0]] },
    { ...raw(), tracks: [{ ...raw().tracks[0], clips: [{ ...raw().tracks[0].clips[0], duration: 3601 }] }] },
  ]) assert.equal(sequenceSchema.safeParse(value).success, false);
});
test('sequence inspection rejects gaps, cross-track overlaps and out-of-range media', () => {
  const sequence = sequenceSchema.parse(raw());
  assert.deepEqual(inspectSequence(sequence, media, 'project'), { title: 'My sequence', duration: 3, trackCount: 2, clipCount: 2 });
  const gap = structuredClone(sequence); gap.tracks[0].clips[0].startTime = 1; assert.throws(() => inspectSequence(gap, media, 'project'), /timeline_gap/);
  const overlap = structuredClone(sequence); overlap.tracks.push({ ...overlap.tracks[0], id: 'other', clips: [{ ...overlap.tracks[0].clips[0], id: 'other' }] });
  assert.throws(() => inspectSequence(overlap, media, 'project'), /overlap/);
  const short = structuredClone(sequence); short.assets.picture.kind = 'video';
  assert.throws(() => inspectSequence(short, { picture: { ...media.picture, kind: 'video', duration: 2 } }, 'project'), /source duration/);
  assert.throws(() => inspectSequence(sequence, { picture: { ...media.picture, assetId: 'foreign' } }, 'project'), /identity/);
});

test('empty visible tracks are reused without reactivating hidden or locked tracks', () => {
  const base = createTimelineDocument({ projectId: 'project', name: 'Empty' });
  const sequence = sequenceSchema.parse(raw()), result = appendSequence(base, sequence, media, 'first');
  assert.equal(result.tracks.length, base.tracks.length);
  assert.equal(result.tracks[0].clips[0].id, 'first-shot');
  assert.equal(result.tracks[0].clips[0].trackId, base.tracks[0].id);
  assert.equal(base.tracks[0].clips.length, 0);
  base.tracks[0].hidden = true;
  const next = appendSequence(base, sequence, media, 'visible');
  assert.deepEqual(next.tracks[0], base.tracks[0]);
  assert.equal(next.tracks.at(-1)!.hidden, false);
  assert.equal(next.tracks.at(-1)!.clips[0].id, 'visible-shot');
});
