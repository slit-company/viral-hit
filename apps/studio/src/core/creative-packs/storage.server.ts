import { constants } from 'node:fs';
import { link, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { MAX_CREATIVE_MANIFEST_BYTES, type CreativePackManifest } from './contract';
import { summarizeCreativePack, validateCreativeManifest } from './manifest.server';

const root = () => join(getViralHitDataRoot(), 'creative-packs');
const filePath = (id: string) => {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw new Error('Invalid pack ID');
  return join(root(), id + '.json');
};
export async function readStoredCreativePack(id: string) {
  let file;
  try { file = await open(filePath(id), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_CREATIVE_MANIFEST_BYTES) throw new Error('Invalid installed pack file');
    return validateCreativeManifest(JSON.parse(await file.readFile('utf8')));
  } finally { await file.close(); }
}
export async function listStoredCreativePacks() {
  let names;
  try { names = (await readdir(root())).filter(name => /^[a-z][a-z0-9-]{0,39}\.json$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  if (names.length > 500) throw new Error('Too many installed creative packs');
  const packs = [];
  for (const name of names) packs.push(summarizeCreativePack((await readStoredCreativePack(name.slice(0, -5)))!));
  return packs;
}
/** The completion record is immutable. A process interruption before this step is safely replayed from library contents. */
export async function storeCreativePack(manifest: CreativePackManifest) {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const temporary = join(root(), '.' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
    try { await link(temporary, filePath(manifest.id)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = await readStoredCreativePack(manifest.id);
      if (!current || summarizeCreativePack(current).digest !== summarizeCreativePack(manifest).digest) throw new Error('A different creative pack has this ID');
    }
  } finally { await rm(temporary, { force: true }); }
}
