import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorOperations } from '@/core/commands/editor-commands';
import { diagnoseTimeline } from './timeline-diagnostics';
import { trailingGapFix } from './timeline-gap-fix';
import type { TimelineDocument } from './timeline-document';

const clip = (id: string, trackId: string, sourceType: 'image' | 'video' | 'audio', startTime: number, duration: number) => ({
  id, assetId: id, sourceUrl: '/api/app/projects/p/assets/' + id, trackId, name: id, sourceType, startTime, duration,
  inPoint: 0, outPoint: duration, sourceDuration: sourceType === 'image' ? null : duration, volume: 1, muted: false,
  fadeIn: 0, fadeOut: 0, text: '', overlay: null, caption: null, takes: [], activeTakeId: null,
});
const timeline = (lastVisual: 'image' | 'video'): TimelineDocument => ({
  schemaVersion: 6, id: 't', projectId: 'p', name: 'Teaser', createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z',
  duration: 8.72, lastRenderAssetId: null, lastRenderUrl: null, captionStyle: 'classic',
  tracks: [
    { id: 'v', kind: 'video', name: 'Visual 1', locked: false, hidden: false, muted: false, clips: [clip('a', 'v', 'image', 0, 3), clip('b', 'v', lastVisual, 3, 3)] },
    { id: 'a', kind: 'audio', name: 'Audio 1', locked: false, hidden: false, muted: false, clips: [clip('voice', 'a', 'audio', 0, 8.72)] },
  ],
} as unknown as TimelineDocument);

test('narration longer than the stills is repaired by holding the last image', () => {
  const document = timeline('image');
  const operation = trailingGapFix(document);
  assert.deepEqual(operation, { type: 'set_clip_duration', clipId: 'b', duration: 5.72 });
  const repaired = applyEditorOperations(document, [operation!]).document;
  assert.equal(diagnoseTimeline(repaired).some(item => item.severity === 'error'), false);
});

test('a video cannot be stretched, so that gap is left for the editor to decide', () => {
  assert.equal(trailingGapFix(timeline('video')), null);
});
