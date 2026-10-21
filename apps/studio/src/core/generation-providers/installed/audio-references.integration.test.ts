import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { providerManifestSchema } from './manifest';
import { validateInstalledAudioInput } from './audio-input';
import { InstalledProviderRuntime, InstalledProviderAdapter } from './runtime.server';
import type { EffectRecord } from '@/core/adapters/base-adapter';

const directory = await mkdtemp(join(tmpdir(), 'vh-audio-references-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
for (const key of ['VIRAL_HIT_PROVIDERS_DIR', 'VIRAL_HIT_RUNTIME_PACKAGES_DIR', 'VIRAL_HIT_HARNESS_DB']) delete process.env[key];
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(() => rm(directory, { recursive: true, force: true }));
const providers = join(directory, 'providers');
await cp(resolve('../../examples/providers/audio-conform'), join(providers, 'audio-conform'), { recursive: true });
const manifest = providerManifestSchema.parse(JSON.parse(await readFile(join(providers, 'audio-conform/provider.json'), 'utf8')));
const mixedInputs = { image: { min: 1, max: 1 }, video: { min: 1, max: 1 }, audio: { min: 1, max: 1 } };
const mixedManifest = providerManifestSchema.parse({ ...manifest, id: 'mixed-audio', label: 'Independent mixed references', scope: 'specialized', models: [{ id: 'mixed-sound', name: 'Mixed media passthrough', kind: 'audio', referenceInputs: mixedInputs }] });
const mixedSource = `export async function createGeneration({input,media,readMedia}) {
  if(media.length!==3 || input.imageUrls.length!==1 || input.videoUrls.length!==1 || input.audioUrls.length!==1)throw Error('Missing ordered media');
  for(const [kind,url] of [['image',input.imageUrls[0]],['video',input.videoUrls[0]],['audio',input.audioUrls[0]]]) {
    const source=await readMedia(url);if(source.kind!==kind||source.bytes.length!==source.sizeBytes)throw Error('Wrong source bytes');
  }
  return {status:'succeeded',media:[{data:(await readMedia(input.audioUrls[0])).bytes,mimeType:'audio/wav'}]};
}`;
await mkdir(join(providers, 'mixed-audio'));
await writeFile(join(providers, 'mixed-audio/provider.json'), JSON.stringify(mixedManifest));
await writeFile(join(providers, 'mixed-audio/provider.mjs'), mixedSource);
const { installGenerationProviders } = await import('./install.server');
assert.deepEqual(installGenerationProviders(providers).problems, []);
const { createProject } = await import('@/core/projects/projects');
const { importLocalProjectAsset } = await import('@/core/projects/import-local-asset');
const { resolveLocalProjectAssetPath } = await import('@/core/projects/local-project-assets');
const { getProjectAssetById } = await import('@/core/workspace-lib/assets/user-assets');
const { listProjectGenerations } = await import('@/core/effects/project-generations');
const { getGenerationModelDescriptor } = await import('../model-catalog');
const { preflightAssetFirstGeneration, submitAssetFirstGeneration } = await import('../submit');
const { compileAssetFirstGenerationInput } = await import('@/core/commands/generation-compiler');
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ffprobe = process.env.VIRAL_HIT_FFPROBE || 'ffprobe';
const files = { image: join(directory, 'image.png'), video: join(directory, 'video.mp4'), audio: join(directory, 'audio.wav') };
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=80x60', '-frames:v', '1', files.image]);
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=180x320:r=10:d=1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', files.video]);
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '24000', '-c:a', 'pcm_s16le', files.audio]);
async function setup() {
  const project = await createProject({ name: 'Audio reference proof' });
  async function owned(filePath: string) { const imported = await importLocalProjectAsset({ projectId: project.id, filePath }); const asset = await getProjectAssetById({ projectId: project.id, assetId: imported.id }); assert.ok(asset); return asset; }
  const assets = { image: await owned(files.image), video: await owned(files.video), audio: await owned(files.audio) };
  const generation = { version: 2 as const, projectId: project.id, mode: 'audio' as const, modelId: 'audio-conform', prompt: 'Conform the selected soundtrack', references: [{ assetId: assets.audio.id, role: 'audio_track' as const }, { assetId: assets.video.id, role: 'source' as const }], parameters: { provider_options: { gain: .5, start: .2, seconds: 1 } } };
  return { project, assets, generation };
}
function rms(file: string) {
  const bytes = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-t', '0.5', '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-']);
  let power = 0; for (let offset = 0; offset < bytes.length; offset += 4) power += bytes.readFloatLE(offset) ** 2;
  return Math.sqrt(power / (bytes.length / 4));
}

test('declared audio reference counts are discoverable, bounded and absent on legacy text-only manifests', async () => {
  assert.deepEqual(getGenerationModelDescriptor('mixed-sound')?.referenceInputs, mixedInputs);
  assert.deepEqual(getGenerationModelDescriptor('mixed-sound')?.referenceSchema, mixedInputs);
  const legacy = providerManifestSchema.parse(JSON.parse(await readFile('../../examples/providers/procedural-audio/provider.json', 'utf8')));
  assert.equal(Object.hasOwn(legacy.models[0], 'referenceInputs'), false);
  for (const change of [{ kind: 'analysis' }, { referenceInputs: { ...mixedInputs, image: { min: 2, max: 1 } } }, { referenceInputs: { ...mixedInputs, image: { min: 0, max: 20 } } }])
    assert.throws(() => providerManifestSchema.parse({ ...mixedManifest, models: [{ ...mixedManifest.models[0], ...change }] }));
  for (const input of [{ prompt: 'x' }, { prompt: 'x', video_url: 'https://example.com/v.mp4' }, { prompt: 'x', image_urls: ['https://example.com/a'], audio_urls: ['https://example.com/a'], video_urls: ['https://example.com/v'] }]) assert.throws(() => validateInstalledAudioInput(input, mixedInputs));
  const runtime = new InstalledProviderRuntime(mixedManifest, 'throw Error("MUST_NOT_IMPORT")');
  assert.throws(() => new InstalledProviderAdapter({ linkName: 'mixed-sound', type: 4 } as EffectRecord, runtime).createGeneration({ prompt: 'x' }), error => !String(error).includes('MUST_NOT_IMPORT'));
});

test('real audio conforms to a reference video duration and selected gain without changing source bytes', async () => {
  const { project, assets, generation } = await setup();
  const original = await readFile(resolveLocalProjectAssetPath({ objectKey: assets.audio.objectKey }));
  const result = await submitAssetFirstGeneration({ generation, origin: 'mcp' }); assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
  const [item] = await listProjectGenerations(project.id);
  assert.equal(item.mediaType, 'audio'); assert.equal(item.referenceAudios.length, 1); assert.equal(item.referenceVideos.length, 1);
  assert.ok(item.referenceAudios[0].endsWith('/' + assets.audio.id)); assert.ok(item.referenceVideos[0].endsWith('/' + assets.video.id));
  const assetId = item.resultUrl!.split('/').at(-1)!;
  const output = await getProjectAssetById({ projectId: project.id, assetId }); assert.ok(output); assert.equal(output.type, 'audio');
  const file = resolveLocalProjectAssetPath({ objectKey: output.objectKey });
  const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  assert.ok(Math.abs(Number(probe.format.duration) - 1.5) < .01);
  assert.ok(Math.abs(rms(file) / rms(files.audio) - .5) < .02);
  assert.deepEqual(await readFile(resolveLocalProjectAssetPath({ objectKey: assets.audio.objectKey })), original);
});

test('independent specialized modules receive verified image, video and audio references and preserve all history kinds', async () => {
  const { project, assets, generation } = await setup();
  const result = await submitAssetFirstGeneration({ generation: { ...generation, modelId: 'mixed-sound', parameters: {}, references: [assets.image, assets.video, assets.audio].map(asset => ({ assetId: asset.id, role: 'source' })) }, origin: 'cli' });
  assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
  const [item] = await listProjectGenerations(project.id);
  assert.deepEqual([item.referenceImages.length, item.referenceVideos.length, item.referenceAudios.length], [1, 1, 1]);
  const output = await getProjectAssetById({ projectId: project.id, assetId: item.resultUrl!.split('/').at(-1)! }); assert.ok(output);
  assert.equal(createHash('sha256').update(await readFile(resolveLocalProjectAssetPath({ objectKey: output.objectKey }))).digest('hex'), assets.audio.sha256);
});

test('missing or foreign references, forged media roles and changed source bytes fail before generation history', async () => {
  const { project, assets, generation } = await setup();
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, references: [] }), /Audio requires/);
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, references: [{ assetId: assets.video.id, role: 'audio_track' }] }), /not an audio track/);
  const other = await createProject({ name: 'Foreign audio project' });
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, projectId: other.id }), /local project media/);
  const path = resolveLocalProjectAssetPath({ objectKey: assets.audio.objectKey }), original = await readFile(path), changed = Buffer.from(original); changed[changed.length - 1] ^= 1;
  await writeFile(path, changed); await assert.rejects(preflightAssetFirstGeneration(generation), /content changed/); await writeFile(path, original);
  assert.deepEqual(await listProjectGenerations(project.id), []);
});

test('queued audio reads sources only on creation and observes its original task after runtime recreation', async () => {
  const { project, generation } = await setup();
  const prepared = await preflightAssetFirstGeneration(generation); assert.ok(prepared.preparedReferences);
  const input = await compileAssetFirstGenerationInput({ ...prepared.preparedReferences, generationIntentId: '' });
  const bytes = await readFile(files.audio);
  const source = `export async function createGeneration({input,readMedia}){await readMedia(input.audioUrls[0]);return {status:'processing',taskId:'retained-audio-job'};} export async function checkStatus({taskId,readMedia}){if(taskId!=='retained-audio-job'||readMedia)throw Error('Wrong recovery');return {status:'succeeded',media:[{data:new Uint8Array(Buffer.from('${bytes.toString('base64')}','base64')),mimeType:'audio/wav'}]};}`;
  const effect = { linkName: 'audio-conform', type: 4 } as EffectRecord;
  const runtime = new InstalledProviderRuntime(manifest, source);
  const queued = await new InstalledProviderAdapter(effect, runtime).createGeneration({ ...input, _referenceProjectId: project.id });
  assert.equal(queued.status, 'processing');
  const finished = await new InstalledProviderRuntime(manifest, source).call('checkStatus', effect, { taskId: 'retained-audio-job' });
  assert.equal(finished.status, 'succeeded');
});
