import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadMedia } from '@/core/harness/download-media';
import { packSourceUrl } from '@/core/harness/recipe-pack-source';
import { MAX_SKILL_FILE_BYTES } from './package';

/** Fetch data only, with public DNS pinned to the socket, bounded bytes and revalidated redirects. */
export async function fetchSkillFromLink(raw: string, signal = AbortSignal.timeout(20_000), download = downloadMedia) {
  const source = packSourceUrl(raw), directory = await mkdtemp(join(tmpdir(), 'vh-skill-link-'));
  try {
    const path = join(directory, 'skill.json');
    try { await download(source, path, signal, MAX_SKILL_FILE_BYTES); }
    catch (error) { throw new Error(error instanceof Error ? error.message.replace(/^Media/, 'Skill').replace('download limit', '700 KB skill limit') : 'Skill download failed'); }
    try { return { source, file: JSON.parse(await readFile(path, 'utf8')) as unknown }; }
    catch { throw new Error('This link did not return a skill file. Use a link to the exported .viralhit-skill.json file.'); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
