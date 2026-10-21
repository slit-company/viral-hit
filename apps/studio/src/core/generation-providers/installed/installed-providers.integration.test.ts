import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

const directory = await mkdtemp(join(tmpdir(), 'viral-hit-providers-test-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });

// An operator folder: the bundled example, a provider whose module returns an unlisted URL, and two broken ones.
const providers = join(directory, 'providers');
await cp(resolve('../../examples/providers/procedural-images'), join(providers, 'procedural-images'), { recursive: true });
const example = JSON.parse(await readFile(join(providers, 'procedural-images', 'provider.json'), 'utf8'));
const folder = async (id: string, manifest: unknown, module = '') => {
  await mkdir(join(providers, id), { recursive: true });
  await writeFile(join(providers, id, 'provider.json'), JSON.stringify(manifest));
  if (module) await writeFile(join(providers, id, 'provider.mjs'), module);
};
const model = { id: 'leaky-image', name: 'Leaky', kind: 'image', aspectRatios: ['1:1'] };
await folder('leaky', { ...example, id: 'leaky', label: 'Leaky', mediaHosts: ['media.example.com'], models: [model] }, "export async function createGeneration() { return { status: 'succeeded', media: [{ url: 'https://attacker.example.net/x.png' }] }; }");
await folder('copycat', { ...example, id: 'copycat', models: [{ ...model, id: 'nano-banana-pro' }] }, 'export async function createGeneration() {}');
await folder('broken', { ...example, id: 'broken', scope: 'everything' }, 'export async function createGeneration() {}');

await folder('analysis-fixture', { ...example, id: 'analysis-fixture', label: 'Independent analysis', scope: 'specialized', models: [
  { id: 'independent-analysis', name: 'Review fixture', kind: 'analysis' },
  { id: 'queued-analysis', name: 'Queued review fixture', kind: 'analysis' },
] }, `export async function createGeneration({model,input}) {
  if (!input.videoUrl || input.analysisDepth !== 'deep' || input.maxOutputTokens !== 4096) throw Error('Lost analysis input');
  return model.id === 'queued-analysis' ? {status:'processing',taskId:'review-42'} : {status:'succeeded',text:'Protocol fixture: ' + input.prompt};
} export async function checkStatus({taskId}) { if(taskId!=='review-42') throw Error('Wrong task'); return {status:'succeeded',text:'Queued protocol fixture; no visual inspection.'}; }`);
await folder('analysis-copycat', { ...example, id: 'analysis-copycat', models: [{ id: 'video-analysis', name: 'Collision', kind: 'analysis' }] }, 'export async function createGeneration() {}');

const { installGenerationProviders } = await import('./install.server');
const installed = installGenerationProviders(providers);
const { createProject } = await import('@/core/projects/projects');
const { submitAssetFirstGeneration } = await import('../submit');
const { listGenerationModelDescriptors } = await import('../model-catalog');
const { getGenerationModelBinding } = await import('../catalog');
const { getWorkspaceModelsByType } = await import('@/core/effects/workspace-models');
const { getGenerationById } = await import('@/core/effects/record-generation');
const { listProjectAssets } = await import('@/core/workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('@/core/projects/local-project-assets');
const ffprobe = process.env.VIRAL_HIT_FFPROBE || 'ffprobe';

const request = (projectId: string, modelId: string, prompt: string) => ({ version: 2, projectId, modelId, mode: 'image', prompt, references: [], parameters: { aspect_ratio: '16:9' } });
const pngSize = async (projectId: string) => {
  const assets = await listProjectAssets({ projectId });
  assert.equal(assets.length, 1);
  const [asset] = assets as Array<{ id: string; type: string }>;
  const { getProjectAssetById } = await import('@/core/workspace-lib/assets/user-assets');
  const stored = await getProjectAssetById({ projectId, assetId: asset.id });
  return execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', resolveLocalProjectAssetPath({ objectKey: stored!.objectKey })], { encoding: 'utf8' }).trim();
};

test('an installed provider adds its models next to the built-in ones and reports broken folders', () => {
  assert.deepEqual(installed.providers.map(item => [item.id, item.scope]), [['analysis-fixture', 'specialized'], ['leaky', 'general'], ['procedural-images', 'general']]);
  assert.deepEqual(installed.problems.map(item => item.location), ['analysis-copycat', 'broken', 'copycat']);
  assert.match(installed.problems.find(item => item.location === 'copycat')!.message, /already used/);
  const descriptors = listGenerationModelDescriptors();
  assert.equal(descriptors.find(item => item.id === 'procedural-gradient')?.providerId, 'procedural-images');
  assert.equal(descriptors.find(item => item.id === 'nano-banana-pro')?.providerId, 'cloud-api');
  const option = getWorkspaceModelsByType('ai-image').find(item => item.id === 'procedural-gradient');
  assert.deepEqual([option?.name, option?.maxReferenceImages, option?.supportedAspectRatios?.includes('16:9')], ['Gradient (instant)', 0, true]);
  assert.equal(installGenerationProviders(providers), installed);
});

test('generation through an installed provider saves the returned image as a project asset', async () => {
  const project = await createProject({ name: 'Instant provider' });
  const result = await submitAssetFirstGeneration({ generation: request(project.id, 'procedural-gradient', 'A fox at dawn'), origin: 'mcp' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status, 'succeeded');
  assert.equal(await pngSize(project.id), 'png,640,360');
});

test('a queued provider task is finished by the background status poller, like a hosted API', { timeout: 60_000 }, async () => {
  const project = await createProject({ name: 'Queued provider' });
  const result = await submitAssetFirstGeneration({ generation: request(project.id, 'procedural-gradient-queued', 'A fox at night'), origin: 'ui' });
  assert.equal(result.body.status, 'processing');
  const effectId = getGenerationModelBinding({ modelId: 'procedural-gradient-queued' })!.effectId;
  let status = 'processing';
  for (let waited = 0; waited < 45_000 && status !== 'succeeded' && status !== 'failed'; waited += 1000) {
    await new Promise(done => setTimeout(done, 1000));
    status = (await getGenerationById({ id: String(result.body.wmTaskId), effectId }))?.status ?? 'missing';
  }
  assert.equal(status, 'succeeded');
  assert.equal(await pngSize(project.id), 'png,640,360');
});

test('a result URL outside the provider media hosts fails the generation without downloading it', async () => {
  const project = await createProject({ name: 'Leaky provider' });
  const result = await submitAssetFirstGeneration({ generation: { ...request(project.id, 'leaky-image', 'A fox'), parameters: { aspect_ratio: '1:1' } }, origin: 'mcp' });
  assert.equal(result.body.status, 'failed');
  assert.match(String(result.body.error), /not listed in mediaHosts/);
  assert.deepEqual(await listProjectAssets({ projectId: project.id }), []);
});


test('simultaneous generations returning identical bytes each retain their project asset', async () => {
  const projects = await Promise.all(Array.from({ length: 4 }, (_, index) => createProject({ name: 'Same media ' + index })));
  const results = await Promise.all(projects.map(project => submitAssetFirstGeneration({ generation: request(project.id, 'procedural-gradient', 'An identical concurrent sunset'), origin: 'mcp' })));
  for (const result of results) assert.equal(result.body.status, 'succeeded', JSON.stringify(result.body));
  for (const project of projects) assert.equal(await pngSize(project.id), 'png,640,360');
});

const { recordUserAsset, linkProjectAsset } = await import('@/core/workspace-lib/assets/user-assets');
const { listProjectGenerations } = await import('@/core/effects/project-generations');
const { preflightAssetFirstGeneration } = await import('../submit');
async function analysisRequest(modelId: string) {
  const project = await createProject({ name: 'Independent analysis' });
  const assetId = await recordUserAsset({ type: 'video', source: 'upload', bucket: 'test', objectKey: project.id + '.mp4', publicUrl: 'https://media.example.com/source.mp4', originProjectId: project.id });
  await linkProjectAsset({ projectId: project.id, assetId, role: 'upload' });
  return { version: 2, projectId: project.id, modelId, mode: 'analysis', prompt: 'Review continuity', references: [{ assetId, role: 'reference' }], parameters: { analysis_depth: 'deep', max_output_tokens: 4096 } };
}

test('independent analysis discovers, validates and persists text without a media output', async () => {
  const descriptor = listGenerationModelDescriptors().find(item => item.id === 'independent-analysis');
  assert.equal(descriptor?.kind, 'analysis'); assert.equal(descriptor?.name, 'Review fixture');
  const request = await analysisRequest('independent-analysis');
  const result = await submitAssetFirstGeneration({ generation: request, origin: 'mcp' });
  assert.equal(result.body.status, 'succeeded', JSON.stringify(result.body));
  const [item] = await listProjectGenerations(request.projectId);
  assert.equal(item.mediaType, 'analysis'); assert.equal(item.modelName, 'Review fixture');
  assert.equal(item.resultText, 'Protocol fixture: Review continuity'); assert.equal(item.resultUrl, null);
  assert.deepEqual([...new Set((await listProjectAssets({ projectId: request.projectId })).map((asset: { id: string }) => asset.id))], [request.references[0].assetId]);
  for (const bad of [{ ...request, references: [] }, { ...request, parameters: { max_output_tokens: 99999 } }, { ...request, mode: 'video' }]) {
    await assert.rejects(preflightAssetFirstGeneration(bad));
  }
  assert.equal((await listProjectGenerations(request.projectId)).length, 1);
});

test('queued independent analysis retains its model and source through background completion', { timeout: 60_000 }, async () => {
  const request = await analysisRequest('queued-analysis');
  const result = await submitAssetFirstGeneration({ generation: request, origin: 'ui' });
  assert.equal(result.body.status, 'processing', JSON.stringify(result.body));
  let item;
  for (let i = 0; i < 45; i++) {
    [item] = await listProjectGenerations(request.projectId);
    if (item.status === 'succeeded' || item.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(item?.status, 'succeeded'); assert.equal(item?.modelId, 'queued-analysis');
  assert.equal(item?.resultText, 'Queued protocol fixture; no visual inspection.');
  assert.deepEqual(item?.referenceVideos, ['https://media.example.com/source.mp4']);
});


test('the same public URL in another project does not grant its asset membership to this analysis', async () => {
  const first = await analysisRequest('independent-analysis');
  const second = await analysisRequest('independent-analysis');
  const result = await submitAssetFirstGeneration({ generation: second, origin: 'mcp' });
  assert.equal(result.body.status, 'succeeded');
  const ids = [...new Set((await listProjectAssets({projectId:second.projectId})).map((asset: {id:string}) => asset.id))];
  assert.deepEqual(ids, [second.references[0].assetId]);
  assert.ok(!ids.includes(first.references[0].assetId));
});
