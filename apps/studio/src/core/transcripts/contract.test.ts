import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptSchema, readTranscriptOutput, transcriptSrt } from './contract';
const example = () => ({ schemaVersion: 1, basis: 'machine-transcription', source: { projectId: 'project', assetId: 'asset', kind: 'video', sha256: 'a'.repeat(64), sizeBytes: 1024 }, engine: { id: 'independent-recognizer', version: '2', model: 'installed-model' }, language: 'ko', range: { start: 12, end: 16 }, segments: [{ start: 12.125, end: 13.5, text: '안녕 <b>hello</b>' }, { start: 14, end: 15.999, text: 'Second\nline' }], timingAdjusted: 0, segmentsOmitted: 0 });
test('independent recognizers share a bounded transcript contract and relative SRT with literal text', () => {
  const parsed = transcriptSchema.parse(example());
  assert.equal(readTranscriptOutput(JSON.stringify({ transcript: parsed, captionClips: [] }))?.engine.id, 'independent-recognizer');
  assert.equal(transcriptSrt(parsed), '1\n00:00:00,125 --> 00:00:01,500\n안녕 &lt;b&gt;hello&lt;/b&gt;\n\n2\n00:00:02,000 --> 00:00:03,999\nSecond line\n');
  const empty = { ...parsed, segments: [] }; assert.equal(transcriptSrt(empty), '');
});
test('transcripts cannot disguise invalid source kinds, fabricated empty text or out-of-range and overlapping times', () => {
  for (const change of [
    { source: { ...example().source, kind: 'image' } }, { range: { start: 12, end: 12 } }, { range: { start: 0, end: 121 } },
    { segments: [{ start: 12, end: 13, text: ' ' }] }, { segments: [{ start: 11, end: 13, text: 'Before' }] },
    { segments: [{ start: 12, end: 17, text: 'After' }] }, { segments: [{ start: 12, end: 14, text: 'One' }, { start: 13, end: 15, text: 'Overlap' }] },
  ]) assert.equal(readTranscriptOutput(JSON.stringify({ transcript: { ...example(), ...change } })), null);
});
