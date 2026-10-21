import { createHash } from 'node:crypto';
import { canonicalJson } from '@/lib/canonical-json';
import { composePack } from '@/core/harness/recipe-packs';
import { validatePack } from '@/core/harness/recipe-pack-library';
import { loadRecipes } from '@/core/harness/recipe-registry';
import { getSkillRegistry, packageSkill, validateSkillFile } from '@/core/skills/library.server';
import { readCharacter } from '@/core/characters/storage.server';
import { pickProfile } from '@/core/characters/library.server';
import { creativePackBuildSchema, creativePackManifestSchema, MAX_CREATIVE_MANIFEST_BYTES, type CreativePackBuild, type CreativePackManifest, type CreativePackSummary } from './contract';

export const recipePart = (manifest: CreativePackManifest) => {
  const { skills: _, characters: __, ...pack } = manifest;
  return { ...pack, kind: 'viral-hit-pack' as const };
};
export function validateCreativeManifest(raw: unknown) {
  if (Buffer.byteLength(JSON.stringify(raw) ?? '') > MAX_CREATIVE_MANIFEST_BYTES) throw new Error('Pack definitions must fit in 5 MB');
  const manifest = creativePackManifestSchema.parse(raw);
  if (manifest.recipes.length) validatePack(recipePart(manifest));
  for (const skill of manifest.skills) validateSkillFile(skill);
  for (const ids of [manifest.skills.map(skill => skill.manifest.id), manifest.characters.map(character => character.id)]) {
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate item IDs in pack');
  }
  return manifest;
}
export function summarizeCreativePack(manifest: CreativePackManifest): CreativePackSummary {
  const { schemaVersion: _, kind: __, recipes, skills, characters, ...identity } = manifest;
  return { ...identity, digest: createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(manifest)))).digest('hex'), recipeCount: recipes.length, skillCount: skills.length, characterCount: characters.length };
}
export async function composeCreativePack(raw: CreativePackBuild) {
  const { recipeIds, skillIds, characterIds, ...identity } = creativePackBuildSchema.parse(raw);
  const registry = await getSkillRegistry();
  const skills = skillIds.map(id => { const skill = registry.get(id); if (!skill) throw new Error('Skill not found: ' + id); return packageSkill(skill); });
  const characters = characterIds.map(id => {
    const character = readCharacter(id);
    if (!character || character.status !== 'active') throw new Error('Active character not found: ' + id);
    return { schemaVersion: 1 as const, kind: 'viral-hit-character' as const, id, profile: pickProfile(character), references: character.references };
  });
  const recipes = recipeIds.length ? composePack({ ...identity, recipeIds }, await loadRecipes()).recipes : [];
  return validateCreativeManifest({ ...identity, schemaVersion: 1, kind: 'viral-hit-creative-pack', recipes, skills, characters });
}
