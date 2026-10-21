import { resolve, join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { VIRAL_HIT_MCP_TOOL_NAMES } from '@/core/commands/mcp-tools';
import { version } from '../../../package.json';
import { createViralHitSkillRegistry, loadViralHitSkillRegistry } from './skill-registry';
import { skillLibraryRequest, type SkillInspection } from './package';
import { fetchSkillFromLink } from './source.server';
import { readManagedSkills, writeManagedSkill } from './storage.server';
import { SkillConflictError, packageSkill, skillDigest, validateSkillFile } from './file.server';
import type { z } from 'zod';
export { SkillConflictError, packageSkill, validateSkillFile } from './file.server';

const options = { viralHitVersion: version, availableMcpTools: VIRAL_HIT_MCP_TOOL_NAMES };
/** Read on request so UI/MCP/CLI processes see lifecycle changes without a restart. */
export function getSkillRegistry() {
  return loadViralHitSkillRegistry({ directory: resolve('skills/official'), localDirectory: process.env.VIRAL_HIT_SKILLS_DIR?.trim() || undefined,
    installedDirectory: join(getViralHitDataRoot(), 'installed-skills'), installedOverrides: readManagedSkills(), ...options });
}

export async function inspectSkillFile(raw: unknown): Promise<SkillInspection> {
  const file = validateSkillFile(raw);
  const [skill] = createViralHitSkillRegistry({ definitions: [{ ...file, source: 'installed' }], ...options }).list();
  if (!skill) throw new Error('Invalid skill');
  const digest = skillDigest(file);
  const existing = (await getSkillRegistry()).get(file.manifest.id);
  const collision = !existing ? 'none' : existing.source !== 'installed' ? 'reserved'
    : skillDigest(packageSkill(existing)) === digest ? 'same' : 'different';
  return { skill, digest, collision, blocking: [
    ...skill.incompatibilities,
    ...(collision === 'reserved' ? ['This ID belongs to an official skill or the operator folder. Choose another ID.'] : []),
    ...(collision === 'different' ? ['A different skill with this ID is installed. Review an update or share under a new ID.'] : []),
  ], ...(existing?.source === 'installed' && collision === 'different' ? { update: { current: packageSkill(existing), currentIncompatibilities: existing.incompatibilities, digest: skillDigest(packageSkill(existing)), blocking: skill.incompatibilities } } : {}) };
}

async function installSkillFile(raw: unknown, expectedDigest: string) {
  const file = validateSkillFile(raw), review = await inspectSkillFile(file);
  if (review.digest !== expectedDigest) throw new SkillConflictError('Skill changed after review. Review the file again.');
  if (review.blocking.length) throw new SkillConflictError(review.blocking.join(' '));
  if (review.collision === 'same') return { installed: false, skill: review.skill };
  return { installed: writeManagedSkill(file.manifest.id, null, file), skill: review.skill };
}
async function updateSkillFile(raw: unknown, expectedDigest: string, expectedInstalledDigest: string) {
  const file = validateSkillFile(raw), review = await inspectSkillFile(file);
  if (review.digest !== expectedDigest) throw new SkillConflictError('Skill changed after review. Review the file again.');
  if (review.collision === 'same') return { updated: false, skill: review.skill };
  if (!review.update) throw new SkillConflictError('Only installed skills can be updated. Review the current skill again.');
  if (review.update.blocking.length) throw new SkillConflictError(review.update.blocking.join(' '));
  return { updated: writeManagedSkill(file.manifest.id, expectedInstalledDigest, file), skill: review.skill };
}
async function reviewRemoval(skillId: string) {
  const skill = (await getSkillRegistry()).get(skillId);
  if (!skill || skill.source !== 'installed') throw new SkillConflictError('Only installed skills can be removed.');
  const file = packageSkill(skill);
  return { file, digest: skillDigest(file) };
}

/** One application boundary for HTTP, MCP and CLI. Skill text never executes during installation. */
export async function changeSkillLibrary(raw: z.infer<typeof skillLibraryRequest>) {
  const request = skillLibraryRequest.parse(raw);
  switch (request.action) {
    case 'list': return (await getSkillRegistry()).catalog();
    case 'get': case 'export': {
      const skill = (await getSkillRegistry()).get(request.skillId);
      if (!skill) throw new Error('Skill not found: ' + request.skillId);
      return request.action === 'export' ? packageSkill(skill) : skill;
    }
    case 'inspect': return inspectSkillFile(request.file);
    case 'fetch': {
      const fetched = await fetchSkillFromLink(request.url, undefined, undefined, request.expectedSha256);
      return { ...fetched, inspection: await inspectSkillFile(fetched.file) };
    }
    case 'install': return installSkillFile(request.file, request.expectedDigest);
    case 'update': return updateSkillFile(request.file, request.expectedDigest, request.expectedInstalledDigest);
    case 'review-remove': return reviewRemoval(request.skillId);
    case 'remove': {
      const existing = (await getSkillRegistry()).get(request.skillId);
      if (existing && existing.source !== 'installed') throw new SkillConflictError('Only installed skills can be removed.');
      return { removed: writeManagedSkill(request.skillId, request.expectedDigest, null), skillId: request.skillId };
    }
  }
}
