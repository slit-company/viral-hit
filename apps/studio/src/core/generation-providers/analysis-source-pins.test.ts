import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisReport } from './analysis-report';
import { analysisSourcePins } from './analysis-source-pins.server';
import { localReferenceUrl } from './local-reference';

const video = { projectId: 'project', assetId: 'video', kind: 'video' as const, sha256: 'a'.repeat(64), sizeBytes: 200 };
const image = { ...video, assetId: 'image', kind: 'image' as const };
const audio = { ...video, assetId: 'audio', kind: 'audio' as const };
const report = analysisReport.parse({ schemaVersion: 2, summary: 'Protocol fixture', observations: [
  { id: 'still', source: { kind: 'image', index: 0 }, description: 'Image evidence' },
  { id: 'second-video', source: { kind: 'video', index: 1 }, start: .2, end: .4, description: 'Second video evidence' },
  { id: 'sound', source: { kind: 'audio', index: 0 }, start: 0, end: 1, description: 'Audio evidence' },
] });
const second = { ...video, assetId: 'other-video', sha256: 'b'.repeat(64) };
const input = { image_urls: [localReferenceUrl(image)], video_urls: [localReferenceUrl(video), localReferenceUrl(second)], audio_urls: [localReferenceUrl(audio)] };

test('v2 observations bind exact kind/index positions and preserve every original pin', () => {
  const pins = analysisSourcePins('project', input, report)!;
  assert.deepEqual(pins.map(source => [source.kind, source.index, source.pin.assetId]), [['image', 0, 'image'], ['video', 0, 'video'], ['video', 1, 'other-video'], ['audio', 0, 'audio']]);
  assert.deepEqual(pins[2].pin, second);
  for (const invalid of [
    { ...input, video_urls: [input.video_urls[0]] },
    { ...input, video_url: input.video_urls[0] },
    { ...input, image_url: input.image_urls[0] },
    { ...input, audio_urls: [input.video_urls[0]] },
    { ...input, audio_urls: ['https://example.org/sound.wav'] },
    { ...input, image_urls: [localReferenceUrl({ ...image, projectId: 'foreign' })] },
    { ...input, video_urls: [input.video_urls[0], input.video_urls[0]] },
    { ...input, audio_urls: 'not-an-array' },
    { ...input, video_urls: Array.from({ length: 21 }, () => input.video_urls[0]) },
  ]) assert.equal(analysisSourcePins('project', invalid, report), null);
  assert.equal(analysisSourcePins('foreign', input, report), null);
  const single = analysisReport.parse({ schemaVersion: 2, summary: 'One video', observations: [{ id: 'video', source: { kind: 'video', index: 0 }, start: 0, end: 1, description: 'Technical only' }] });
  const oversized = { video_urls: Array.from({ length: 5 }, (_, index) => localReferenceUrl({ ...video, assetId: 'video-' + index, sizeBytes: 64 * 1024 * 1024 })) };
  assert.equal(analysisSourcePins('project', oversized, single), null);
});

test('versioned reports reject ambiguous timelines and cannot invent source IDs or actions', () => {
  for (const observation of [
    { id: 'missing', start: 0, end: 1, description: 'No source' },
    { id: 'image-time', source: { kind: 'image', index: 0 }, start: 0, end: 1, description: 'Invented image timeline' },
    { id: 'no-time', source: { kind: 'audio', index: 0 }, description: 'Missing range' },
    { id: 'reverse', source: { kind: 'video', index: 0 }, start: 1, end: 0, description: 'Invalid range' },
    { id: 'wrong-source', source: { kind: 'video', index: 20 }, start: 0, end: 1, description: 'Out of bounds' },
    { id: 'invented', source: { kind: 'image', index: 0, assetId: 'forged' }, description: 'Substitution' },
  ]) assert.equal(analysisReport.safeParse({ schemaVersion: 2, summary: 'Invalid fixture', observations: [observation] }).success, false);
  assert.equal(analysisReport.safeParse({ ...report, observations: [report.observations[0], report.observations[0]] }).success, false);
  const legacy = analysisReport.parse({ schemaVersion: 1, summary: 'Legacy', observations: [{ id: 'video', start: 0, end: 1, description: 'Single timeline' }] });
  assert.deepEqual(analysisSourcePins('project', { video_url: localReferenceUrl(video) }, legacy), [{ kind: 'video', index: 0, pin: video }]);
  assert.equal(analysisSourcePins('project', input, legacy), null);
  assert.equal(analysisReport.safeParse({ ...legacy, observations: [{ ...legacy.observations[0], source: { kind: 'video', index: 0 } }] }).success, false);
});
