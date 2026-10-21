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
const source = { assetId: 'video', sha256: 'b'.repeat(64), model: 'external / review-model', duration: 2 };

test('provider proposals produce editable general/specialized plans in the selected order with retained evidence', () => {
  for (const scope of ['general', 'specialized'] as const) {
    const plan = buildAnalysisPlan({ ...request, scope }, report, source);
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
  assert.throws(() => buildAnalysisPlan({ ...request, observationIds: ['absent'] }, report, source), /absent/);
  assert.throws(() => buildAnalysisPlan({ ...request, observationIds: ['detail', 'detail'] }, report, source), /distinct/);
  assert.throws(() => buildAnalysisPlan(request, report, { ...source, duration: 1.99 }), /duration/);
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
