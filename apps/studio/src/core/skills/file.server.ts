import { createHash } from 'node:crypto';
import { MAX_INSTRUCTIONS_BYTES, MAX_MANIFEST_BYTES, type ViralHitSkill } from './contract';
import { MAX_SKILL_FILE_BYTES, skillPackageSchema, type SkillPackage } from './package';

export class SkillConflictError extends Error {}
export const packageSkill = (skill: Pick<ViralHitSkill, 'manifest' | 'instructions'>): SkillPackage => ({
  schemaVersion: 1, kind: 'viral-hit-skill', manifest: skill.manifest, instructions: skill.instructions,
});
export const skillDigest = (file: SkillPackage) => createHash('sha256').update(JSON.stringify(file)).digest('hex');
export function validateSkillFile(raw: unknown): SkillPackage {
  const text = JSON.stringify(raw);
  if (!text || Buffer.byteLength(text) > MAX_SKILL_FILE_BYTES) throw new Error('Skill files must be 700 KB or smaller');
  const file = skillPackageSchema.parse(raw);
  if (Buffer.byteLength(JSON.stringify(file.manifest)) > MAX_MANIFEST_BYTES || Buffer.byteLength(file.instructions) > MAX_INSTRUCTIONS_BYTES) throw new Error('Skill manifest or instructions are too large');
  return file;
}
