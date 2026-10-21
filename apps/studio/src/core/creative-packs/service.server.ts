import { canonicalJson } from '@/lib/canonical-json';
import { inspectPack, installPack } from '@/core/harness/recipe-pack-library';
import { loadRecipes } from '@/core/harness/recipe-registry';
import { changeSkillLibrary, getSkillRegistry, inspectSkillFile, packageSkill, validateSkillFile } from '@/core/skills/library.server';
import { readCharacter, readCharacters } from '@/core/characters/storage.server';
import { createCharacter, pickProfile } from '@/core/characters/library.server';
import type { CharacterFileManifest } from '@/core/characters/contract';
import type { z } from 'zod';
import { creativePackRequest, type CreativePackCatalog, type CreativePackInspection, type CreativePackResult } from './contract';
import { composeCreativePack, recipePart, summarizeCreativePack } from './manifest.server';
import { withCreativePack, writeCreativePack, type LoadedCreativePack } from './file.server';
import { listStoredCreativePacks, readStoredCreativePack, storeCreativePack } from './storage.server';
import { fetchCreativePack } from './source.server';

function characterCollision(manifest: CharacterFileManifest): 'none' | 'same' | 'different' {
  const existing = readCharacter(manifest.id);
  if (!existing) return 'none';
  return existing.status === 'active' && canonicalJson({ profile: pickProfile(existing), references: existing.references }) === canonicalJson({ profile: manifest.profile, references: manifest.references }) ? 'same' : 'different';
}
async function inspectLoaded({ manifest, media }: LoadedCreativePack): Promise<CreativePackInspection> {
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
    ...(stored && summarizeCreativePack(stored).digest !== pack.digest ? ['A different creative pack has this ID. Use a new pack ID for another revision.'] : []),
    ...(recipes?.blocking ?? []), ...skills.flatMap(skill => skill.inspection.blocking.map(message => skill.file.manifest.id + ': ' + message)),
    ...characters.filter(character => character.collision === 'different').map(character => character.manifest.id + ': another character uses this ID. Rename the source character before sharing.'),
  ] };
}
export async function listCreativePacks(): Promise<CreativePackCatalog> {
  const [recipes, skills, installed] = await Promise.all([loadRecipes(), getSkillRegistry(), listStoredCreativePacks()]);
  return { installed, recipes: recipes.map(({ id, title }) => ({ id, title })),
    skills: skills.list().map(({ manifest }) => ({ id: manifest.id, title: manifest.title, scope: manifest.scope })),
    characters: readCharacters().map(({ id, name, references }) => ({ id, name, referenceCount: references.length })) };
}

async function installLoaded(loaded: LoadedCreativePack, digest: string, signal: AbortSignal): Promise<CreativePackResult> {
  const review = await inspectLoaded(loaded), items: CreativePackResult['items'] = [];
  if (review.pack.digest !== digest) throw new Error('Pack changed after review. Review this file again.');
  if (review.blocking.length) throw new Error(review.blocking.join(' '));
  // Every member is validated before the first mutation. Separate libraries retain their own atomic writes.
  // A concurrent change or I/O error can leave a partial install; report it explicitly and resume by reusing exact contents.
  try {
    if (review.recipes) {
      signal.throwIfAborted();
      await installPack(recipePart(loaded.manifest), review.recipes.pack.digest);
      items.push({ kind: 'recipes', id: review.pack.id, state: review.recipes.collision === 'same' ? 'reused' : 'installed' });
    }
    for (const { file } of review.skills) {
      signal.throwIfAborted();
      const registry = await getSkillRegistry(), existing = registry.get(file.manifest.id);
      const reused = !!existing && canonicalJson(validateSkillFile(packageSkill(existing))) === canonicalJson(file);
      if (!reused) {
        const current = await inspectSkillFile(file);
        await changeSkillLibrary({ action: 'install', file, expectedDigest: current.digest });
      }
      items.push({ kind: 'skill', id: file.manifest.id, state: reused ? 'reused' : 'installed' });
    }
    for (const { manifest } of review.characters) {
      signal.throwIfAborted();
      const collision = characterCollision(manifest);
      if (collision === 'different') throw new Error('Character changed while installing: ' + manifest.id);
      if (collision === 'none') {
        try { await createCharacter({ id: manifest.id, profile: manifest.profile }, manifest.references.map(reference => ({ path: loaded.media.get(reference.sha256)!.path, filename: reference.filename, role: reference.role, note: reference.note }))); }
        catch (error) { if (characterCollision(manifest) !== 'same') throw error; }
      }
      items.push({ kind: 'character', id: manifest.id, state: collision === 'same' ? 'reused' : 'installed' });
    }
    signal.throwIfAborted(); await storeCreativePack(loaded.manifest);
    return { complete: true, pack: review.pack, items };
  } catch (error) { return { complete: false, pack: review.pack, items, error: error instanceof Error ? error.message : 'Installation interrupted. Review and retry the same file.' }; }
}

/** Shared transport boundary. Installation neither executes skills nor starts generation/publication. */
export async function changeCreativePacks(raw: z.infer<typeof creativePackRequest>, signal = AbortSignal.timeout(5 * 60_000)) {
  const request = creativePackRequest.parse(raw);
  switch (request.action) {
    case 'list': return listCreativePacks();
    case 'fetch': return fetchCreativePack(request.url, request.path, signal);
    case 'build': return writeCreativePack(await composeCreativePack(request.pack), request.path, signal);
    case 'export': {
      const manifest = await readStoredCreativePack(request.id);
      if (!manifest) throw new Error('Installed creative pack not found');
      return writeCreativePack(manifest, request.path, signal);
    }
    case 'inspect': return withCreativePack(request.path, signal, inspectLoaded);
    case 'install': return withCreativePack(request.path, signal, loaded => installLoaded(loaded, request.expectedDigest, signal));
  }
}
