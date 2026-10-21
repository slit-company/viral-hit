import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { eq, sql } from 'drizzle-orm';

const root = await mkdtemp(join(tmpdir(), 'vh-generation-receipt-'));
process.env.VIRAL_HIT_DATA_DIR = root;
for (const key of ['VIRAL_HIT_PROVIDERS_DIR', 'VIRAL_HIT_ADAPTERS_DIR', 'VIRAL_HIT_HARNESS_DB']) delete process.env[key];
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
const providers = join(root, 'providers'), calls = join(root, 'calls.jsonl'), release = join(root, 'release');
const source = `
import {appendFileSync,existsSync} from 'node:fs';
const calls=${JSON.stringify(calls)},release=${JSON.stringify(release)};
function sound(){const b=Buffer.alloc(524);b.write('RIFF');b.writeUInt32LE(516,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(480,40);return {status:'succeeded',media:[{data:b,mimeType:'audio/wav'}]};}
export async function createGeneration({input}) {
  appendFileSync(calls,JSON.stringify({action:'create',prompt:input.prompt})+'\\n');
  if(input.prompt==='crash')process.exit(73);
  if(input.prompt==='reject')throw Error('Transport ended without a response');
  if(input.prompt==='hold')while(!existsSync(release))await new Promise(r=>setTimeout(r,20));
  if(input.prompt==='queued')return {status:'processing',taskId:'original-job'};
  return sound();
}
export async function checkStatus({taskId}){appendFileSync(calls,JSON.stringify({action:'check',taskId})+'\\n');return sound();}
`;
for (const scope of ['general', 'specialized']) {
  const folder = join(providers, 'receipt-' + scope); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'provider.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'receipt-' + scope, label: 'Receipt ' + scope, scope, models: [{ id: 'receipt-' + scope, name: 'Receipt ' + scope, kind: 'audio' }] }));
  await writeFile(join(folder, 'provider.mjs'), source);
}
after(async () => { await rm(root, { recursive: true, force: true }); });
const { installGenerationProviders } = await import('./installed/install.server');
assert.deepEqual(installGenerationProviders(providers).problems, []);
const { createProject } = await import('@/core/projects/projects');
const { getDb } = await import('@/core/workspace-lib/db-adapter');
const { generationUploadIntent, generationHistory } = await import('@/config/db/schema');
const { requestAssetGeneration } = await import('./asset-generation.server');
const { inspectAssetGeneration } = await import('./generation-receipt.server');
const { readGenerationIntentReceipt, bindGenerationIntentReceipt, completeGenerationUploadIntent } = await import('@/core/effects/generation-intent-receipt');
const { failGenerationUploadIntent } = await import('@/core/effects/generation-upload-intent');
const { recordGeneration } = await import('@/core/effects/record-generation');
const { listProjectGenerations } = await import('@/core/effects/project-generations');
const { syncGeneration } = await import('@/core/effects/generation-sync');

async function prepare(prompt: string, scope = 'general') {
  const project = await createProject({ name: 'Receipt ' + prompt });
  const prepared = await requestAssetGeneration({ action: 'prepare', generation: { version: 2, projectId: project.id, mode: 'audio', modelId: 'receipt-' + scope, prompt, references: [], parameters: {} } }, 'mcp');
  return {
    projectId: project.id, generationIntentToken: String(prepared.generationIntentToken),
    submit: { action: 'submit', generation: prepared.generation, generationIntentToken: prepared.generationIntentToken, expectedDigest: prepared.digest },
  };
}
const events = async () => (await readFile(calls, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
async function waitForCreate(prompt: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await events()).some(event => event.prompt === prompt)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Provider did not enter createGeneration');
}

test('intent retains the exact generation before provider completion and inspect never submits or polls', async () => {
  const prepared = await prepare('hold');
  const initial = await inspectAssetGeneration(prepared);
  assert.equal(initial.intentStatus, 'pending'); assert.equal(initial.generation, null); assert.equal(initial.mayResubmit, false);
  const pending = requestAssetGeneration(prepared.submit, 'mcp');
  let originalId: string | undefined;
  try {
    await waitForCreate('hold');
    const before = await events(), receipt = await inspectAssetGeneration(prepared);
    assert.equal(receipt.intentStatus, 'submitting'); assert.equal(receipt.generation?.status, 'pending');
    assert.equal(receipt.submissionUnresolved, true); assert.equal(receipt.hasProviderTask, false);
    originalId = receipt.generation?.id; assert.ok(originalId);
    // A failed competing reference preparation must not retire the original provider's claim.
    await failGenerationUploadIntent({ intentId: prepared.generationIntentToken, pendingOnly: true });
    assert.equal((await inspectAssetGeneration(prepared)).intentStatus, 'submitting');
    assert.deepEqual(await requestAssetGeneration({ action: 'inspect', projectId: prepared.projectId, generationIntentToken: prepared.generationIntentToken }, 'mcp'), receipt);
    assert.deepEqual(await events(), before);
    await assert.rejects(requestAssetGeneration(prepared.submit, 'mcp'), /already submitted/);
    assert.deepEqual(await events(), before);
  } finally { await writeFile(release, 'continue'); await pending; }
  const receipt = await inspectAssetGeneration(prepared);
  assert.equal(receipt.generation?.id, originalId); assert.equal(receipt.generation?.status, 'succeeded');
  assert.equal(receipt.intentStatus, 'consumed'); assert.equal(receipt.submissionUnresolved, false);
  assert.equal((await listProjectGenerations(prepared.projectId)).length, 1);
});

test('queued receipt observation leaves provider synchronization with the existing polling owner', async () => {
  const prepared = await prepare('queued', 'specialized');
  const submitted = await requestAssetGeneration(prepared.submit, 'cli');
  const before = await events();
  const receipt = await inspectAssetGeneration(prepared);
  assert.equal(receipt.generation?.id, submitted.wmTaskId); assert.equal(receipt.generation?.status, 'processing');
  assert.equal(receipt.hasProviderTask, true); assert.equal(receipt.submissionUnresolved, false);
  assert.deepEqual(await events(), before);
  const stored = await readGenerationIntentReceipt({ projectId: prepared.projectId, intentId: prepared.generationIntentToken });
  assert.ok(stored.generation);
  // Move only the fixture's poll lease into the past; production throttling stays unchanged.
  await (await getDb()).update(generationHistory).set({ lastProviderSyncAt: new Date(0) }).where(eq(generationHistory.id, stored.generation.id));
  await syncGeneration({ wmTaskId: stored.generation.id, effectId: stored.generation.effectId });
  assert.equal((await inspectAssetGeneration(prepared)).generation?.status, 'succeeded');
});

test('a real process exit inside a provider preserves the original receipt across CLI restart without replay', async () => {
  const prepared = await prepare('crash');
  const file = join(root, 'crash-request.json'); await writeFile(file, JSON.stringify(prepared.submit));
  const env = { ...process.env, VIRAL_HIT_PROVIDERS_DIR: providers };
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/generation.ts', 'request', file], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.status, 73, child.stderr);
  const receipt = await inspectAssetGeneration(prepared);
  assert.equal(receipt.intentStatus, 'submitting'); assert.equal(receipt.generation?.status, 'pending');
  assert.equal(receipt.submissionUnresolved, true); assert.equal(receipt.mayResubmit, false);
  await writeFile(file, JSON.stringify({ action: 'inspect', projectId: prepared.projectId, generationIntentToken: prepared.generationIntentToken }));
  const before = await events();
  const recovered = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/generation.ts', 'request', file], { env: { ...env, VIRAL_HIT_PROVIDERS_DIR: join(root, 'removed-providers') }, encoding: 'utf8' }));
  assert.deepEqual(recovered, receipt); assert.deepEqual(await events(), before);
  await assert.rejects(requestAssetGeneration(prepared.submit, 'cli'), /already submitted/);
  assert.equal((await events()).filter(event => event.prompt === 'crash').length, 1);
});

test('provider errors retain a traceable generation but never imply permission to repeat the request', async () => {
  const prepared = await prepare('reject', 'specialized');
  const result = await requestAssetGeneration(prepared.submit, 'mcp'); assert.equal(result.status, 'failed');
  const receipt = await inspectAssetGeneration(prepared);
  assert.equal(receipt.intentStatus, 'failed'); assert.equal(receipt.generation?.id, result.wmTaskId);
  assert.equal(receipt.submissionUnresolved, true); assert.equal(receipt.mayResubmit, false);
  await assert.rejects(requestAssetGeneration(prepared.submit, 'mcp'));
  assert.equal((await events()).filter(event => event.prompt === 'reject').length, 1);
});

test('project and effect ownership fence receipt binding, reads and completion reassignment', async () => {
  const prepared = await prepare('ownership');
  const db = await getDb();
  const stored = await readGenerationIntentReceipt({ projectId: prepared.projectId, intentId: prepared.generationIntentToken });
  const foreign = await createProject({ name: 'Foreign receipt' });
  await assert.rejects(inspectAssetGeneration({ ...prepared, projectId: foreign.id }), /not found in this project/);
  await assert.rejects(inspectAssetGeneration({ ...prepared, generationIntentToken: 'missing' }), /not found in this project/);
  const first = await recordGeneration({ projectId: prepared.projectId, effectId: stored.intent.effectId, status: 'pending' });
  const second = await recordGeneration({ projectId: foreign.id, effectId: stored.intent.effectId, status: 'pending' });
  assert.ok(first && second);
  const binding = { projectId: prepared.projectId, effectId: stored.intent.effectId, intentId: prepared.generationIntentToken, generationId: first };
  await assert.rejects(bindGenerationIntentReceipt(binding), /submission stopped/);
  await db.update(generationUploadIntent).set({ status: 'submitting' }).where(eq(generationUploadIntent.id, prepared.generationIntentToken));
  await assert.rejects(bindGenerationIntentReceipt({ ...binding, generationId: second }), /does not match/);
  await assert.rejects(bindGenerationIntentReceipt({ ...binding, effectId: stored.intent.effectId + 1 }), /does not match/);
  await bindGenerationIntentReceipt(binding); await bindGenerationIntentReceipt(binding);
  assert.equal(await completeGenerationUploadIntent({ intentId: binding.intentId, generationId: second }), false);
  assert.equal(await completeGenerationUploadIntent({ intentId: binding.intentId, generationId: first }), true);
  assert.equal((await inspectAssetGeneration(prepared)).generation?.id, first);
});

test('failed receipt persistence stops before the provider call', async () => {
  const prepared = await prepare('must-not-run'), db = await getDb(), before = await events();
  await db.run(sql.raw("CREATE TRIGGER reject_receipt BEFORE UPDATE OF generation_id ON generation_upload_intent WHEN NEW.generation_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'receipt persistence unavailable'); END"));
  try { await assert.rejects(requestAssetGeneration(prepared.submit, 'mcp'), error => error instanceof Error && /receipt persistence unavailable/.test(String(error.cause))); }
  finally { await db.run(sql.raw('DROP TRIGGER reject_receipt')); }
  assert.deepEqual(await events(), before);
  const receipt = await inspectAssetGeneration(prepared);
  assert.equal(receipt.submissionUnresolved, true); assert.equal(receipt.mayResubmit, false);
});

test('an expired prepared agent request cannot silently exchange its token for a fresh submission', async () => {
  const prepared = await prepare('expired'), db = await getDb(), before = await events();
  await db.update(generationUploadIntent).set({ expiresAt: new Date(0) }).where(eq(generationUploadIntent.id, prepared.generationIntentToken));
  const receipt = await inspectAssetGeneration(prepared); assert.equal(receipt.expired, true);
  assert.equal(receipt.intentStatus, 'pending'); // Inspect does not mutate expiry state.
  await assert.rejects(requestAssetGeneration(prepared.submit, 'mcp'), /request changed/);
  assert.deepEqual(await events(), before); assert.deepEqual(await listProjectGenerations(prepared.projectId), []);
  const intents = await db.select().from(generationUploadIntent).where(eq(generationUploadIntent.projectId, prepared.projectId));
  assert.equal(intents.length, 1);
});
