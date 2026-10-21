import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { getActiveProject } from '../projects/projects';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { LOCAL_PROJECT_ASSET_PROVIDER, resolveLocalProjectAssetPath } from '../projects/local-project-assets';

import { MAX_ADAPTER_INPUT_BYTES, projectMediaPin, type ProjectMediaPin } from './project-media-input-schema';

type MediaOptions = { projectId: string; assetId: string; kind: ProjectMediaPin['kind']; maxBytes: number; expected?: ProjectMediaPin; signal: AbortSignal };

async function inspectProjectMediaInput(options: MediaOptions, retainBytes: boolean) {
  const { projectId, assetId, kind, signal } = options;
  signal.throwIfAborted();
  if (!await getActiveProject({ projectId })) throw new Error('Project is unavailable');
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || asset.type !== kind || asset.storageProvider !== LOCAL_PROJECT_ASSET_PROVIDER || !asset.sha256) throw new Error(`Select a local ${kind} belonging to this project`);
  const pin = projectMediaPin.parse({ projectId, assetId, kind, sha256: asset.sha256, sizeBytes: asset.sizeBytes });
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > MAX_ADAPTER_INPUT_BYTES || pin.sizeBytes > options.maxBytes) throw new Error('Project input exceeds the adapter byte limit');
  if (options.expected && Object.entries(pin).some(([key, value]) => options.expected![key as keyof ProjectMediaPin] !== value)) throw new Error('Project input identity changed after queueing');
  const handle = await open(resolveLocalProjectAssetPath({ objectKey: asset.objectKey }), constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer | undefined;
  const hash = createHash('sha256');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== pin.sizeBytes) throw new Error('Project input size changed');
    bytes = retainBytes ? Buffer.alloc(pin.sizeBytes) : undefined;
    const buffer = bytes ?? Buffer.alloc(Math.min(64 * 1024, pin.sizeBytes));
    let offset = 0;
    while (offset < pin.sizeBytes) {
      signal.throwIfAborted();
      const destinationOffset = retainBytes ? offset : 0;
      const { bytesRead } = await handle.read(buffer, destinationOffset, Math.min(64 * 1024, pin.sizeBytes - offset), null);
      if (!bytesRead) throw new Error('Project input was truncated');
      hash.update(buffer.subarray(destinationOffset, destinationOffset + bytesRead));
      offset += bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, null)).bytesRead) throw new Error('Project input grew while reading');
  } finally { await handle.close(); }
  signal.throwIfAborted();
  if (hash.digest('hex') !== pin.sha256) throw new Error('Project input content changed; original work was not resubmitted');
  return { ...pin, bytes: bytes ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : undefined, mimeType: asset.mimeType, filename: asset.filename };
}


/** Return copies of verified bytes, never original host paths. */
export async function readProjectMediaInput(options: MediaOptions) {
  const result = await inspectProjectMediaInput(options, true);
  if (!result.bytes) throw new Error('Project media bytes were not retained');
  return { ...result, bytes: result.bytes };
}

/** Verify identity/content using a single 64 KiB buffer, without retaining the file in memory. */
export async function verifyProjectMediaInput(options: MediaOptions) {
  const { bytes: _, ...result } = await inspectProjectMediaInput(options, false);
  return result;
}
