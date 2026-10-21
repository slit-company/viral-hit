import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import Ajv2020 from 'ajv/dist/2020';
import { analysisReport } from '../generation-providers/analysis-report';
import { buildAnalysisPlan } from './analysis-plan';
import { mapStoryboardPlan } from './portable';
import type { PrepareAnalysis } from './analysis-input';
import { InstalledProviderRuntime } from '../generation-providers/installed/runtime.server';
import { providerManifestSchema, providerResultSchema } from '../generation-providers/installed/manifest';
import type { EffectRecord } from '../adapters/base-adapter';

const report = analysisReport.parse({ schemaVersion: 1, summary: 'Authored contract fixture; no model evaluation.', observations: [
  { id: 'detail', start: 1, end: 2, description: 'Provider interpretation of the detail interval.', proposal: { title: 'Detail reveal', direction: 'Move closer to the subject.', duration: 2, preserve: ['Shape'], change: ['Background'], avoid: ['New text'], caption: 'A proposed caption' } },
  { id: 'context', start: 0, end: 1, description: 'Provider interpretation of the opening.' },
] });
const request: PrepareAnalysis = { action: 'prepare-analysis', analysis: { generationId: '02ebc721-2bd6-4e89-9744-de065e6afeb7', outputSha256: 'a'.repeat(64) }, observationIds: ['context', 'detail'], title: 'My film', intent: 'Reinterpret the reference', scope: 'general' };
const source = { kind: 'video' as const, index: 0, assetId: 'video', sha256: 'b'.repeat(64), duration: 2 };
const model = 'external / review-model';

test('provider proposals produce editable general/specialized plans in the selected order with retained evidence', () => {
  for (const scope of ['general', 'specialized'] as const) {
    const plan = buildAnalysisPlan({ ...request, scope }, report, [source], model);
    assert.equal(plan.scope, scope); assert.equal(plan.intent, request.intent);
    assert.deepEqual(plan.references.map(item => item.startTime), [0, 1]);
    assert.equal(plan.shots[1].direction, 'Move closer to the subject.');
    assert.equal(plan.shots[1].duration, 2); assert.equal(plan.shots[1].caption, 'A proposed caption');
    assert.deepEqual(plan.shots[1].preserve, ['Shape']); assert.deepEqual(plan.shots[1].change, ['Background']);
    assert.ok(plan.shots.every(item => !item.recipe)); assert.deepEqual(plan.audio, []);
    assert.ok(plan.references.every(item => item.basis === 'inferred' && item.evidence?.kind === 'provider-analysis'));
    const moved = mapStoryboardPlan(plan, new Map(), new Map([['video', 'recipient-video']]));
    assert.equal(moved.references[0].assetId, 'recipient-video'); assert.deepEqual(moved.references[0].evidence, plan.references[0].evidence);
  }
});

test('invalid IDs, duplicate selections and out-of-source ranges fail without silent clipping', () => {
  assert.throws(() => buildAnalysisPlan({ ...request, observationIds: ['absent'] }, report, [source], model), /absent/);
  assert.throws(() => buildAnalysisPlan({ ...request, observationIds: ['detail', 'detail'] }, report, [source], model), /distinct/);
  assert.throws(() => buildAnalysisPlan(request, report, [{ ...source, duration: 1.99 }], model), /duration/);
  assert.throws(() => analysisReport.parse({ ...report, observations: [report.observations[0], report.observations[0]] }), /unique/);
  assert.ok(analysisReport.safeParse({ ...report, observations: [{ ...report.observations[0], start: .02, end: .03 }] }).success);
  assert.equal(analysisReport.safeParse({ ...report, observations: [{ ...report.observations[0], start: 0, end: .333333 }] }).success, false);
  assert.throws(() => analysisReport.parse({ ...report, observations: [{ ...report.observations[0], start: 2, end: 1 }] }), /range/);
  assert.throws(() => analysisReport.parse({ ...report, observations: [{ ...report.observations[0], proposal: { ...report.observations[0].proposal, recipe: { id: 'execute-me' } } }] }));
  assert.throws(() => analysisReport.parse({ ...report, observations: Array.from({ length: 64 }, (_, i) => ({ id: 'item-' + i, start: 0, end: 1, description: '한'.repeat(2000) })) }), /256 KB/);
});

test('independent providers can return structured reports directly or on completion, but media models cannot', async () => {
  const manifest = providerManifestSchema.parse({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'report-test', label: 'Report', models: [{ id: 'report-test', name: 'Report', kind: 'analysis' }] });
  const effect = { linkName: 'report-test', type: 3 } as EffectRecord;
  const runtime = new InstalledProviderRuntime(manifest, `export async function createGeneration(){return {status:'processing',taskId:'report-1'}} export async function checkStatus(){return ${JSON.stringify({ status: 'succeeded', report })}}`);
  assert.equal((await runtime.call('createGeneration', effect, {})).status, 'processing');
  const result = await runtime.call('checkStatus', effect, { taskId: 'report-1' });
  assert.deepEqual(result.output, { analysis_text: report.summary, analysis_report: report });
  assert.throws(() => providerResultSchema.parse({ status: 'processing', taskId: 'x', report }));
  const image = providerManifestSchema.parse({ ...manifest, models: [{ id: 'report-test', name: 'Image', kind: 'image', aspectRatios: ['1:1'] }] });
  const invalid = new InstalledProviderRuntime(image, `export async function createGeneration(){return ${JSON.stringify({ status: 'succeeded', report })}}`);
  assert.equal((await invalid.call('createGeneration', effect, {})).status, 'failed');
});

test('published report schema describes author input and matches runtime structure', async () => {
  const schema = JSON.parse(await readFile('../../docs/schemas/analysis-report.schema.json', 'utf8'));
  assert.deepEqual(schema, JSON.parse(JSON.stringify(z.toJSONSchema(analysisReport, { io: 'input' }))));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.ok(validate(report)); assert.equal(validate({ ...report, executable: 'run this' }), false);
});

test('source-specific plans keep selected order, independent ranges and still-image semantics in portable evidence', () => {
  const mixed = analysisReport.parse({ schemaVersion: 2, summary: 'Authored mixed report, not model-quality evidence', observations: [
    { id: 'still', source: { kind: 'image', index: 0 }, description: 'Original picture' },
    { id: 'sound', source: { kind: 'audio', index: 0 }, start: .2, end: .7, description: 'Original audio', proposal: { title: 'Audio-led shot', direction: 'Author a visual response', duration: 2 } },
    { id: 'video', source: { kind: 'video', index: 1 }, start: .1, end: 1.1, description: 'Second original video' },
  ] });
  const originals = [source, { ...source, index: 1, assetId: 'second-video' }, { ...source, kind: 'image' as const, assetId: 'picture', duration: undefined }, { ...source, kind: 'audio' as const, assetId: 'sound', duration: 1 }];
  const plan = buildAnalysisPlan({ ...request, observationIds: ['video', 'still', 'sound'] }, mixed, originals, model);
  assert.deepEqual(plan.references.map(item => item.assetId), ['second-video', 'picture', 'sound']);
  assert.deepEqual(plan.references.map(item => [item.startTime, item.endTime]), [[.1, 1.1], [undefined, undefined], [.2, .7]]);
  assert.deepEqual(plan.shots.map(item => item.duration), [1, 3, 2]);
  assert.deepEqual(plan.audio, []); assert.ok(plan.shots.every(item => !item.recipe));
  const evidence = plan.references[0].evidence;
  assert.ok(evidence?.kind === 'provider-analysis');
  assert.equal(evidence.observationId, 'video'); assert.deepEqual(evidence.source, { kind: 'video', index: 1 });
  const transferred = mapStoryboardPlan(plan, new Map(), new Map([['second-video', 'recipient-video'], ['picture', 'recipient-picture'], ['sound', 'recipient-sound']]));
  assert.equal(transferred.references[0].assetId, 'recipient-video');
  assert.deepEqual(transferred.references.map(item => item.evidence), plan.references.map(item => item.evidence));
  assert.throws(() => buildAnalysisPlan({ ...request, observationIds: ['video'] }, mixed, [source], model), /source.*absent/);
  assert.throws(() => buildAnalysisPlan({ ...request, observationIds: ['sound'] }, mixed, originals.map(item => ({ ...item, duration: .6 })), model), /duration/);
});
