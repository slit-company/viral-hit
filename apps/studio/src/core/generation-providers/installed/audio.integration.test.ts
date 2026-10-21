import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { providerManifestSchema } from './manifest';
import { InstalledProviderAdapter, InstalledProviderRuntime } from './runtime.server';
import { validateInstalledAudioInput } from './audio-input';
import { buildOutputStoragePlan, MAX_LOCAL_AUDIO_ASSET_BYTES } from '@/core/effects/output-storage';
import type { EffectRecord } from '@/core/adapters/base-adapter';

const root = await mkdtemp(join(tmpdir(), 'vh-audio-providers-'));
process.env.VIRAL_HIT_DATA_DIR = root;
for (const key of ['VIRAL_HIT_ADAPTERS_DIR', 'VIRAL_HIT_PROVIDERS_DIR', 'VIRAL_HIT_PUBLISHING_CONNECTORS_DIR', 'VIRAL_HIT_HARNESS_DB']) delete process.env[key];
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
const providerRoot = join(root, 'providers');
await cp(resolve('../../examples/providers/procedural-audio'), join(providerRoot, 'procedural-audio'), { recursive: true });
const manifest = providerManifestSchema.parse(JSON.parse(await readFile(join(providerRoot, 'procedural-audio/provider.json'), 'utf8')));
const source = await readFile(join(providerRoot, 'procedural-audio/provider.mjs'), 'utf8');
const native = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const sound = (await native.createGeneration({ model: { id: 'instant' }, input: { options: { frequency: 440, seconds: .3, wave: 'sine' } }, signal: AbortSignal.timeout(1000) })).media[0].data as Uint8Array;
const server = createServer((req, res) => {
  res.setHeader('content-type', req.url === '/wrong.wav' ? 'image/png' : 'audio/wav');
  res.setHeader('content-length', req.url === '/oversized.wav' ? MAX_LOCAL_AUDIO_ASSET_BYTES + 1 : sound.byteLength);
  res.end(sound);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const address = server.address(); assert.ok(address && typeof address !== 'string');
const host = '127.0.0.1:' + address.port;
await mkdir(join(providerRoot, 'specialist-audio'));
await writeFile(join(providerRoot, 'specialist-audio/provider.json'), JSON.stringify({ ...manifest, id: 'specialist-audio', label: 'Specialist URL audio', scope: 'specialized', mediaHosts: [host], models: [{ id: 'specialist-sound', name: 'Specialist sound', kind: 'audio' }] }));
await writeFile(join(providerRoot, 'specialist-audio/provider.mjs'), `export async function createGeneration({input}) { return {status:'succeeded',media:[{url:'http://${host}/'+input.prompt+'.wav'}]}; }`);
after(async () => { server.close(); server.closeAllConnections(); await rm(root, { recursive: true, force: true }); });

const { installGenerationProviders } = await import('./install.server');
const installed = installGenerationProviders(providerRoot);
const { createProject } = await import('@/core/projects/projects');
const { submitAssetFirstGeneration, preflightAssetFirstGeneration } = await import('../submit');
const { getGenerationModelDescriptor } = await import('../model-catalog');
const { getWorkspaceModelsByType } = await import('@/core/effects/workspace-models');
const { getRegisteredEffectById } = await import('@/core/effects/registered-effects');
const { listProjectGenerations, toProjectGenerationItem } = await import('@/core/effects/project-generations');
const { listProjectAssets, getProjectAssetById } = await import('@/core/workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('@/core/projects/local-project-assets');
const { syncGeneration } = await import('@/core/effects/generation-sync');
const { getGenerationModelBinding } = await import('../catalog');

const request = (projectId: string, modelId = 'procedural-sound') => ({ version: 2, projectId, mode: 'audio', modelId, prompt: 'A short calibration tone', references: [], parameters: { provider_options: { frequency: 330, seconds: .2, wave: 'triangle' } } });
async function verifyAudio(projectId: string, seconds: number) {
  const assets = await listProjectAssets({ projectId }); assert.equal(assets.length, 1);
  const asset = await getProjectAssetById({ projectId, assetId: assets[0].id }); assert.ok(asset);
  assert.equal(asset.type, 'audio'); assert.equal(asset.mimeType, 'audio/wav');
  const file = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
  const bytes = await readFile(file); assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  const probe = JSON.parse(execFileSync(process.env.VIRAL_HIT_FFPROBE || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  assert.equal(probe.streams[0].codec_type, 'audio'); assert.equal(probe.streams[0].sample_rate, '24000');
  assert.ok(Math.abs(Number(probe.format.duration) - seconds) < .01);
  return asset;
}

test('general and specialized audio models join shared discovery without visual settings', () => {
  assert.deepEqual(installed.providers.map(provider => [provider.id, provider.scope]), [['procedural-audio', 'general'], ['specialist-audio', 'specialized']]);
  assert.deepEqual(installed.problems, []);
  const descriptor = getGenerationModelDescriptor('procedural-sound');
  assert.equal(descriptor?.kind, 'audio'); assert.equal(descriptor?.controls?.length, 3);
  assert.equal(descriptor?.defaultParameters.aspect_ratio, undefined);
  assert.equal(getWorkspaceModelsByType('ai-audio').length, 3);
  assert.equal(getRegisteredEffectById(getGenerationModelBinding({ modelId: 'procedural-sound' })!.effectId)?.type, 4);
  for (const change of [{ aspectRatios: ['16:9'] }, { maxReferenceImages: 1 }, { durations: ['5s'] }])
    assert.throws(() => providerManifestSchema.parse({ ...manifest, models: [{ ...manifest.models[0], ...change }] }));
});

test('real audio bytes retain their media kind, model controls, project ownership and history after reload', async () => {
  const project = await createProject({ name: 'Independent audio' });
  const result = await submitAssetFirstGeneration({ generation: request(project.id), origin: 'mcp' });
  assert.equal(result.body.status, 'succeeded', JSON.stringify(result.body));
  const asset = await verifyAudio(project.id, .2);
  const [item] = await listProjectGenerations(project.id);
  assert.equal(item.mediaType, 'audio'); assert.equal(item.modelName, 'Procedural sound (instant)'); assert.equal(item.resultUrl, asset.publicUrl);
  assert.equal(item.aspectRatio, null); assert.equal(item.modelOptions?.values.seconds, .2);
  const foreign = await createProject({ name: 'Other audio workspace' });
  assert.equal(await getProjectAssetById({ projectId: foreign.id, assetId: asset.id }), null);
  const persisted = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import {listProjectGenerations} from './src/core/effects/project-generations.ts'; console.log(JSON.stringify(await listProjectGenerations(process.argv[1])));`, project.id], { env: { ...process.env }, encoding: 'utf8' }));
  assert.equal(persisted[0].mediaType, 'audio'); assert.equal(persisted[0].modelName, item.modelName); assert.equal(persisted[0].resultUrl, asset.publicUrl);
});

test('queued audio completes through the same sync path and repeat polling retains a single asset', async () => {
  const project = await createProject({ name: 'Queued audio' });
  const result = await submitAssetFirstGeneration({ generation: request(project.id, 'procedural-sound-queued'), origin: 'ui' });
  assert.equal(result.body.status, 'processing');
  const input = { wmTaskId: String(result.body.wmTaskId), effectId: getGenerationModelBinding({ modelId: 'procedural-sound-queued' })!.effectId };
  let sync = await syncGeneration(input);
  for (let tries = 0; tries < 45 && sync.ok && sync.generation.status === 'processing'; tries++) { await new Promise(resolve => setTimeout(resolve, 1000)); sync = await syncGeneration(input); }
  assert.ok(sync.ok); assert.equal(sync.generation.status, 'succeeded');
  await syncGeneration(input); await verifyAudio(project.id, .2);
});

test('a URL-returning specialized audio provider stores actual audio and rejects non-audio or oversized responses', async () => {
  for (const prompt of ['real', 'wrong', 'oversized']) {
    const project = await createProject({ name: 'URL audio ' + prompt });
    const result = await submitAssetFirstGeneration({ generation: { ...request(project.id, 'specialist-sound'), prompt, parameters: {} }, origin: 'mcp' });
    if (prompt === 'real') { assert.equal(result.body.status, 'succeeded'); await verifyAudio(project.id, .3); }
    else { assert.equal(result.status, 500, JSON.stringify(result)); assert.match(String(result.body.error), prompt === 'wrong' ? /audio content type/ : /too large/); assert.equal((await listProjectGenerations(project.id))[0].status, 'failed'); assert.deepEqual(await listProjectAssets({ projectId: project.id }), []); }
  }
});

test('audio admission rejects visual inputs, references and invalid options before module execution', async () => {
  const project = await createProject({ name: 'Bad audio input' });
  for (const parameters of [{ aspect_ratio: '16:9' }, { wmDuration: '5s' }, { provider_options: { frequency: -1 } }, { provider_options: { invented: true } }])
    await assert.rejects(preflightAssetFirstGeneration({ ...request(project.id), parameters }));
  await assert.rejects(preflightAssetFirstGeneration({ ...request(project.id), mode: 'image' }));
  for (const input of [{ prompt: '' }, { prompt: 'x', audio_urls: ['https://example.com/sound.wav'] }, { prompt: 'x', image_urls: ['https://example.com/image.png'] }]) assert.throws(() => validateInstalledAudioInput(input));
  const effect = { linkName: 'procedural-sound', type: 4 } as EffectRecord;
  const runtime = new InstalledProviderRuntime(manifest, 'throw Error("MUST_NOT_IMPORT");');
  assert.throws(() => new InstalledProviderAdapter(effect, runtime).createGeneration({ prompt: 'x', aspect_ratio: '1:1' }), error => !String(error).includes('MUST_NOT_IMPORT'));
  for (const result of ['{status:"succeeded",text:"not audio"}', '{status:"succeeded",media:[{data:new Uint8Array([1]),mimeType:"image/png"}]}', '{status:"succeeded",media:[{data:new Uint8Array(0),mimeType:"audio/wav"}]}']) {
    const invalid = new InstalledProviderRuntime(manifest, `export async function createGeneration(){return ${result}}`);
    assert.equal((await invalid.call('createGeneration', effect, { input: {} })).status, 'failed');
  }
  assert.deepEqual(buildOutputStoragePlan({ effectType: 4, output: { resultUrls: ['https://example.com/a.wav', 'https://example.com/b.mp3'], cover_url: 'https://example.com/cover.png' } }).map(entry => entry.type), ['audio', 'audio']);
  const removedModel = toProjectGenerationItem({ id: 'old-audio', status: 'succeeded', effectId: -1, submittedPrompt: 'old', input: { _provider: { kind: 'audio', modelId: 'uninstalled-model', name: 'Retained name' } }, output: {}, error: null, createdAt: new Date() });
  assert.equal(removedModel.mediaType, 'audio'); assert.equal(removedModel.modelName, 'Retained name');
});

test('asset preparation creates no media, pins reviewed inputs and rejects consumed intent replay', async () => {
  const { requestAssetGeneration } = await import('../asset-generation.server');
  const project = await createProject({ name: 'Prepared audio' }), generation = request(project.id);
  const prepared = await requestAssetGeneration({ action: 'prepare', generation }, 'mcp');
  assert.deepEqual(await listProjectAssets({ projectId: project.id }), []);
  assert.deepEqual(await listProjectGenerations(project.id), []);
  const submit = { action: 'submit', generation: prepared.generation, generationIntentToken: prepared.generationIntentToken, expectedDigest: prepared.digest };
  await assert.rejects(requestAssetGeneration({ ...submit, generation: { ...generation, prompt: 'Changed after review' } }, 'mcp'), /changed after preparation/);
  const result = await requestAssetGeneration(submit, 'mcp');
  assert.ok('status' in result); assert.equal(result.status, 'succeeded');
  await assert.rejects(requestAssetGeneration(submit, 'mcp'), /already submitted/);
  assert.equal((await listProjectGenerations(project.id)).length, 1);
  await verifyAudio(project.id, .2);
});

test('CLI discovers audio and uses the same prepared generation request and retained asset storage', async () => {
  const project = await createProject({ name: 'CLI audio' });
  const env = { ...process.env, VIRAL_HIT_PROVIDERS_DIR: providerRoot };
  const file = join(root, 'cli-generation.json');
  await writeFile(file, JSON.stringify({ action: 'prepare', generation: request(project.id) }));
  const args = ['--import', 'tsx', 'scripts/generation.ts'];
  const models = JSON.parse(execFileSync(process.execPath, [...args, 'models'], { env, encoding: 'utf8' }));
  assert.ok(models.some((model: { id: string; kind: string }) => model.id === 'procedural-sound' && model.kind === 'audio'));
  const prepared = JSON.parse(execFileSync(process.execPath, [...args, 'request', file], { env, encoding: 'utf8' }));
  assert.deepEqual(await listProjectGenerations(project.id), []);
  await writeFile(file, JSON.stringify({ action: 'submit', generation: prepared.generation, generationIntentToken: prepared.generationIntentToken, expectedDigest: prepared.digest }));
  const result = JSON.parse(execFileSync(process.execPath, [...args, 'request', file], { env, encoding: 'utf8' }));
  assert.equal(result.status, 'succeeded'); await verifyAudio(project.id, .2);
});
