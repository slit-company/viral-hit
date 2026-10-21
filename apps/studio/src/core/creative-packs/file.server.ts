import { constants } from 'node:fs';
import { open, stat, mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyVerified, readExactly, scanTar, writeTar } from '@/core/projects/bundles/tar.server';
import { MAX_REFERENCE_BYTES } from '@/core/characters/contract';
import { referencePath } from '@/core/characters/storage.server';
import { probeMedia } from '@/core/harness/probe-media';
import { MAX_CREATIVE_PACK_BYTES, MAX_CREATIVE_MANIFEST_BYTES, type CreativePackManifest } from './contract';
import { summarizeCreativePack, validateCreativeManifest } from './manifest.server';

export type LoadedCreativePack = { manifest: CreativePackManifest; media: Map<string, { path: string; offset: number; size: number }> };
const requirePath = (path: string) => { if (!isAbsolute(path)) throw new Error('Use an absolute pack file path'); };
/** One manifest and unique content-addressed images. Sources stream through the shared strict tar writer. */
export async function writeCreativePack(manifest: CreativePackManifest, path: string, signal: AbortSignal) {
  requirePath(path); validateCreativeManifest(manifest);
  const hashes = [...new Set(manifest.characters.flatMap(character => character.references.map(reference => reference.sha256)))];
  const sources = [];
  let size = Buffer.byteLength(JSON.stringify(manifest)) + 2048;
  for (const hash of hashes) {
    const source = referencePath(hash), info = await stat(source);
    if (!info.isFile() || info.size > MAX_REFERENCE_BYTES) throw new Error('Reference image is missing or too large');
    sources.push({ hash, path: source, size: info.size }); size += info.size + 1024;
  }
  if (size > MAX_CREATIVE_PACK_BYTES) throw new Error('Creative packs must be 512 MB or smaller');
  const file = await open(path, 'wx', 0o600);
  try { await writeTar(file, Buffer.from(JSON.stringify(manifest)), sources, signal); }
  catch (error) { await file.close(); await rm(path, { force: true }); throw error; }
  await file.close();
  return { pack: summarizeCreativePack(manifest), path, sizeBytes: (await stat(path)).size };
}

/** Verify all bytes and image metadata before any library changes; keep at most a 1 MiB copy buffer. */
export async function withCreativePack<T>(path: string, signal: AbortSignal, use: (loaded: LoadedCreativePack) => Promise<T>) {
  requirePath(path);
  const input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let manifest: CreativePackManifest;
  try {
    const info = await input.stat();
    if (!info.isFile() || info.size > MAX_CREATIVE_PACK_BYTES) throw new Error('Creative packs must be regular files up to 512 MB');
    // scanTar rejects links, traversal, duplicates, extra bytes and unsupported tar variants.
    const members = await scanTar(path), entry = members.get('manifest.json')!;
    if (entry.size > MAX_CREATIVE_MANIFEST_BYTES) throw new Error('Pack definitions must fit in 5 MB');
    manifest = validateCreativeManifest(JSON.parse((await readExactly(input, entry.offset, entry.size)).toString('utf8')));
    const expected = new Set(['manifest.json', ...manifest.characters.flatMap(character => character.references.map(reference => 'media/' + reference.sha256))]);
    if (members.size !== expected.size || [...members.keys()].some(name => !expected.has(name))) throw new Error('The pack has missing or extra reference images');
    const directory = await mkdtemp(join(tmpdir(), 'vh-pack-media-'));
    try {
      const media: LoadedCreativePack['media'] = new Map();
      const probes = new Map<string, Awaited<ReturnType<typeof probeMedia>>>();
      for (const character of manifest.characters) for (const reference of character.references) {
        const member = members.get('media/' + reference.sha256)!;
        if (member.size === 0 || member.size > MAX_REFERENCE_BYTES) throw new Error('Reference images must be up to 20 MB');
        let image = media.get(reference.sha256);
        if (!image) {
          const target = join(directory, reference.sha256), file = await open(target, 'wx', 0o600);
          try { await copyVerified(path, file, { ...member, sha256: reference.sha256, signal }); } finally { await file.close(); }
          image = { path: target, ...member }; media.set(reference.sha256, image);
        }
        signal.throwIfAborted();
        let probe = probes.get(reference.sha256);
        if (!probe) { probe = await probeMedia(image.path, 'image', signal); probes.set(reference.sha256, probe); }
        if (probe.mimeType !== reference.mimeType || probe.width !== reference.width || probe.height !== reference.height) throw new Error('Reference metadata does not match its image');
      }
      return await use({ manifest, media });
    } finally { await rm(directory, { recursive: true, force: true }); }
  } finally { await input.close(); }
}
