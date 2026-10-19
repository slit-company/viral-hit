import assert from 'node:assert/strict';
import test from 'node:test';

import { addSourceClip, createTimelineDocument } from './timeline-document';
import { mergeTimelineDocuments } from './timeline-merge';

test('timeline merge preserves disjoint local and remote clip additions', () => {
  const base = createTimelineDocument({ projectId: 'project-1', name: 'Edit' });
  const local = addSourceClip(base, {
    clipId: 'local-clip',
    assetId: 'local-asset',
    sourceUrl: '/local.mp4',
    name: 'Local',
    sourceType: 'video',
    sourceDuration: 2,
  });
  const remote = addSourceClip(base, {
    clipId: 'remote-clip',
    assetId: 'remote-asset',
    sourceUrl: '/remote.mp3',
    name: 'Remote',
    sourceType: 'audio',
    sourceDuration: 4,
  });

  const result = mergeTimelineDocuments({ base, local, remote });
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(
    result.document.tracks.flatMap((track) => track.clips.map((clip) => clip.id)),
    ['local-clip', 'remote-clip']
  );
});

test('timeline merge reports two edits to the same clip field', () => {
  const empty = createTimelineDocument({ projectId: 'project-1', name: 'Edit' });
  const base = addSourceClip(empty, {
    clipId: 'clip-1',
    assetId: 'asset-1',
    sourceUrl: '/video.mp4',
    name: 'Video',
    sourceType: 'video',
    sourceDuration: 5,
  });
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.tracks[0].clips[0].name = 'Local name';
  remote.tracks[0].clips[0].name = 'Remote name';

  const result = mergeTimelineDocuments({ base, local, remote });
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0].path, /name$/);
  assert.equal(result.document.tracks[0].clips[0].name, 'Local name');
});

test('concurrent export receipts do not block a take selection or keep an obsolete render', () => {
  const base = addSourceClip(createTimelineDocument({ projectId: 'project-1', name: 'Edit' }), {
    clipId: 'target', assetId: 'original', sourceUrl: '/original.png', name: 'Original', sourceType: 'image', sourceDuration: 2,
  });
  base.tracks[0].clips[0].takes = [{ id: 'alternative', assetId: 'new', sourceUrl: '/new.png', name: 'Alternative', sourceType: 'image', sourceDuration: 2, prompt: '', sourceGenerationId: 'job', createdAt: new Date().toISOString() }];
  base.tracks[0].clips[0].activeTakeId = 'alternative';
  base.lastRenderAssetId = 'old-browser-export'; base.lastRenderUrl = '/old.mp4';
  const local = structuredClone(base), remote = structuredClone(base);
  local.tracks[0].clips[0].activeTakeId = null; local.lastRenderAssetId = null; local.lastRenderUrl = null;
  remote.lastRenderAssetId = 'new-server-export'; remote.lastRenderUrl = '/new.mp4';
  const merged = mergeTimelineDocuments({ base, local, remote });
  assert.deepEqual(merged.conflicts, []); assert.equal(merged.document.tracks[0].clips[0].activeTakeId, null);
  assert.equal(merged.document.lastRenderAssetId, null); assert.equal(merged.document.lastRenderUrl, null);
  const metadataOnly = mergeTimelineDocuments({ base, local: base, remote });
  assert.deepEqual(metadataOnly.conflicts, []); assert.equal(metadataOnly.document.lastRenderAssetId, 'new-server-export');
});
