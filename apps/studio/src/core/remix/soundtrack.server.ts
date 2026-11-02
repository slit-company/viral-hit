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
 * The reference's soundtrack as its own project audio asset (AAC in M4A), so a remix can keep the
 * music and timing it was cut to. The same video always yields the same asset; silent video yields null.
 */
export async function extractProjectSoundtrack({ projectId, assetId, signal }: { projectId: string; assetId: string; signal: AbortSignal }) {
  const source = await getProjectAssetById({ projectId, assetId });
  if (!source || source.type !== 'video' || source.bucket !== LOCAL_PROJECT_ASSET_BUCKET || !source.objectKey) throw new Error('The reference must be a local project video.');
  const derivedId = 'soundtrack-' + createHash('sha256').update(projectId + '\0' + assetId).digest('hex').slice(0, 32);
  const existing = await getProjectAssetById({ projectId, assetId: derivedId });
  if (existing) return existing.durationMs ? { assetId: existing.id, duration: existing.durationMs / 1000 } : null;
  const file = resolveLocalProjectAssetPath({ objectKey: source.objectKey });
  if (!(await probeMedia(file, 'video', signal)).hasAudio) return null;
  const directory = await mkdtemp(join(tmpdir(), 'vh-soundtrack-'));
  try {
    const output = join(directory, 'soundtrack.m4a');
    await execute(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output], { signal, timeout: 120_000, maxBuffer: 1024 * 1024 });
    const audio = await probeMedia(output, 'audio', signal);
    const persisted = await persistLocalProjectAsset({
      projectId, assetId: derivedId, mimeType: 'audio/mp4', bytes: new Uint8Array(await readFile(output)),
      filename: (source.filename ?? 'reference').replace(/\.[^.]+$/, '') + '-soundtrack.m4a',
    });
    try {
      const metadata = { operation: 'video_soundtrack_extract', parentAssetId: assetId };
      const id = await recordUserAsset({
        id: persisted.assetId, type: 'audio', source: 'derived', bucket: LOCAL_PROJECT_ASSET_BUCKET, objectKey: persisted.objectKey,
        publicUrl: persisted.publicUrl, mimeType: 'audio/mp4', sizeBytes: persisted.sizeBytes, sha256: persisted.sha256, filename: persisted.filename,
        storageProvider: LOCAL_PROJECT_ASSET_PROVIDER, assetClass: 'derived', originProjectId: projectId, durationMs: audio.durationMs ?? undefined, metadata,
      });
      await linkProjectAsset({ projectId, assetId: id, role: 'reference', assetRole: 'video_soundtrack', metadata });
      return { assetId: id, duration: audio.durationMs! / 1000 };
    } catch (error) {
      await deleteUserAssetById(persisted.assetId).catch(() => undefined);
      await removePersistedLocalProjectAsset(persisted.filePath);
      throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
