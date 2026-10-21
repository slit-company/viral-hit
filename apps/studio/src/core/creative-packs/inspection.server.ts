import { canonicalJson } from '@/lib/canonical-json';
import { inspectPack } from '@/core/harness/recipe-pack-library';
import { getSkillRegistry, inspectSkillFile, packageSkill, validateSkillFile } from '@/core/skills/library.server';
import { readCharacter } from '@/core/characters/storage.server';
import { pickProfile } from '@/core/characters/library.server';
import type { CharacterFileManifest } from '@/core/characters/contract';
import type { CreativePackInspection } from './contract';
import type { LoadedCreativePack } from './file.server';
import { summarizeCreativePack, recipePart } from './manifest.server';
import { readStoredCreativePack } from './storage.server';
import { reviewCreativeLifecycle } from './lifecycle-review.server';

export function characterCollision(manifest: CharacterFileManifest): 'none' | 'same' | 'different' {
  const existing = readCharacter(manifest.id);
  if (!existing) return 'none';
  return existing.status === 'active' && canonicalJson({ profile: pickProfile(existing), references: existing.references }) === canonicalJson({ profile: manifest.profile, references: manifest.references }) ? 'same' : 'different';
}
export async function inspectLoaded({ manifest, media }: LoadedCreativePack): Promise<CreativePackInspection> {
  const pack = summarizeCreativePack(manifest), stored = await readStoredCreativePack(pack.id);
  const recipes = manifest.recipes.length ? await inspectPack(recipePart(manifest)) : null;
  const registry = await getSkillRegistry(), skills = [];
  for (const file of manifest.skills) {
    const inspection = await inspectSkillFile(file), existing = registry.get(file.manifest.id);
    const reused = !!existing && canonicalJson(validateSkillFile(packageSkill(existing))) === canonicalJson(file);
    // An identical bundled/operator skill already satisfies the pack; a different one still blocks it.
    if (reused) { inspection.collision = 'same'; inspection.blocking = inspection.skill.incompatibilities; }
    skills.push({ file, inspection, reused });
  }
  const characters = manifest.characters.map(character => ({ manifest: character, collision: characterCollision(character), previews: character.references.map(reference => {
    const image = media.get(reference.sha256)!; return { sha256: reference.sha256, offset: image.offset, size: image.size };
  }) }));
  return { pack, recipes, skills, characters, blocking: [
    ...(stored && summarizeCreativePack(stored).digest !== pack.digest ? ['A different creative pack has this ID. Review a creative-pack update to maintain this ID.'] : []),
    ...(recipes?.blocking ?? []), ...skills.flatMap(skill => skill.inspection.blocking.map(message => skill.file.manifest.id + ': ' + message)),
    ...characters.filter(character => character.collision === 'different').map(character => character.manifest.id + ': another character uses this ID. Rename the source character before sharing.'),
  ], ...(stored ? { update: await reviewCreativeLifecycle(pack.id, manifest) } : {}) };
}
