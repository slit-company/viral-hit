import { lstat } from 'node:fs/promises';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { fileHash } from '../harness/media-files';
import { probeMedia } from '../harness/probe-media';
import type { StoryboardPlan } from './contract';

export async function checkedMedia(projectId: string, assetId: string, sha256: string) {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || asset.storageProvider !== 'local' || asset.sha256 !== sha256) throw Error('Storyboard media is unavailable, changed, or belongs to another project');
  const file = resolveLocalProjectAssetPath({ objectKey: asset.objectKey }), stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.sizeBytes || stat.size > 256 * 1024 * 1024) throw Error('Storyboard media file is invalid or exceeds 256 MiB');
  if (await fileHash(file, AbortSignal.timeout(30_000)) !== sha256) throw Error('Storyboard media content hash changed');
  const decoded = await probeMedia(file, asset.type, AbortSignal.timeout(30_000));
  return { ...asset, durationMs: decoded.durationMs };
}
export async function checkReferences(projectId: string, plan: StoryboardPlan) {
  const checked = new Map<string, Awaited<ReturnType<typeof checkedMedia>>>();
  let bytes = 0;
  for (const item of [...plan.references, ...plan.audio]) {
    let asset = checked.get(item.assetId + ':' + item.sha256);
    if (!asset) {
      asset = await checkedMedia(projectId, item.assetId, item.sha256);
      checked.set(item.assetId + ':' + item.sha256, asset); bytes += asset.sizeBytes ?? 0;
      if (bytes > 512 * 1024 * 1024) throw Error('Storyboard references exceed 512 MiB');
    }
    if ('observation' in item) {
      if (asset.type === 'image' && (item.startTime !== undefined || item.endTime !== undefined)) throw Error('Still images have no reference time range');
      if (item.endTime !== undefined && item.endTime > (asset.durationMs ?? 0) / 1000) throw Error('Reference time range exceeds its source');
    } else if (asset.type !== 'audio' || item.inPoint + item.duration > (asset.durationMs ?? 0) / 1000) throw Error('Soundtrack must fit its audio source');
  }
}
