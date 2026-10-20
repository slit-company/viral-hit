import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { bundlePath, readBundleJson } from './storage.server';
import { MAX_BUNDLE_BYTES } from './contract';
import { copyVerified } from './tar.server';

export async function openProjectBundleDownload(id: string, signal: AbortSignal) {
  const receipt = z.object({ kind: z.literal('export'), projectId: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().positive().max(MAX_BUNDLE_BYTES) }).strict().parse(await readBundleJson(id, 'receipt.json', 4096));
  const path = bundlePath(id, 'project.tar');
  await copyVerified(path, null, { size: receipt.sizeBytes, sha256: receipt.sha256, signal });
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== receipt.sizeBytes) throw Error('Project file changed');
    return { file, receipt };
  } catch (error) { await file.close(); throw error; }
}
