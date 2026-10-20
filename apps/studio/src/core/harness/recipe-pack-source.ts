import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadMedia } from './download-media';
import { MAX_PACK_BYTES } from './recipe-packs';

type Download = typeof downloadMedia;

/** Accept a GitHub file page as well as a raw file link; other HTTPS links pass through unchanged. */
export function packSourceUrl(raw: string) {
  const url = new URL(raw.trim());
  const github = url.hostname === 'github.com' ? url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/) : null;
  return github ? `https://raw.githubusercontent.com/${github[1]}/${github[2]}/${github[3]}` : url.href;
}

/**
 * Downloads a shared pack with the same HTTPS, public-address and redirect
 * checks as media imports. Returns the manifest for review; nothing installs here.
 */
export async function fetchPackFromLink(raw: string, signal = AbortSignal.timeout(20_000), download: Download = downloadMedia) {
  const source = packSourceUrl(raw);
  const directory = await mkdtemp(join(tmpdir(), 'vh-pack-link-'));
  try {
    const file = join(directory, 'pack.json');
    try { await download(source, file, signal, MAX_PACK_BYTES); }
    catch (error) { throw new Error(error instanceof Error ? error.message.replace(/^Media/, 'Pack').replace('download limit', '1 MB pack limit') : 'Pack download failed'); }
    try { return { source, manifest: JSON.parse(await readFile(file, 'utf8')) as unknown }; }
    catch { throw new Error('This link did not return a pack file. Use a link to the raw JSON file.'); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
