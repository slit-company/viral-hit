import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

const directory = await mkdtemp(join(tmpdir(), 'vh-image-layers-test-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
delete process.env.VIRAL_HIT_HARNESS_DB;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => rm(directory, { recursive: true, force: true }));
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { changeImageLayers, StackConflictError } = await import('./service.server');
const { zipStack } = await import('./render.server');
type Stack = import('./contract').ImageLayerStack;

/** A PNG of one color; alpha below 255 makes it see-through. */
const png = (name: string, color: string, size: string) => {
  const file = join(directory, name);
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=' + color + ':s=' + size + ',format=rgba', '-frames:v', '1', '-pix_fmt', 'rgba', file]);
  return file;
};
const rgba = (file: string, width: number, x: number, y: number) => {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { maxBuffer: 16 * 1024 * 1024 });
  return [...raw.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
};
const near = (actual: number[], expected: number[]) => assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 3), JSON.stringify(actual) + ' should be ' + JSON.stringify(expected));

test('a layer stack reorders, hides, moves and scales real images, flattens them with transparency and exports every layer', { timeout: 60_000 }, async () => {
  const project = await createProject({ name: 'Image layers' });
  const ids: Record<string, string> = {};
  for (const [key, color, size] of [['sky', '0x0000ff', '200x100'], ['cloud', '0xffffff@0.5', '100x100'], ['sun', '0xff0000', '40x40'], ['moon', '0x00ff00', '40x40']] as const)
    ids[key] = (await importLocalProjectAsset({ projectId: project.id, filePath: png(key + '.png', color, size) })).id;
  const { stack: created } = await changeImageLayers(project.id, { action: 'create', assetIds: [ids.sky, ids.cloud, ids.sun], name: 'Poster' }) as { stack: Stack };
  assert.deepEqual([created.width, created.height, created.revision, created.layers.map(layer => [layer.name, layer.width, layer.height])],
    [200, 100, 1, [['Layer 1', 200, 100], ['Layer 2', 100, 100], ['Layer 3', 40, 40]]]);
  // Move the sun to the right half at half size and half opacity; hide nothing yet; swap the cloud for the moon later.
  const [sky, cloud, sun] = created.layers;
  const { stack: edited } = await changeImageLayers(project.id, { action: 'update', stackId: created.id, revision: 1, name: 'Poster v2',
    layers: [sky, { ...cloud, x: 0.25 }, { ...sun, x: 0.75, y: 0.25, scale: 0.5, opacity: 0.5 }].map(({ width: _w, height: _h, ...layer }) => layer) }) as { stack: Stack };
  assert.equal(edited.revision, 2);
  await assert.rejects(changeImageLayers(project.id, { action: 'update', stackId: created.id, revision: 1, layers: [sky].map(({ width: _w, height: _h, ...layer }) => layer) }), StackConflictError);
  const flat = await changeImageLayers(project.id, { action: 'flatten', stackId: created.id }) as { assetId: string };
  const asset = (await getProjectAssetById({ projectId: project.id, assetId: flat.assetId }))!;
  const file = resolveLocalProjectAssetPath({ objectKey: asset.objectKey! });
  near(rgba(file, 200, 10, 50), [0, 0, 255, 255]); // sky alone
  near(rgba(file, 200, 75, 50), [128, 128, 255, 255]); // half-white cloud over the sky
  near(rgba(file, 200, 160, 30), [128, 0, 128, 255]); // half-opacity sun, 20 px square at (150, 25)
  near(rgba(file, 200, 175, 30), [0, 0, 255, 255]); // right of the scaled sun
  assert.equal((await changeImageLayers(project.id, { action: 'flatten', stackId: created.id }) as { assetId: string }).assetId, flat.assetId, 'same stack, same image');
  // Hide the sky and replace the cloud with the moon: the rest of the canvas stays transparent.
  const { stack: swapped } = await changeImageLayers(project.id, { action: 'update', stackId: created.id, revision: 2,
    layers: [{ ...edited.layers[0], visible: false }, { ...edited.layers[1], assetId: ids.moon, x: 0, y: 0 }, edited.layers[2]].map(({ width: _w, height: _h, ...layer }) => layer) }) as { stack: Stack };
  assert.deepEqual([swapped.layers[1].width, swapped.layers[1].height], [40, 40]);
  const clear = await changeImageLayers(project.id, { action: 'flatten', stackId: created.id }) as { assetId: string };
  const clearFile = resolveLocalProjectAssetPath({ objectKey: (await getProjectAssetById({ projectId: project.id, assetId: clear.assetId }))!.objectKey! });
  near(rgba(clearFile, 200, 10, 10), [0, 255, 0, 255]);
  near(rgba(clearFile, 200, 100, 80), [0, 0, 0, 0]);
  const zipPath = join(directory, 'stack.zip');
  await zipStack(project.id, swapped, zipPath, AbortSignal.timeout(30_000));
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  assert.deepEqual(Object.keys(zip.files).sort(), ['01-Layer-1.png', '02-Layer-2.png', '03-Layer-3.png', 'README.txt', 'stack.json']);
  const placed = JSON.parse(await zip.file('stack.json')!.async('string'));
  assert.deepEqual(placed.layers.map((layer: { visible: boolean; left: number; top: number; width: number }) => [layer.visible, layer.left, layer.top, layer.width]), [[false, 0, 0, 200], [true, 0, 0, 40], [true, 150, 25, 20]]);
  assert.deepEqual((await changeImageLayers(project.id, { action: 'list' }) as { stacks: Array<{ name: string; layerCount: number }> }).stacks.map(item => [item.name, item.layerCount]), [['Poster v2', 3]]);
  await changeImageLayers(project.id, { action: 'delete', stackId: created.id });
  assert.ok(await getProjectAssetById({ projectId: project.id, assetId: clear.assetId }), 'flattened images stay');
});
