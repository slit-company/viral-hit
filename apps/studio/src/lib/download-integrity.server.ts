import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function downloadedFileDigest(path: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, {
    signal,
    highWaterMark: 1024 * 1024,
  }))
    hash.update(chunk);
  return hash.digest('hex');
}
export async function verifyDownloadedFile(
  path: string,
  expectedSha256: string | undefined,
  signal?: AbortSignal,
) {
  if (
    expectedSha256 &&
    (await downloadedFileDigest(path, signal)) !== expectedSha256
  ) {
    throw new Error(
      'Downloaded file differs from the catalog. Refresh the catalog and review its changes before trying again.',
    );
  }
}
