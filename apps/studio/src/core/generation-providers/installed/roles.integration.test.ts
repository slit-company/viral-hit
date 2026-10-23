import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { providerManifestSchema } from './manifest';
import { providerInput } from './runtime.server';

const directory = await mkdtemp(join(tmpdir(), 'vh-roles-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
for (const key of ['VIRAL_HIT_PROVIDERS_DIR', 'VIRAL_HIT_RUNTIME_PACKAGES_DIR', 'VIRAL_HIT_HARNESS_DB']) delete process.env[key];
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(() => rm(directory, { recursive: true, force: true }));
const providers = join(directory, 'providers');
for (const name of ['role-collage', 'procedural-images']) await cp(resolve('../../examples/providers/' + name), join(providers, name), { recursive: true });
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
const files = { red: join(directory, 'red.png'), blue: join(directory, 'blue.png') };
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1', files.red]);
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x64', '-frames:v', '1', files.blue]);
const pixel = (path: string, x: number, y: number) => [...execFileSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', 'crop=4:4:' + x + ':' + y + ',scale=1:1', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])];

async function run(subject: 'red' | 'blue') {
  const project = await createProject({ name: 'Roles ' + subject });
  const red = await importLocalProjectAsset({ projectId: project.id, filePath: files.red }), blue = await importLocalProjectAsset({ projectId: project.id, filePath: files.blue });
  const [subjectAsset, styleAsset] = subject === 'red' ? [red, blue] : [blue, red];
  const generation = { version: 2 as const, projectId: project.id, mode: 'image' as const, modelId: 'subject-on-style', prompt: 'Place the subject on the style', parameters: { aspect_ratio: '1:1' },
    references: [{ assetId: styleAsset.id, role: 'style' as const }, { assetId: subjectAsset.id, role: 'subject' as const }] };
  const result = await submitAssetFirstGeneration({ generation, origin: 'mcp' });
  assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
  const [item] = await listProjectGenerations(project.id);
  const asset = await getProjectAssetById({ projectId: project.id, assetId: item.resultUrl!.split('/').at(-1)! });
  return { path: resolveLocalProjectAssetPath({ objectKey: asset!.objectKey }) };
}

test('declared roles are public metadata and analysis models cannot declare them', async () => {
  assert.deepEqual(getGenerationModelDescriptor('subject-on-style')?.referenceRoles, ['subject', 'style']);
  assert.equal(getGenerationModelDescriptor('procedural-gradient')?.referenceRoles, undefined);
  const manifest = providerManifestSchema.parse(JSON.parse(await readFile(join(providers, 'role-collage/provider.json'), 'utf8')));
  assert.throws(() => providerManifestSchema.parse({ ...manifest, models: [{ ...manifest.models[0], referenceRoles: ['subject', 'subject'] }] }), /unique/);
  assert.throws(() => providerManifestSchema.parse({ ...manifest, models: [{ id: 'review', name: 'Review', kind: 'analysis', referenceRoles: ['style'] }] }), /reference roles/);
});

test('the provider receives each reference with its role, so swapping roles swaps the image', async () => {
  const first = await run('red'), second = await run('blue');
  const [center, corner] = [pixel(first.path, 254, 254), pixel(first.path, 8, 8)];
  assert.ok(center[0] > 240 && center[2] < 20, 'red subject in the center: ' + center);
  assert.ok(corner[2] > 200 && corner[0] < 40, 'blurred blue style at the edge: ' + corner);
  const [swappedCenter, swappedCorner] = [pixel(second.path, 254, 254), pixel(second.path, 8, 8)];
  assert.ok(swappedCenter[2] > 240 && swappedCenter[0] < 20, String(swappedCenter));
  assert.ok(swappedCorner[0] > 200 && swappedCorner[2] < 40, String(swappedCorner));
  const input = providerInput({ prompt: 'x', image_urls: ['https://a.example/1', 'https://a.example/2'], reference_roles: [{ url: 'https://a.example/2', role: 'subject' }, { url: 'https://a.example/1', role: 'style' }] });
  assert.deepEqual(input.references, [{ url: 'https://a.example/2', role: 'subject' }, { url: 'https://a.example/1', role: 'style' }]);
});

test('undeclared specific roles are rejected before generation history', async () => {
  const project = await createProject({ name: 'Undeclared roles' });
  const red = await importLocalProjectAsset({ projectId: project.id, filePath: files.red });
  await assert.rejects(preflightAssetFirstGeneration({ version: 2, projectId: project.id, mode: 'image', modelId: 'subject-on-style', prompt: 'x', parameters: { aspect_ratio: '1:1' }, references: [{ assetId: red.id, role: 'pose' }] }), /does not use pose/);
  assert.deepEqual(await listProjectGenerations(project.id), []);
});

