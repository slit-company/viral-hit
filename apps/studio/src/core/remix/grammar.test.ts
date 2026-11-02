import assert from 'node:assert/strict';
import test from 'node:test';
import { applyEditorOperations } from '../commands/editor-commands';
import { createTimelineDocument } from '../editor/timeline-document';
import { assignRemixMaterials, remixGrammar, remixOperations } from './grammar';

const grammar = remixGrammar([{ start: 0, end: 1.2 }, { start: 1.2, end: 1.8 }, { start: 1.8, end: 4.2 }, { start: 4.2, end: 5 }], 5);

test('the grammar keeps cut times and pace', () => {
  assert.deepEqual(grammar.shots.map((shot) => shot.duration), [1.2, 0.6, 2.4, 0.8]);
  assert.equal(grammar.averageShot, 1.25);
  assert.equal(grammar.cutsPerMinute, 36);
});

test('material cycles in order, skips a video too short for its shot and keeps the longest as a last resort', () => {
  const image = { assetId: 'still', kind: 'image' as const, duration: null, name: 'Still' };
  const short = { assetId: 'short', kind: 'video' as const, duration: 1, name: 'Short' };
  const long = { assetId: 'long', kind: 'video' as const, duration: 3, name: 'Long' };
  assert.deepEqual(assignRemixMaterials(grammar, [short, image]).map(({ material, length }) => [material.assetId, length]), [['still', 1.2], ['short', 0.6], ['still', 2.4], ['short', 0.8]]);
  assert.deepEqual(assignRemixMaterials(grammar, [short, long]).map(({ material, length }) => [material.assetId, length]), [['long', 1.2], ['short', 0.6], ['long', 2.4], ['short', 0.8]]);
  assert.deepEqual(assignRemixMaterials(grammar, [short]).map(({ length }) => length), [1, 0.6, 1, 0.8], 'a lone short video leaves the rest of long shots black');
  assert.throws(() => assignRemixMaterials(grammar, []), /at least one/);
});

test('operations place every shot at the reference cut time after the offset, with soundtrack and transitions', () => {
  const assignments = assignRemixMaterials(grammar, [{ assetId: 'still', kind: 'image', duration: null, name: 'Still' }, { assetId: 'long', kind: 'video', duration: 3, name: 'Long' }]);
  const operations = remixOperations({ assignments, offset: 2, idPrefix: 'r', transition: { kind: 'crossfade', duration: 0.4 }, soundtrack: { assetId: 'sound', duration: 5 } });
  const document = applyEditorOperations(createTimelineDocument({ projectId: 'p', name: 'Remix' }), operations.map((operation) => operation.type === 'add_clip' ? { ...operation, sourceUrl: '/' + operation.assetId } : operation)).document;
  const visuals = document.tracks.filter((track) => track.kind === 'video').flatMap((track) => track.clips);
  assert.deepEqual(visuals.map((clip) => [clip.startTime, clip.duration, clip.assetId]), [[2, 1.2, 'still'], [3.2, 0.6, 'long'], [3.8, 2.4, 'still'], [6.2, 0.8, 'long']]);
  assert.deepEqual(visuals.map((clip) => clip.transition?.kind ?? null), [null, 'crossfade', 'crossfade', 'crossfade']);
  const audio = document.tracks.filter((track) => track.kind === 'audio').flatMap((track) => track.clips);
  assert.deepEqual(audio.map((clip) => [clip.startTime, clip.duration, clip.audioRole]), [[2, 5, 'music']]);
});
