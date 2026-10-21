import { z } from 'zod';
import { MAX_INSTRUCTIONS_BYTES, viralHitSkillIdSchema, viralHitSkillManifestSchema, type ViralHitSkillDescriptor } from './contract';

export const MAX_SKILL_FILE_BYTES = 700_000;
export const skillPackageSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('viral-hit-skill'),
  manifest: viralHitSkillManifestSchema,
  instructions: z.string().trim().min(1).max(MAX_INSTRUCTIONS_BYTES),
}).strict();
export type SkillPackage = z.infer<typeof skillPackageSchema>;
export const skillLibraryRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('get'), skillId: viralHitSkillIdSchema }).strict(),
  z.object({ action: z.literal('export'), skillId: viralHitSkillIdSchema }).strict(),
  z.object({ action: z.literal('inspect'), file: z.unknown() }).strict(),
  z.object({ action: z.literal('fetch'), url: z.string().url().max(2000) }).strict(),
  z.object({ action: z.literal('install'), file: z.unknown(), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('update'), file: z.unknown(), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/), expectedInstalledDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('review-remove'), skillId: viralHitSkillIdSchema }).strict(),
  z.object({ action: z.literal('remove'), skillId: viralHitSkillIdSchema, expectedDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export type SkillInspection = {
  skill: ViralHitSkillDescriptor; digest: string;
  collision: 'none' | 'same' | 'different' | 'reserved'; blocking: string[];
  update?: { current: SkillPackage; currentIncompatibilities: string[]; digest: string; blocking: string[] };
};
export type SkillReview = { file: SkillPackage; inspection: SkillInspection; source?: string };
export type SkillRemovalReview = { file: SkillPackage; digest: string };
