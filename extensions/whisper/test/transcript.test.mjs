import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranscript } from '../src/transcript.mjs';
import { checkInput } from '../src/adapter.mjs';
const source = { projectId: 'project', assetId: 'asset', kind: 'audio', sha256: 'a'.repeat(64), sizeBytes: 10, bytes: new Uint8Array(10) };
const options = { source, start: 12, duration: 5, engine: { id: 'fixture', model: 'fixture', version: '1' } };
const raw = items => ({ result: { language: 'ko' }, transcription: items.map(([from, to, text]) => ({ offsets: { from, to }, text })) });
test('estimated captions retain source offsets and convert separately to clip-local timing', () => {
  const result = normalizeTranscript(raw([[125, 1000, ' 안녕하세요 '], [1200, 2400, 'Second line']]), options);
  assert.deepEqual(result.transcript.segments, [{ start: 12.125, end: 13, text: '안녕하세요' }, { start: 13.2, end: 14.4, text: 'Second line' }]);
  assert.equal(result.captionClips[1].startTime, 1.2); assert.equal(result.captionClips[1].duration, 1.2);
  assert.equal(result.mediaClips[0].inPoint, 12); assert.equal(result.mediaClips[0].duration, 5);
  assert.equal('bytes' in result.transcript.source, false);
});
test('empty recognition remains empty and boundary normalization is explicitly counted', () => {
  assert.deepEqual(normalizeTranscript(raw([]), options).captionClips, []);
  const output = normalizeTranscript(raw([[0, 1000, 'First'], [900, 5500, 'Second'], [6000, 7000, 'Outside'], [10000, 10000, '']]), options);
  assert.equal(output.transcript.timingAdjusted, 1); assert.equal(output.transcript.segmentsOmitted, 2);
  assert.deepEqual(output.transcript.segments.map(item => [item.start, item.end]), [[12, 13], [13, 17]]);
});
test('invalid model timestamps, oversized output and ambiguous inputs fail instead of inventing alignment', () => {
  for (const value of [raw([[-1, 1000, 'Bad']]), raw([[1000, 0, 'Backwards']]), raw([[0, 1.2, 'Fractional ms']]), raw(Array.from({ length: 121 }, () => [0, 10, 'Many'])), { transcription: [], result: {} }]) assert.throws(() => normalizeTranscript(value, options));
  const input = { audioAssetId: 'source', videoAssetId: null, start: 0, duration: 30, language: 'auto', maxChars: 72, threads: 2 };
  assert.equal(checkInput(input), 'audio'); assert.equal(checkInput({ ...input, audioAssetId: null, videoAssetId: 'video' }), 'video');
  for (const change of [{ videoAssetId: 'both' }, { audioAssetId: null }, { duration: 121 }, { threads: 5 }, { start: -1 }, { language: '--translate' }]) assert.throws(() => checkInput({ ...input, ...change }));
});
