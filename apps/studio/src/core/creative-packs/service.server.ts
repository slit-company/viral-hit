import { inspectLoaded, characterCollision } from './inspection.server';
import { updateCreativePack, removeCreativePack } from './lifecycle.server';
import { reviewCreativeLifecycle } from './lifecycle-review.server';
import { listCreativePackHistory } from './storage.server';
import { canonicalJson } from '@/lib/canonical-json';
import { installPack } from '@/core/harness/recipe-pack-library';
import { loadRecipes } from '@/core/harness/recipe-registry';
import { changeSkillLibrary, getSkillRegistry, inspectSkillFile, packageSkill, validateSkillFile } from '@/core/skills/library.server';
import { readCharacters } from '@/core/characters/storage.server';
import { createCharacter } from '@/core/characters/library.server';
import type { z } from 'zod';
import { creativePackRequest, type CreativePackCatalog, type CreativePackResult } from './contract';
import { composeCreativePack, recipePart } from './manifest.server';
import { withCreativePack, writeCreativePack, type LoadedCreativePack } from './file.server';
import { listStoredCreativePacks, readStoredCreativePack, storeCreativePack } from './storage.server';
import { fetchCreativePack } from './source.server';

export async function listCreativePacks(): Promise<CreativePackCatalog> {
  const [recipes, skills, installed, removed] = await Promise.all([loadRecipes(), getSkillRegistry(), listStoredCreativePacks(), listStoredCreativePacks(true)]);
  return { installed, removed, recipes: recipes.map(({ id, title }) => ({ id, title })),
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
    case 'history': return listCreativePackHistory(request.id);
    case 'review-remove': return reviewCreativeLifecycle(request.id);
    case 'remove': return removeCreativePack(request.id, request.expectedStateDigest);
    case 'update': return withCreativePack(request.path, signal, loaded => updateCreativePack(loaded, request.expectedDigest, request.expectedStateDigest, request.replaceKeys, signal));
    case 'fetch': return fetchCreativePack(request.url, request.path, signal, undefined, request.expectedSha256);
    case 'build': return writeCreativePack(await composeCreativePack(request.pack), request.path, signal);
    case 'export': {
      const manifest = await readStoredCreativePack(request.id, request.digest);
      if (!manifest) throw new Error('Installed creative pack not found');
      return writeCreativePack(manifest, request.path, signal);
    }
    case 'inspect': return withCreativePack(request.path, signal, inspectLoaded);
    case 'install': return withCreativePack(request.path, signal, loaded => installLoaded(loaded, request.expectedDigest, signal));
  }
}
