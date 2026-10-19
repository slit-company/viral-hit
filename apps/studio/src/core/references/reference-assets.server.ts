import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, link, lstat, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getActiveProject } from '../projects/projects';
import { buildLocalProjectAssetUrl, createLocalProjectAssetObjectKey, LOCAL_PROJECT_ASSET_BUCKET,
  LOCAL_PROJECT_ASSET_PROVIDER, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { getProjectAssetById, linkProjectAsset, recordUserAsset } from '../workspace-lib/assets/user-assets';
import { fileHash } from '../harness/media-files';
import { probeMedia, type MediaInfo } from '../harness/probe-media';

export const REFERENCE_MAX_BYTES = 256 * 1024 * 1024;
export type ReferenceSource = 'youtube' | 'instagram-direct' | 'local';
export type ReferenceAsset = { assetId: string; sha256: string; sizeBytes: number; kind: 'video' | 'image';
  publicUrl: string; width: number; height: number; durationMs: number | null; hasAudio: boolean };
export function referenceIdentity(projectId: string, source: ReferenceSource, key: string, role: string) {
  return `vh-ref-${createHash('sha256').update(JSON.stringify([projectId, source, key, role])).digest('hex')}`;
}
export function referenceFile(projectId: string, assetId: string) {
  const objectKey = createLocalProjectAssetObjectKey({ projectId, assetId, filename: 'reference.bin' });
  return { objectKey, path: resolveLocalProjectAssetPath({ objectKey }) };
}
async function inspect(file: string, kind: 'video' | 'image', signal: AbortSignal): Promise<MediaInfo> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > (kind === 'image' ? 4 * 1024 * 1024 : REFERENCE_MAX_BYTES)) {
    throw new Error('Reference file is not a bounded regular media file');
  }
  const info = await probeMedia(file, kind, signal);
  if ((info.width ?? 0) * (info.height ?? 0) > 16_777_216 || (kind === 'video' && (info.durationMs ?? Infinity) > 3_600_000)) {
    throw new Error('Reference dimensions or duration exceed intake limits');
  }
  return info;
}
export async function retainedReference(projectId: string, assetId: string, signal: AbortSignal) {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset) return null;
  const file = referenceFile(projectId, assetId).path;
  if (!asset.sha256 || await fileHash(file, signal) !== asset.sha256) throw new Error('Retained reference integrity mismatch');
  return asset;
}

/** Atomic, immutable bytes followed by replayable registration. Never loads a video into JS memory. */
export async function registerReference({ projectId, source, sourceKey, role, kind, inputFile, signal, sourceSha256, sampleAtMs }: {
  projectId: string; source: ReferenceSource; sourceKey: string; role: string; kind: 'video' | 'image';
  inputFile?: string; signal: AbortSignal; sourceSha256?: string; sampleAtMs?: number;
}): Promise<ReferenceAsset> {
  signal.throwIfAborted();
  if (!await getActiveProject({ projectId })) throw new Error('Project not found');
  const assetId = referenceIdentity(projectId, source, sourceKey, role), destination = referenceFile(projectId, assetId);
  const previous = await getProjectAssetById({ projectId, assetId });
  const existing = await lstat(destination.path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (previous && !existing) throw new Error('Retained reference is missing; the source was not downloaded again');
  if (!existing) {
    if (!inputFile) throw new Error('Reference source is missing');
    await inspect(inputFile, kind, signal);
    await mkdir(dirname(destination.path), { recursive: true, mode: 0o700 });
    referenceFile(projectId, assetId);
    const temp = `${destination.path}.partial-${randomUUID()}`;
    try {
      await copyFile(inputFile, temp, constants.COPYFILE_EXCL);
      await chmod(temp, 0o600);
      if (await fileHash(temp, signal) !== await fileHash(inputFile, signal)) throw new Error('Reference changed while copying');
      try { await link(temp, destination.path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } finally { await unlink(temp).catch(() => undefined); }
  }
  const info = await inspect(destination.path, kind, signal), sha256 = await fileHash(destination.path, signal);
  if (previous?.sha256 && previous.sha256 !== sha256) throw new Error('Retained reference integrity mismatch');
  signal.throwIfAborted();
  if (!await getActiveProject({ projectId })) throw new Error('Project not found');
  const sizeBytes = (await lstat(destination.path)).size, publicUrl = buildLocalProjectAssetUrl({ projectId, assetId });
  await recordUserAsset({ id: assetId, type: kind, source: kind === 'image' ? 'derived' : 'upload', bucket: LOCAL_PROJECT_ASSET_BUCKET,
    objectKey: destination.objectKey, publicUrl, mimeType: info.mimeType, sizeBytes, sha256,
    filename: `${source}-${kind === 'video' ? 'reference' : `sample-${sampleAtMs}`}.${info.extension}`,
    storageProvider: LOCAL_PROJECT_ASSET_PROVIDER, assetClass: kind === 'video' ? 'original' : 'derived', originProjectId: projectId,
    width: info.width!, height: info.height!, durationMs: info.durationMs ?? undefined,
    metadata: { source: 'viral-hit-reference', provider: source, sourceKey, sourceSha256: sourceSha256 ?? sha256,
      sampleAtMs: sampleAtMs ?? null, scope: kind === 'image' ? 'sampled-frame' : 'original-video', hasAudio: info.hasAudio },
  });
  await linkProjectAsset({ projectId, assetId, role: 'reference', metadata: { sha256, sourceSha256: sourceSha256 ?? sha256 } });
  return { assetId, sha256, sizeBytes, kind, publicUrl, width: info.width!, height: info.height!, durationMs: info.durationMs, hasAudio: info.hasAudio };
}
