import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { providerManifestSchema } from './manifest';

const directory = await mkdtemp(join(tmpdir(), 'vh-masks-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
for (const key of ['VIRAL_HIT_PROVIDERS_DIR', 'VIRAL_HIT_RUNTIME_PACKAGES_DIR', 'VIRAL_HIT_HARNESS_DB']) delete process.env[key];
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(() => rm(directory, { recursive: true, force: true }));
const providers = join(directory, 'providers');
await cp(resolve('../../examples/providers/masked-edit'), join(providers, 'masked-edit'), { recursive: true });
await cp(resolve('../../examples/providers/procedural-images'), join(providers, 'procedural-images'), { recursive: true });
const manifest = providerManifestSchema.parse(JSON.parse(await readFile(join(providers, 'masked-edit/provider.json'), 'utf8')));
const { installGenerationProviders } = await import('./install.server');
assert.deepEqual(installGenerationProviders(providers).problems, []);
const { createProject } = await import('@/core/projects/projects');
const { importLocalProjectAsset } = await import('@/core/projects/import-local-asset');
const { resolveLocalProjectAssetPath } = await import('@/core/projects/local-project-assets');
const { getProjectAssetById } = await import('@/core/workspace-lib/assets/user-assets');
const { listProjectGenerations } = await import('@/core/effects/project-generations');
const { getGenerationModelDescriptor } = await import('../model-catalog');
const { preflightAssetFirstGeneration, submitAssetFirstGeneration } = await import('../submit');
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';

// Source: red left half, blue right half. Mask: white top-left quarter, drawn at a quarter of the source size.
const files = { source: join(directory, 'source.png'), mask: join(directory, 'mask.png'), video: join(directory, 'clip.mp4') };
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=80x80[l];color=blue:s=80x80[r];[l][r]hstack', '-frames:v', '1', files.source]);
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=40x20,drawbox=x=0:y=0:w=20:h=10:color=white:t=fill', '-frames:v', '1', files.mask]);
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=green:s=64x64:r=10:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', files.video]);
const pixel = (path: string, x: number, y: number) => [...execFileSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', `crop=4:4:${x}:${y},scale=1:1`, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])];

async function setup() {
  const project = await createProject({ name: 'Masked edit' });
  const [source, mask, video] = await Promise.all(Object.values(files).map(filePath => importLocalProjectAsset({ projectId: project.id, filePath })));
  const generation = { version: 2 as const, projectId: project.id, mode: 'image' as const, modelId: 'masked-image-edit', prompt: 'Fill the marked corner',
    parameters: { aspect_ratio: 'auto', provider_options: { effect: 'fill', strength: 16, color: 'white' } },
    references: [{ assetId: source.id, role: 'source' as const }, { assetId: mask.id, role: 'mask' as const }] };
  return { project, source, mask, video, generation };
}

test('mask declarations are public metadata and only valid for visual models with a target reference', () => {
  assert.deepEqual(getGenerationModelDescriptor('masked-image-edit')?.maskInput, { required: true });
  assert.equal(getGenerationModelDescriptor('procedural-gradient')?.maskInput, undefined);
  const model = manifest.models[0];
  for (const change of [{ kind: 'audio', aspectRatios: [] }, { referenceInputs: { image: { min: 0, max: 0 }, video: { min: 0, max: 0 }, audio: { min: 1, max: 1 } } }])
    assert.throws(() => providerManifestSchema.parse({ ...manifest, models: [{ ...model, ...change }] }), /mask/);
});

test('the marked area changes and the rest of the original stays identical', async () => {
  const { project, source, mask, generation } = await setup();
  const result = await submitAssetFirstGeneration({ generation, origin: 'mcp' });
  assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
  const [item] = await listProjectGenerations(project.id);
  const output = await getProjectAssetById({ projectId: project.id, assetId: item.resultUrl!.split('/').at(-1)! });
  assert.ok(output);
  const path = resolveLocalProjectAssetPath({ objectKey: output.objectKey });
  // Mask covers x 0-79, y 0-39 at source scale.
  const filled = pixel(path, 20, 10);
  assert.ok(filled.every(value => value > 245), String(filled));
  const keptRed = pixel(path, 20, 60), keptBlue = pixel(path, 120, 20);
  assert.ok(keptRed[0] > 240 && keptRed[1] < 15 && keptRed[2] < 15, String(keptRed));
  assert.ok(keptBlue[2] > 240 && keptBlue[0] < 15, String(keptBlue));
  for (const asset of [source, mask]) {
    const stored = await getProjectAssetById({ projectId: project.id, assetId: asset.id });
    assert.deepEqual(await readFile(resolveLocalProjectAssetPath({ objectKey: stored!.objectKey })), await readFile(asset.id === source.id ? files.source : files.mask));
  }
});

test('unsupported, missing, duplicate and wrong-kind masks fail before generation history', async () => {
  const { project, source, mask, video, generation } = await setup();
  const procedural = { ...generation, modelId: 'procedural-gradient', parameters: { aspect_ratio: '1:1' } };
  await assert.rejects(preflightAssetFirstGeneration(procedural), /does not accept a mask/);
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, references: [generation.references[0]] }), /needs a mask/);
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, references: [...generation.references, { assetId: source.id, role: 'mask' }] }), /one mask/);
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, references: [{ assetId: mask.id, role: 'source' }, { assetId: mask.id, role: 'mask' }] }), /separate image/);
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, references: [{ assetId: mask.id, role: 'mask' }] }), /applies to/);
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, references: [generation.references[0], { assetId: video.id, role: 'mask' }] }), /must be an image/);
  assert.deepEqual(await listProjectGenerations(project.id), []);
});

test('a durable recipe passes the mask role through to the installed model', async () => {
  const { project, source, mask } = await setup();
  const { DurableHarness } = await import('@/core/harness/durable');
  const { pinRuntimePlan } = await import('@/core/harness/runtime-plan');
  const { createRuntimeAdapters } = await import('@/core/harness/adapters');
  const plan = await pinRuntimePlan({ projectId: project.id, nodes: [{ id: 'edit', operation: 'generation.model', version: '1', input: {
    schemaVersion: 1, mode: 'image', modelId: 'masked-image-edit', prompt: 'Pixelate the marked corner',
    parameters: { aspect_ratio: 'auto', provider_options: { effect: 'pixelate', strength: 8, color: 'white' } },
    references: [{ assetId: source.id, kind: 'image', role: 'source' }, { assetId: mask.id, kind: 'image', role: 'mask' }] } }] });
  let now = Date.now();
  const harness = new DurableHarness(join(directory, 'harness.sqlite'), () => now);
  try {
    const run = harness.enqueue(plan, 'masked-recipe');
    for (let i = 0; i < 6; i++) { now += 25_000; await harness.step(run, createRuntimeAdapters()); }
    const [job] = harness.jobs(run);
    assert.equal(job.state, 'succeeded', job.error ?? '');
    const result = JSON.parse(job.output_json!);
    assert.equal(result.kind, 'image');
    assert.deepEqual([result.width, result.height], [160, 80]);
  } finally { harness.close(); }
});
