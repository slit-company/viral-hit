import { z } from 'zod';
import { packManifestSchema } from '@/core/harness/recipe-packs';
import { characterFileManifestSchema, characterId, type CharacterFileManifest } from '@/core/characters/contract';
import { skillPackageSchema, type SkillPackage, type SkillInspection } from '@/core/skills/package';
import type { PackInspection } from '@/core/harness/recipe-packs';

export const MAX_CREATIVE_PACK_BYTES = 512 * 1024 * 1024;
export const MAX_CREATIVE_MANIFEST_BYTES = 5 * 1024 * 1024;
const identity = packManifestSchema.omit({ recipes: true, kind: true, schemaVersion: true });
const uniqueIds = (max: number) => z.array(z.string().min(1).max(80)).max(max).refine(ids => new Set(ids).size === ids.length, 'Choose each item once');
export const creativePackBuildSchema = identity.extend({
  recipeIds: uniqueIds(24).default([]), skillIds: uniqueIds(12).default([]), characterIds: z.array(characterId).max(12).default([]),
}).strict().refine(value => value.recipeIds.length + value.skillIds.length + value.characterIds.length > 0, 'Choose at least one recipe, skill or character')
  .refine(value => new Set(value.characterIds).size === value.characterIds.length, 'Choose each character once');
export type CreativePackBuild = z.infer<typeof creativePackBuildSchema>;
export const creativePackManifestSchema = identity.extend({
  schemaVersion: z.literal(1), kind: z.literal('viral-hit-creative-pack'),
  recipes: z.array(z.unknown()).max(24), skills: z.array(skillPackageSchema).max(12), characters: z.array(characterFileManifestSchema).max(12),
}).strict().refine(value => value.recipes.length + value.skills.length + value.characters.length > 0, 'The pack is empty');
export type CreativePackManifest = z.infer<typeof creativePackManifestSchema>;
export type CreativePackSummary = z.infer<typeof identity> & { digest: string; recipeCount: number; skillCount: number; characterCount: number };
export type CreativePackInspection = {
  pack: CreativePackSummary; recipes: PackInspection | null;
  skills: { file: SkillPackage; inspection: SkillInspection; reused: boolean }[];
  characters: { manifest: CharacterFileManifest; collision: 'none' | 'same' | 'different'; previews: { sha256: string; offset: number; size: number }[] }[];
  blocking: string[];
};
export type CreativePackResult = { complete: boolean; pack: CreativePackSummary; items: { kind: 'recipes' | 'skill' | 'character'; id: string; state: 'installed' | 'reused' }[]; error?: string };
export type CreativePackCatalog = {
  installed: CreativePackSummary[];
  recipes: { id: string; title: string }[];
  skills: { id: string; title: string; scope: 'general' | 'specialized' }[];
  characters: { id: string; name: string; referenceCount: number }[];
};
export const creativePackRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('fetch'), url: z.string().url().max(2000), path: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal('build'), pack: creativePackBuildSchema, path: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal('export'), id: identity.shape.id, path: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal('inspect'), path: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal('install'), path: z.string().min(1).max(4096), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
