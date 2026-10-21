import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { VIRAL_HIT_MCP_TOOL_NAMES } from '@/core/commands/mcp-tools';
import { version } from '../../../package.json';
import { createViralHitSkillRegistry, loadViralHitSkillRegistry } from './skill-registry';
import { MAX_INSTRUCTIONS_BYTES, MAX_MANIFEST_BYTES, type ViralHitSkill } from './contract';
import { MAX_SKILL_FILE_BYTES, skillPackageSchema, skillLibraryRequest, type SkillPackage, type SkillInspection } from './package';
import { fetchSkillFromLink } from './source.server';
import type { z } from 'zod';

const options = { viralHitVersion: version, availableMcpTools: VIRAL_HIT_MCP_TOOL_NAMES };
const installedRoot = () => join(getViralHitDataRoot(), 'installed-skills');
export class SkillConflictError extends Error {}

/** Read on request so another UI/MCP/CLI process sees installed skills without a restart. */
export function getSkillRegistry() {
  return loadViralHitSkillRegistry({ directory: resolve('skills/official'), localDirectory: process.env.VIRAL_HIT_SKILLS_DIR?.trim() || undefined,
    installedDirectory: installedRoot(), ...options });
}
export const packageSkill = (skill: Pick<ViralHitSkill, 'manifest' | 'instructions'>): SkillPackage => ({
  schemaVersion: 1, kind: 'viral-hit-skill', manifest: skill.manifest, instructions: skill.instructions,
});
const fingerprint = (file: SkillPackage) => createHash('sha256').update(JSON.stringify(file)).digest('hex');

export function validateSkillFile(raw: unknown) {
  const text = JSON.stringify(raw);
  if (!text || Buffer.byteLength(text) > MAX_SKILL_FILE_BYTES) throw new Error('Skill files must be 700 KB or smaller');
  const file = skillPackageSchema.parse(raw);
  if (Buffer.byteLength(JSON.stringify(file.manifest)) > MAX_MANIFEST_BYTES || Buffer.byteLength(file.instructions) > MAX_INSTRUCTIONS_BYTES) throw new Error('Skill manifest or instructions are too large');
  return file;
}

export async function inspectSkillFile(raw: unknown): Promise<SkillInspection> {
  const file = validateSkillFile(raw);
  const [skill] = createViralHitSkillRegistry({ definitions: [{ ...file, source: 'installed' }], ...options }).list();
  if (!skill) throw new Error('Invalid skill');
  const digest = fingerprint(file);
  const existing = (await getSkillRegistry()).get(file.manifest.id);
  const collision = !existing ? 'none' : existing.source !== 'installed' ? 'reserved'
    : fingerprint(packageSkill(existing)) === digest ? 'same' : 'different';
  return { skill, digest, collision, blocking: [
    ...skill.incompatibilities,
    ...(collision === 'reserved' ? ['This ID belongs to an official skill or the operator folder. Choose another ID.'] : []),
    ...(collision === 'different' ? ['A different skill with this ID is installed. Share this revision under a new ID.'] : []),
  ] };
}

async function installSkillFile(raw: unknown, expectedDigest: string) {
  const file = validateSkillFile(raw), review = await inspectSkillFile(file);
  if (review.digest !== expectedDigest) throw new SkillConflictError('Skill changed after review. Review the file again.');
  if (review.blocking.length) throw new SkillConflictError(review.blocking.join(' '));
  if (review.collision === 'same') return { installed: false, skill: review.skill };
  const root = installedRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Publish both files with a single rename. Readers ignore staging folders; an occupied ID is never overwritten.
  const staging = await mkdtemp(join(root, '.install-'));
  try {
    await writeFile(join(staging, 'skill.json'), JSON.stringify(file.manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeFile(join(staging, 'SKILL.md'), file.instructions, { flag: 'wx', mode: 0o600 });
    try { await rename(staging, join(root, file.manifest.id)); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      const current = await inspectSkillFile(file);
      if (current.collision !== 'same') throw new SkillConflictError('Another skill took this ID. Review the file again.');
      return { installed: false, skill: current.skill };
    }
    return { installed: true, skill: review.skill };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

/** One application boundary for HTTP, MCP and CLI. Skill text never executes during installation. */
export async function changeSkillLibrary(request: z.infer<typeof skillLibraryRequest>) {
  switch (request.action) {
    case 'list': return (await getSkillRegistry()).catalog();
    case 'get': case 'export': {
      const skill = (await getSkillRegistry()).get(request.skillId);
      if (!skill) throw new Error('Skill not found: ' + request.skillId);
      return request.action === 'export' ? packageSkill(skill) : skill;
    }
    case 'inspect': return inspectSkillFile(request.file);
    case 'fetch': {
      const fetched = await fetchSkillFromLink(request.url);
      return { ...fetched, inspection: await inspectSkillFile(fetched.file) };
    }
    case 'install': return installSkillFile(request.file, request.expectedDigest);
  }
}
