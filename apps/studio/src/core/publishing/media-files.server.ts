import { createHash } from 'node:crypto';
import { constants, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PublicationAsset } from './contracts';

export const PUBLICATION_BLOCK_BYTES = 8 * 1024 * 1024;
export function mediaKey(value: string) {
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(value) || value === '.' || value === '..') throw new Error('Invalid publication media identity');
  return value;
}
export function privateMediaRoot(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (lstatSync(path).isSymbolicLink()) throw new Error('Publication media root cannot be a symbolic link');
  return realpathSync(path);
}
/** Caller-owned root; every path component beneath it is checked before filesystem use. */
export function mediaPath(root: string, parts: string[], createParents = false) {
  let current = root;
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Publication media root is unavailable');
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, mediaKey(parts[index]));
    const directory = index < parts.length - 1;
    if (directory && createParents) mkdirSync(current, { recursive: true, mode: 0o700 });
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('Invalid publication media path');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return current;
}
export async function openMediaFile(file: string, sizeBytes: number) {
  // NONBLOCK avoids waiting forever on a substituted FIFO before we can inspect it.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== sizeBytes) throw new Error('Publication media size or file type changed');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
export async function readMediaBlock(handle: FileHandle, buffer: Buffer, offset: number, signal: AbortSignal) {
  let read = 0;
  while (read < buffer.length) {
    signal.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, read, buffer.length - read, offset + read);
    if (!bytesRead) throw new Error('Publication media was truncated');
    read += bytesRead;
  }
  signal.throwIfAborted();
}
export const blockHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** One reusable block buffer, independent of full export size. */
export async function copyVerifiedMedia(source: string, target: FileHandle, asset: PublicationAsset, signal: AbortSignal) {
  const input = await openMediaFile(source, asset.sizeBytes);
  const hashes: string[] = [], hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(PUBLICATION_BLOCK_BYTES, asset.sizeBytes));
  try {
    for (let offset = 0; offset < asset.sizeBytes; offset += buffer.length) {
      const block = buffer.subarray(0, Math.min(buffer.length, asset.sizeBytes - offset));
      await readMediaBlock(input, block, offset, signal);
      hash.update(block); hashes.push(blockHash(block));
      let written = 0;
      while (written < block.length) {
        signal.throwIfAborted();
        const { bytesWritten } = await target.write(block, written, block.length - written, offset + written);
        if (!bytesWritten) throw new Error('Publication media write did not advance');
        written += bytesWritten;
      }
    }
    if ((await input.read(Buffer.alloc(1), 0, 1, asset.sizeBytes)).bytesRead) throw new Error('Publication media grew during preparation');
    if (hash.digest('hex') !== asset.sha256) throw new Error('Project media changed before preparation');
    signal.throwIfAborted();
    await target.sync();
    return hashes;
  } finally { await input.close(); }
}

export async function verifyRetainedMedia(file: string, asset: PublicationAsset, hashes: string[], signal: AbortSignal) {
  const handle = await openMediaFile(file, asset.sizeBytes);
  const buffer = Buffer.allocUnsafe(Math.min(PUBLICATION_BLOCK_BYTES, asset.sizeBytes));
  try {
    for (let index = 0; index < hashes.length; index++) {
      const offset = index * PUBLICATION_BLOCK_BYTES;
      const block = buffer.subarray(0, Math.min(buffer.length, asset.sizeBytes - offset));
      await readMediaBlock(handle, block, offset, signal);
      if (blockHash(block) !== hashes[index]) throw new Error('Retained publication media is corrupt');
    }
  } finally { await handle.close(); }
}

export async function syncMediaDirectory(directory: string) {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
