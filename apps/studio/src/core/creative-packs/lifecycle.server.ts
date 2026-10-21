import { readFile } from 'node:fs/promises';
import { changeRecipeLibrary, validateRecipeManifest } from '@/core/harness/recipe-library';
import { recipeDigest } from '@/core/harness/recipe-database.server';
import { validatePack } from '@/core/harness/recipe-pack-definition.server';
import { commitRecipePackMembership } from '@/core/harness/recipe-pack-membership.server';
import { changeSkillLibrary, validateSkillFile } from '@/core/skills/library.server';
import { skillDigest } from '@/core/skills/file.server';
import { createCharacter, replaceCharacterDefinition } from '@/core/characters/library.server';
import { storeReferenceBytes } from '@/core/characters/storage.server';
import { characterFileManifestSchema, characterSchema } from '@/core/characters/contract';
import type { CreativePackResult } from './contract';
import type { CreativeMemberReview } from './lifecycle-contract';
import type { LoadedCreativePack } from './file.server';
import { recipePart, summarizeCreativePack } from './manifest.server';
import { reviewCreativeLifecycle, lifecycleDigest } from './lifecycle-review.server';
import { commitCreativePack, CreativePackConflictError } from './storage.server';

async function applyMember(member: CreativeMemberReview, loaded: LoadedCreativePack) {
  if (member.kind === 'recipe') {
    const next = validateRecipeManifest(member.incoming);
    await changeRecipeLibrary(member.current
      ? { action: 'update', manifest: next, expectedDigest: recipeDigest(next), expectedInstalledDigest: recipeDigest(validateRecipeManifest(member.current)) }
      : { action: 'install', manifest: next, expectedDigest: recipeDigest(next) });
    return next;
  }
  if (member.kind === 'skill') {
    const next = validateSkillFile(member.incoming);
    await changeSkillLibrary(member.current
      ? { action: 'update', file: next, expectedDigest: skillDigest(next), expectedInstalledDigest: skillDigest(validateSkillFile(member.current)) }
      : { action: 'install', file: next, expectedDigest: skillDigest(next) });
    return next;
  }
  const next = characterFileManifestSchema.parse(member.incoming);
  const sources = next.references.map(reference => ({ path: loaded.media.get(reference.sha256)!.path, filename: reference.filename, role: reference.role, note: reference.note }));
  return member.current
    ? replaceCharacterDefinition({ id: next.id, expectedVersion: characterSchema.parse(member.current).version, profile: next.profile }, sources)
    : createCharacter({ id: next.id, profile: next.profile }, sources);
}

/** Cross-library writes stay explicit and recoverable; no distributed atomicity is claimed. */
export async function updateCreativePack(loaded: LoadedCreativePack, expectedDigest: string, expectedStateDigest: string, replaceKeys: string[], signal: AbortSignal) {
  const pack = summarizeCreativePack(loaded.manifest), review = await reviewCreativeLifecycle(pack.id, loaded.manifest);
  if (pack.digest !== expectedDigest || review.stateDigest !== expectedStateDigest) throw new CreativePackConflictError('Creative pack or library changed after review. Review the retained file again.');
  const eligible = review.members.filter(member => member.change === 'different' && !member.reserved).map(member => member.key);
  if (new Set(replaceKeys).size !== replaceKeys.length || replaceKeys.some(key => !eligible.includes(key))) throw new CreativePackConflictError('Only reviewed, replaceable definitions can be selected.');
  const applying = review.members.filter(member => member.change === 'add' || replaceKeys.includes(member.key));
  if (review.members.some(member => member.kind === 'recipe' && member.reserved && member.incoming)) throw new CreativePackConflictError('A recipe ID belongs to the file catalog. Use another ID.');
  const blockers = applying.flatMap(member => member.blocking.map(reason => member.key + ': ' + reason));
  if (blockers.length) throw new CreativePackConflictError(blockers.join(' '));
  const items: CreativePackResult['items'] = [], expected = structuredClone(review);
  try {
    // Every incoming image belongs to the retained release even when the user keeps a local character.
    for (const [hash, image] of loaded.media) { signal.throwIfAborted(); await storeReferenceBytes(hash, await readFile(image.path)); }
    for (const member of review.members) {
      signal.throwIfAborted();
      if (applying.includes(member)) {
        const result = await applyMember(member, loaded);
        expected.members.find(item => item.key === member.key)!.current = result;
        items.push({ kind: member.kind, id: member.id, state: member.current ? 'updated' : 'installed' });
      } else items.push({ kind: member.kind, id: member.id, state: member.change === 'same' ? 'reused' : 'kept' });
    }
    signal.throwIfAborted();
    const after = await reviewCreativeLifecycle(pack.id, loaded.manifest);
    if (after.stateDigest !== lifecycleDigest(expected)) throw new CreativePackConflictError('A library changed during this update. Inspect partial results before continuing.');
    const nextRecipes = loaded.manifest.recipes.length ? validatePack(recipePart(loaded.manifest)).summary : null;
    commitRecipePackMembership(pack.id, review.recipePack, nextRecipes, expected.members.filter(member => member.kind === 'recipe').map(member => ({ id: member.id, digest: member.current && !member.reserved ? recipeDigest(validateRecipeManifest(member.current)) : null })));
    await commitCreativePack(pack.id, review.revision, loaded.manifest);
    return { complete: true, pack, items } satisfies CreativePackResult;
  } catch (error) {
    return { complete: false, pack, items, error: error instanceof Error ? error.message : 'Update interrupted. Review the same retained file again.' } satisfies CreativePackResult;
  }
}

export async function removeCreativePack(id: string, expectedStateDigest: string) {
  const review = await reviewCreativeLifecycle(id);
  if (review.stateDigest !== expectedStateDigest) throw new CreativePackConflictError('Creative pack or library changed after review. Review removal again.');
  await commitCreativePack(id, review.revision, null);
  return { removed: true, id, retainedReleases: true, retainedLibraryEntries: true };
}
