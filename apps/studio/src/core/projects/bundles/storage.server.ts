import { createHash, randomUUID } from 'node:crypto';
import { constants, lstatSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { bundleId, MAX_BUNDLE_BYTES } from './contract';
import { writeAll } from './tar.server';

export function bundlePath(id: string, name: string) {
  bundleId.parse(id);
  if (!/^(source\.tar|project\.tar|receipt\.json|manifest\.json|[a-f0-9]{64}|[a-f0-9-]+\.tmp)$/.test(name)) throw Error('Invalid project file path');
  const root = join(getViralHitDataRoot(), 'project-bundles');
  for (const path of [root, join(root, id), join(root, id, name)]) {
    try { if (lstatSync(path).isSymbolicLink()) throw Error('Project file paths cannot contain links'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return join(root, id, name);
}
export async function createBundleStage() {
  const id = randomUUID(); const file = bundlePath(id, 'receipt.json');
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
  bundlePath(id, 'receipt.json'); return id;
}
export async function writeBundleJson(id: string, name: 'receipt.json' | 'manifest.json', data: unknown) {
  const temp = bundlePath(id, `${randomUUID()}.tmp`), file = await open(temp, 'wx', 0o600);
  try { await writeAll(file, Buffer.from(JSON.stringify(data))); await file.sync(); }
  finally { await file.close(); }
  await rename(temp, bundlePath(id, name));
}
export async function readBundleJson(id: string, name: 'receipt.json' | 'manifest.json', max = 5 * 1024 * 1024) {
  const file = await open(bundlePath(id, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if ((await file.stat()).size > max) throw Error('Invalid project file metadata'); return JSON.parse(await file.readFile('utf8')); }
  finally { await file.close(); }
}
export async function receiveBundle(source: AsyncIterable<Uint8Array>, signal: AbortSignal) {
  const id = await createBundleStage(), path = bundlePath(id, 'source.tar');
  const file = await open(path, 'wx', 0o600); const hash = createHash('sha256'); let bytes = 0;
  try {
    for await (const chunk of abortableChunks(source, signal)) {
      signal.throwIfAborted(); bytes += chunk.length;
      if (bytes > MAX_BUNDLE_BYTES) throw Error('Project file exceeds 2 GiB');
      hash.update(chunk); await writeAll(file, chunk);
    }
    await file.sync(); return { id, path, sizeBytes: bytes, sha256: hash.digest('hex') };
  } catch (error) { await file.close(); await rm(path, { force: true }); throw error; }
  finally { await file.close(); }
}

/** A stalled client must release the file handle when the request expires. */
async function* abortableChunks(source: AsyncIterable<Uint8Array>, signal: AbortSignal) {
  signal.throwIfAborted();
  const iterator = source[Symbol.asyncIterator]();
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    void iterator.return?.().catch(() => {});
  }
}
