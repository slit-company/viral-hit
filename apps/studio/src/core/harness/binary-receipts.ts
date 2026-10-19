import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { getViralHitDataRoot } from '../../config/data-root';
import { createLocalProjectAssetObjectKey, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { MAX_REMOTE_MEDIA_BYTES } from './download-media';
import { fileHash } from './media-files';

export const binaryReference = z.object({ jobId: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ReceiptContext = { projectId: string; jobId: string };
const receiptSchema = z.object({
  schemaVersion: z.literal(1), projectId: z.string(), jobId: z.string().uuid(),
  provider: z.enum(['comfy-router', 'comfy-workflow', 'external-adapter']), model: z.string(), providerJobId: z.string(),
  adapterDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  requestId: z.string().nullable(), contentType: z.string().max(1000),
  creditsUsed: z.string().nullable(), servingProvider: z.string().nullable(),
  droppedParams: z.array(z.string()).nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().positive().max(MAX_REMOTE_MEDIA_BYTES),
}).strict();
export type BinaryReceipt = z.infer<typeof receiptSchema>;
export class ReceiptIntegrityError extends Error {}
function pathFor(context: ReceiptContext, filename: string) {
  return resolveLocalProjectAssetPath({
    assetRoot: resolve(getViralHitDataRoot(), 'harness-receipts'),
    objectKey: createLocalProjectAssetObjectKey({ projectId: context.projectId, assetId: context.jobId, filename }),
  });
}

/** Internal receipt files are never served directly. They must pass the media probe before asset registration. */
export async function readBinaryReceipt(context: ReceiptContext, signal: AbortSignal) {
  const file = pathFor(context, 'output.bin'), manifest = pathFor(context, 'receipt.json');
  const directory = await lstat(dirname(file)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!directory) return null;
  signal.throwIfAborted();
  try {
    const stat = await lstat(manifest);
    if (!stat.isFile() || stat.size > 32_000) throw new Error('Invalid metadata');
    const receipt = receiptSchema.parse(JSON.parse(await readFile(manifest, { encoding: 'utf8', signal })));
    const bytes = await lstat(file);
    if (receipt.projectId !== context.projectId || receipt.jobId !== context.jobId || !bytes.isFile() || bytes.size !== receipt.sizeBytes || await fileHash(file, signal) !== receipt.sha256) throw new Error('Content mismatch');
    return { receipt, file };
  } catch (error) {
    signal.throwIfAborted();
    throw new ReceiptIntegrityError('Stored provider bytes failed integrity verification; generation was not repeated');
  }
}

/** Publish bytes and metadata together; a crash never leaves a half-written receipt at its final location. */
export async function saveBinaryReceipt(context: ReceiptContext, details: Omit<BinaryReceipt, 'schemaVersion' | 'projectId' | 'jobId' | 'sha256' | 'sizeBytes'>, bytes: Uint8Array, signal: AbortSignal) {
  if (!bytes.byteLength || bytes.byteLength > MAX_REMOTE_MEDIA_BYTES) throw new ReceiptIntegrityError('Provider bytes are empty or exceed the media size limit');
  const receipt = receiptSchema.parse({ ...details, projectId: context.projectId, jobId: context.jobId, schemaVersion: 1, sizeBytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
  const file = pathFor(context, 'output.bin'), directory = dirname(file);
  await mkdir(dirname(directory), { recursive: true });
  pathFor(context, 'output.bin');
  const temporary = `${directory}.partial-${randomUUID()}`;
  await mkdir(temporary);
  try {
    await writeFile(resolve(temporary, 'output.bin'), bytes, { flag: 'wx', signal });
    await writeFile(resolve(temporary, 'receipt.json'), JSON.stringify(receipt), { flag: 'wx', signal });
    signal.throwIfAborted();
    try { await rename(temporary, directory); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  const saved = await readBinaryReceipt(context, signal);
  if (!saved || saved.receipt.sha256 !== receipt.sha256 || saved.receipt.providerJobId !== receipt.providerJobId || saved.receipt.model !== receipt.model || saved.receipt.provider !== receipt.provider || saved.receipt.adapterDigest !== receipt.adapterDigest) throw new ReceiptIntegrityError('Provider replay differs from its saved receipt; original bytes retained');
  return saved.receipt;
}

export function binaryReceiptOutput(receipt: BinaryReceipt) {
  return { provider: receipt.provider, model: receipt.model, requestId: receipt.requestId,
    creditsUsed: receipt.creditsUsed, servingProvider: receipt.servingProvider, droppedParams: receipt.droppedParams,
    contentType: receipt.contentType, sizeBytes: receipt.sizeBytes,
    binaryReceipt: { jobId: receipt.jobId, sha256: receipt.sha256 }, mediaMaterialized: false,
  };
}
