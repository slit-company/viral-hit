import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { probeMedia } from '../harness/probe-media';
import { LOCAL_PROJECT_ASSET_BUCKET, LOCAL_PROJECT_ASSET_PROVIDER, persistLocalProjectAsset, removePersistedLocalProjectAsset, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { deleteUserAssetById, getProjectAssetById, linkProjectAsset, recordUserAsset } from '../workspace-lib/assets/user-assets';

const execute = promisify(execFile);

/**
 * A range of a project video as its own project video (H.264/AAC MP4), for models that take a
 * reference video of limited length. The same range always yields the same asset.
 */
export async function extractProjectVideoSegment({ projectId, assetId, start, duration, signal }: { projectId: string; assetId: string; start: number; duration: number; signal: AbortSignal }) {
  const source = await getProjectAssetById({ projectId, assetId });
  if (!source || source.type !== 'video' || source.bucket !== LOCAL_PROJECT_ASSET_BUCKET || !source.objectKey) throw new Error('The clip must be a local project video.');
  const derivedId = 'segment-' + createHash('sha256').update([projectId, assetId, start.toFixed(3), duration.toFixed(3)].join('\0')).digest('hex').slice(0, 32);
  const existing = await getProjectAssetById({ projectId, assetId: derivedId });
  if (existing) return existing;
  const directory = await mkdtemp(join(tmpdir(), 'vh-segment-'));
  try {
    const output = join(directory, 'segment.mp4');
    await execute(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-nostdin', '-v', 'error', '-ss', start.toFixed(3), '-i', resolveLocalProjectAssetPath({ objectKey: source.objectKey }), '-t', duration.toFixed(3),
      '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output],
    { signal, timeout: 300_000, maxBuffer: 1024 * 1024 });
    const info = await probeMedia(output, 'video', signal);
    const persisted = await persistLocalProjectAsset({ projectId, assetId: derivedId, mimeType: 'video/mp4', bytes: new Uint8Array(await readFile(output)),
      filename: (source.filename ?? 'clip').replace(/\.[^.]+$/, '') + '-' + start.toFixed(1) + 's.mp4' });
    try {
      const metadata = { operation: 'video_segment_extract', parentAssetId: assetId, start, duration };
      const id = await recordUserAsset({
        id: persisted.assetId, type: 'video', source: 'derived', bucket: LOCAL_PROJECT_ASSET_BUCKET, objectKey: persisted.objectKey, publicUrl: persisted.publicUrl,
        mimeType: 'video/mp4', sizeBytes: persisted.sizeBytes, sha256: persisted.sha256, filename: persisted.filename, storageProvider: LOCAL_PROJECT_ASSET_PROVIDER,
        assetClass: 'derived', originProjectId: projectId, durationMs: info.durationMs ?? undefined, width: info.width ?? undefined, height: info.height ?? undefined, metadata,
      });
      await linkProjectAsset({ projectId, assetId: id, role: 'reference', assetRole: 'video_segment', metadata });
      return (await getProjectAssetById({ projectId, assetId: id }))!;
    } catch (error) {
      await deleteUserAssetById(persisted.assetId).catch(() => undefined);
      await removePersistedLocalProjectAsset(persisted.filePath);
      throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
