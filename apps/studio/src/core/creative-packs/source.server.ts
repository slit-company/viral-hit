import { link, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { downloadMedia, mediaUrl } from '@/core/harness/download-media';
import { packSourceUrl } from '@/core/harness/recipe-pack-source';
import { MAX_CREATIVE_PACK_BYTES } from './contract';

/** Fetch bytes only. Review the retained file with inspect before any library installation. */
export async function fetchCreativePack(raw: string, path: string, signal: AbortSignal, download = downloadMedia) {
  if (!isAbsolute(path)) throw new Error('Use an absolute pack file path');
  // Validate before GitHub normalization too: normalization must not hide credentials or an insecure scheme.
  mediaUrl(raw.trim());
  const source = packSourceUrl(raw);
  mediaUrl(source);
  const directory = await mkdtemp(join(dirname(path), '.vh-pack-fetch-'));
  try {
    const temporary = join(directory, 'source.tar');
    await download(source, temporary, signal, MAX_CREATIVE_PACK_BYTES);
    signal.throwIfAborted();
    const info = await stat(temporary);
    if (!info.isFile() || !info.size || info.size > MAX_CREATIVE_PACK_BYTES) throw new Error('Creative packs must be non-empty files up to 512 MB');
    // Hard-link publication is atomic, stays on the same filesystem and never overwrites a user's file.
    await link(temporary, path);
    const publicSource = new URL(source);
    return { path, sizeBytes: info.size, source: publicSource.origin + publicSource.pathname, inspected: false as const };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
