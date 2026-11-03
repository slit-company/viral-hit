import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { probeMedia } from '../harness/probe-media';
import { LOCAL_PROJECT_ASSET_BUCKET, LOCAL_PROJECT_ASSET_PROVIDER, persistLocalProjectAsset, removePersistedLocalProjectAsset, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { deleteUserAssetById, getProjectAssetById, linkProjectAsset, recordUserAsset } from '../workspace-lib/assets/user-assets';
import { layerBox, type ImageLayerStack } from './contract';

const execute = promisify(execFile);
const MAX_SIDE = 8192;
const safeName = (value: string) => value.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'layers';

/** A layer's image file and pixel size; layers must be images stored in this project. */
export async function layerImage(projectId: string, assetId: string, signal: AbortSignal) {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || asset.type !== 'image' || asset.bucket !== LOCAL_PROJECT_ASSET_BUCKET || !asset.objectKey) throw Error('Layers must be images in this project');
  const path = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
  const { width, height } = await probeMedia(path, 'image', signal);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) throw Error('Layer images must be at most ' + MAX_SIDE + ' pixels on each side');
  return { path, width, height, mimeType: asset.mimeType ?? 'image/png' };
}

/** Renders the visible layers, bottom first, onto a transparent canvas as one PNG project image. The same stack always gives the same image. */
export async function flattenStack(projectId: string, stack: ImageLayerStack, signal: AbortSignal) {
  const visible = stack.layers.filter(layer => layer.visible && layer.opacity > 0);
  if (!visible.length) throw Error('Show at least one layer to save an image');
  const assetId = 'layers-' + createHash('sha256').update([projectId, stack.id, String(stack.revision), JSON.stringify(stack.layers)].join('\0')).digest('hex').slice(0, 32);
  if (await getProjectAssetById({ projectId, assetId })) return assetId;
  const files = await Promise.all(visible.map(layer => layerImage(projectId, layer.assetId, signal)));
  const filters = ['[0:v]format=rgba[b0]'];
  visible.forEach((layer, index) => {
    const box = layerBox(layer, stack);
    filters.push('[' + (index + 1) + ':v]format=rgba,scale=' + box.width + ':' + box.height + ',colorchannelmixer=aa=' + layer.opacity.toFixed(3) + '[l' + (index + 1) + ']',
      '[b' + index + '][l' + (index + 1) + ']overlay=x=' + box.left + ':y=' + box.top + ':format=rgb' + (index === visible.length - 1 ? ',format=rgba[out]' : '[b' + (index + 1) + ']'));
  });
  const directory = await mkdtemp(join(tmpdir(), 'vh-layers-'));
  try {
    const output = join(directory, 'flat.png');
    await execute(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black@0:s=' + stack.width + 'x' + stack.height + ',format=rgba',
      ...files.flatMap(file => ['-i', file.path]), '-filter_complex', filters.join(';'), '-map', '[out]', '-frames:v', '1', '-c:v', 'png', output],
    { signal, timeout: 120_000, maxBuffer: 1024 * 1024 });
    const persisted = await persistLocalProjectAsset({ projectId, assetId, mimeType: 'image/png', bytes: new Uint8Array(await readFile(output)), filename: safeName(stack.name) + '.png' });
    try {
      const metadata = { operation: 'image_layers_flatten', stackId: stack.id, revision: stack.revision };
      const id = await recordUserAsset({
        id: persisted.assetId, type: 'image', source: 'derived', bucket: LOCAL_PROJECT_ASSET_BUCKET, objectKey: persisted.objectKey, publicUrl: persisted.publicUrl,
        mimeType: 'image/png', sizeBytes: persisted.sizeBytes, sha256: persisted.sha256, filename: persisted.filename, storageProvider: LOCAL_PROJECT_ASSET_PROVIDER,
        assetClass: 'derived', originProjectId: projectId, width: stack.width, height: stack.height, metadata,
      });
      await linkProjectAsset({ projectId, assetId: id, role: 'generated', assetRole: 'layers_flatten', metadata });
      return id;
    } catch (error) {
      await deleteUserAssetById(persisted.assetId).catch(() => undefined);
      await removePersistedLocalProjectAsset(persisted.filePath);
      throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Every layer image unchanged, numbered bottom first, with stack.json giving each one's place on the canvas. */
export async function zipStack(projectId: string, stack: ImageLayerStack, outputPath: string, signal: AbortSignal) {
  const zip = new JSZip(), placed = [];
  for (const [index, layer] of stack.layers.entries()) {
    const file = await layerImage(projectId, layer.assetId, signal);
    const name = String(index + 1).padStart(2, '0') + '-' + safeName(layer.name) + '.' + (EXTENSIONS[file.mimeType] ?? 'png');
    zip.file(name, createReadStream(file.path));
    placed.push({ file: name, name: layer.name, visible: layer.visible, opacity: layer.opacity, ...layerBox(layer, stack) });
  }
  zip.file('stack.json', JSON.stringify({ name: stack.name, width: stack.width, height: stack.height, order: 'bottom first', layers: placed }, null, 2) + '\n');
  zip.file('README.txt', [stack.name + ': image layers exported by Viral Hit.', 'Files are numbered from the bottom layer up. stack.json gives each layer\'s position (left, top) and size in pixels on a ' + stack.width + 'x' + stack.height + ' canvas, its opacity and whether it is shown.', ''].join('\n'));
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputPath, { flags: 'wx' });
    output.on('finish', () => resolve()).on('error', reject);
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'STORE' }).on('error', reject).pipe(output);
  });
  return safeName(stack.name) + '-layers.zip';
}
