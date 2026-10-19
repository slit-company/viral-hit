import { constants } from 'node:fs';
import { copyFile, lstat } from 'node:fs/promises';
import { getActiveProject } from '../projects/projects';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { fileHash } from '../harness/media-files';
import { projectMediaPin, type ProjectMediaPin } from '../harness/project-media-input-schema';
import { acquireVideoReference } from './intake.server';
import { REFERENCE_MAX_BYTES } from './reference-assets.server';

export async function inspectProjectReference(projectId: string, assetId: string, signal: AbortSignal, expected?: ProjectMediaPin) {
  if (!await getActiveProject({ projectId })) throw new Error('Project not found');
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || asset.type !== 'video' || asset.storageProvider !== 'local' || !asset.sha256) throw new Error('Select a local video belonging to this project');
  const pin = projectMediaPin.parse({ projectId, assetId, kind: 'video', sha256: asset.sha256, sizeBytes: asset.sizeBytes });
  if (pin.sizeBytes > REFERENCE_MAX_BYTES || (expected && Object.entries(pin).some(([key, value]) => expected[key as keyof ProjectMediaPin] !== value))) throw new Error('Project reference identity changed or exceeds 256 MiB');
  const file = resolveLocalProjectAssetPath({ objectKey: asset.objectKey }), stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== pin.sizeBytes || await fileHash(file, signal) !== pin.sha256) throw new Error('Project reference contents changed');
  return { pin, file };
}
export function sampleProjectReference(projectId: string, raw: ProjectMediaPin, signal: AbortSignal) {
  const pin = projectMediaPin.parse(raw);
  if (pin.projectId !== projectId || pin.kind !== 'video') throw new Error('Project reference pin mismatch');
  return acquireVideoReference({ projectId, source: 'local', sourceKey: pin.sha256, signal,
    acquire: async (destination, acquisitionSignal) => {
      const original = await inspectProjectReference(projectId, pin.assetId, acquisitionSignal, pin);
      await copyFile(original.file, destination, constants.COPYFILE_EXCL);
      if (await fileHash(destination, acquisitionSignal) !== pin.sha256) throw new Error('Reference changed while retaining source');
    } });
}
