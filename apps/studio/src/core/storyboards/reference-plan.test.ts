import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReferencePlan } from './reference-plan';
import { mapStoryboardPlan } from './portable';
import type { PrepareReference } from './reference-input';
import type { SceneAnalysis } from '../references/scene-contract';
import type { Transcript } from '../transcripts/contract';
const job = { runId: 'run', jobId: 'job', outputSha256: 'a'.repeat(64) };
const source = { assetId: 'video', sha256: 'b'.repeat(64) };
const request: PrepareReference = { action: 'prepare-reference', scenes: job, transcript: { ...job, jobId: 'speech' }, firstScene: 0, lastScene: 2, title: 'A general study', intent: 'Reinterpret the rhythm of a reference', scope: 'general' };
const analysis: SceneAnalysis = { algorithm: 'ffmpeg-scdet-v1', sampleFps: 8, threshold: 10, minDuration: .5, maxScenes: 24, duration: 3, candidateCount: 2, scenes: [0, 1, 2].map(start => ({ start, end: start + 1, score: start ? 90 : 0 })) };
const transcript: Transcript = { schemaVersion: 1, basis: 'machine-transcription', source: { ...source, projectId: 'project', kind: 'video', sizeBytes: 100 }, engine: { id: 'independent-recognizer', version: '1', model: 'sample' }, language: 'ko', range: { start: 0, end: 3 }, segments: [{ start: .5, end: 1.5, text: '안녕하세요' }], timingAdjusted: 0, segmentsOmitted: 0 };
test('machine estimates create explicit range references without inventing shot semantics or splitting spoken words at cuts', () => {
  const plan = buildReferencePlan(request, source, analysis, transcript);
  assert.deepEqual(plan.shots.map(shot => shot.duration), [1, 1, 1]);
  assert.equal(plan.references.length, 5);
  assert.ok(plan.references.every(item => item.basis === 'inferred'));
  assert.equal(plan.references.filter(item => item.evidence?.kind === 'speech-transcript').length, 2);
  assert.ok(plan.references.filter(item => item.evidence?.kind === 'speech-transcript').every(item => item.observation.includes('0.500–1.500s: 안녕하세요')));
  assert.ok(plan.shots.every(shot => !shot.recipe && !shot.caption && !shot.preserve.length));
  assert.deepEqual(plan.shots[2].references, ['scene-3']);
  const moved = mapStoryboardPlan(plan, new Map(), new Map([['video', 'new-video']]));
  assert.equal(moved.references[0].assetId, 'new-video'); assert.deepEqual(moved.references[0].evidence, plan.references[0].evidence);
});
test('specialized intent uses the same selected ranges and never silently truncates a larger analysis', () => {
  const plan = buildReferencePlan({ ...request, firstScene: 1, lastScene: 2, scope: 'specialized', intent: 'A short product reveal', transcript: undefined }, source, analysis);
  assert.equal(plan.scope, 'specialized'); assert.deepEqual(plan.shots.map(shot => shot.id), ['shot-2', 'shot-3']);
  for (const range of [{ firstScene: 2, lastScene: 1 }, { firstScene: 0, lastScene: 3 }]) assert.throws(() => buildReferencePlan({ ...request, ...range }, source, analysis));
  const many = { ...analysis, duration: 20, scenes: Array.from({ length: 20 }, (_, start) => ({ start, end: start + 1, score: 0 })) };
  assert.throws(() => buildReferencePlan({ ...request, lastScene: 19 }, source, many), /sixteen/);
});
test('foreign transcripts, absent overlapping speech and excessive context fail rather than claiming an aligned observation', () => {
  assert.throws(() => buildReferencePlan(request, source, analysis, { ...transcript, source: { ...transcript.source, assetId: 'other' } }), /same original/);
  assert.throws(() => buildReferencePlan({ ...request, firstScene: 2 }, source, analysis, transcript), /no speech/);
  assert.throws(() => buildReferencePlan(request, source, analysis, { ...transcript, segments: [{ start: 0, end: 1, text: 'x'.repeat(4000) }] }), /exceeds/);
});
