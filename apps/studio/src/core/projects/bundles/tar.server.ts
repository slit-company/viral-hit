import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { MAX_BUNDLE_BYTES, MAX_MANIFEST_BYTES } from './contract';

const BLOCK = 512;
const pad = (size: number) => (BLOCK - size % BLOCK) % BLOCK;
export async function writeAll(file: FileHandle, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await file.write(bytes, offset, bytes.length - offset);
    if (!result.bytesWritten) throw Error('Unable to write bundle');
    offset += result.bytesWritten;
  }
}
export async function readExactly(file: FileHandle, position: number, length: number) {
  const bytes = Buffer.alloc(length); let offset = 0;
  while (offset < length) {
    const result = await file.read(bytes, offset, length - offset, position + offset);
    if (!result.bytesRead) throw Error('Truncated project file');
    offset += result.bytesRead;
  }
  return bytes;
}
export function tarHeader(name: string, size: number) {
  if (!/^(manifest\.json|media\/[a-f0-9]{64})$/.test(name) || !Number.isSafeInteger(size) || size < 0 || size > MAX_BUNDLE_BYTES) throw Error('Invalid tar member');
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 100, 'ascii');
  const octal = (value: number, start: number, length: number) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', start, length, 'ascii');
  octal(0o600, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(size, 124, 12); octal(0, 136, 12);
  header.fill(32, 148, 156); header[156] = 48;
  header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}
function parseHeader(header: Buffer) {
  const field = (start: number, length: number) => header.subarray(start, start + length).toString('ascii').split('\0')[0];
  const name = field(0, 100), sizeText = field(124, 12), sumText = field(148, 8).trim();
  if (!/^[0-7]+$/.test(sizeText) || !/^[0-7]+$/.test(sumText)) throw Error('Invalid tar numeric field');
  const size = parseInt(sizeText, 8), sum = parseInt(sumText, 8);
  const check = Buffer.from(header); check.fill(32, 148, 156);
  if (sum !== check.reduce((n, b) => n + b, 0)) throw Error('Tar header checksum mismatch');
  if (header[156] !== 48 || field(257, 6) !== 'ustar' || field(263, 2) !== '00' || header.subarray(157, 257).some(Boolean) || header.subarray(345, 500).some(Boolean)) throw Error('Only regular ustar files are supported');
  const canonical = tarHeader(name, size);
  if (!header.subarray(0, 100).equals(canonical.subarray(0, 100))) throw Error('Invalid tar member name');
  return { name, size };
}
export async function scanTar(filePath: string) {
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BUNDLE_BYTES || info.size < BLOCK * 3 || info.size % BLOCK) throw Error('Invalid project file size');
    const members = new Map<string, { offset: number; size: number }>(); let offset = 0;
    while (offset < info.size) {
      const header = await readExactly(file, offset, BLOCK);
      if (header.every(byte => byte === 0)) {
        if (members.size < 1 || info.size - offset < 1024 || info.size - offset > 10240) throw Error('Invalid tar ending');
        if ((await readExactly(file, offset, info.size - offset)).some(Boolean)) throw Error('Unexpected trailing tar data');
        return members;
      }
      const { name, size } = parseHeader(header);
      if (members.size > 500 || members.has(name) || (!members.size && name !== 'manifest.json') || (name === 'manifest.json' && size > MAX_MANIFEST_BYTES)) throw Error('Invalid project members');
      const start = offset + BLOCK, end = start + size;
      if (end + pad(size) > info.size) throw Error('Truncated project member');
      if (pad(size) && (await readExactly(file, end, pad(size))).some(Boolean)) throw Error('Invalid tar padding');
      members.set(name, { offset: start, size }); offset = end + pad(size);
    }
    throw Error('Missing tar ending');
  } finally { await file.close(); }
}
export async function copyVerified(source: string, target: FileHandle | null, { offset = 0, size, sha256, signal }: { offset?: number; size: number; sha256?: string; signal: AbortSignal }) {
  const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || offset + size > info.size || (offset === 0 && info.size !== size)) throw Error('Media is missing or truncated');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let copied = 0;
    while (copied < size) {
      signal.throwIfAborted();
      const count = Math.min(buffer.length, size - copied);
      const { bytesRead } = await file.read(buffer, 0, count, offset + copied);
      if (bytesRead !== count) throw Error('Media changed during copy');
      const chunk = buffer.subarray(0, count); hash.update(chunk);
      if (target) await writeAll(target, chunk);
      copied += count;
    }
    const digest = hash.digest('hex');
    if (sha256 && digest !== sha256) throw Error('Media checksum mismatch');
    return digest;
  } finally { await file.close(); }
}
export async function writeTar(file: FileHandle, manifest: Buffer, sources: Array<{ hash: string; path: string; size: number }>, signal: AbortSignal) {
  await writeAll(file, tarHeader('manifest.json', manifest.length));
  await writeAll(file, manifest); await writeAll(file, Buffer.alloc(pad(manifest.length)));
  for (const source of sources) {
    await writeAll(file, tarHeader(`media/${source.hash}`, source.size));
    await copyVerified(source.path, file, { size: source.size, sha256: source.hash, signal });
    await writeAll(file, Buffer.alloc(pad(source.size)));
  }
  await writeAll(file, Buffer.alloc(1024)); await file.sync();
}
