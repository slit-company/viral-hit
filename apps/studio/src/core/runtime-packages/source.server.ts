import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadedFileDigest } from '@/lib/download-integrity.server';
import { downloadMedia } from '../harness/download-media';
import { packSourceUrl } from '../harness/recipe-pack-source';
import { catalogUrlSchema } from '../community/contract';
import { runtimePackageFetchRequest, MAX_RUNTIME_PACKAGE_BYTES } from './contract';

/** Bounded source acquisition only. Never imports modules or persists a release. */
export async function fetchRuntimePackage(
  raw: unknown,
  callerSignal?: AbortSignal,
  download: typeof downloadMedia = downloadMedia,
) {
  const request = runtimePackageFetchRequest.parse(raw);
  const source = packSourceUrl(request.url);
  const timeout = AbortSignal.timeout(20_000);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  signal.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'vh-runtime-link-'));
  try {
    const file = join(directory, 'runtime.json');
    await download(source, file, signal, MAX_RUNTIME_PACKAGE_BYTES, url => catalogUrlSchema.parse(url));
    signal.throwIfAborted();
    const size = (await stat(file)).size;
    if (size < 1 || size > MAX_RUNTIME_PACKAGE_BYTES) throw new Error('Choose a runtime JSON file up to 12 MB.');
    const sha256 = await downloadedFileDigest(file, signal);
    if (request.expectedSha256 && sha256 !== request.expectedSha256)
      throw new Error('Downloaded file differs from the catalog. Refresh the catalog and review its changes before trying again.');
    const bytes = await readFile(file, { encoding: 'utf8', signal });
    signal.throwIfAborted();
    let pkg: unknown;
    try { pkg = JSON.parse(bytes); }
    catch { throw new Error('This link did not return runtime JSON. Use a link to the raw package file.'); }
    return { package: pkg, download: { source, sha256, catalogPinned: !!request.expectedSha256 } };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
