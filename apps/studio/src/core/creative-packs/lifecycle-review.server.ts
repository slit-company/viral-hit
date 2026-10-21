import { canonicalJson } from '@/lib/canonical-json';
import { fingerprint, type Json } from '@/core/harness/durable';
import { loadRecipeDirectory } from '@/core/harness/recipe-registry';
import { readInstalledPacks, readInstalledRecipes } from '@/core/harness/recipe-storage';
import { validateRecipeManifest } from '@/core/harness/recipe-library';
import { getSkillRegistry, inspectSkillFile, packageSkill, validateSkillFile } from '@/core/skills/library.server';
import { readCharacter } from '@/core/characters/storage.server';
import { pickProfile } from '@/core/characters/library.server';
import type { Character } from '@/core/characters/contract';
import type { CreativePackManifest } from './contract';
import type { CreativeLifecycleReview, CreativeMemberReview } from './lifecycle-contract';
import { readCreativePackState, listStoredCreativePacks, readStoredCreativePack, CreativePackConflictError } from './storage.server';

export function lifecycleDigest(review: Omit<CreativeLifecycleReview, 'stateDigest'>) {
  return fingerprint({ revision: review.revision,
    recipePack: review.recipePack ? { digest: review.recipePack.digest, installedAt: review.recipePack.installedAt } : null,
    members: review.members.map(({ key, current, reserved, otherPacks }) => ({ key, current, reserved, otherPacks })),
  } as unknown as Json);
}
function definitions(manifest: CreativePackManifest) {
  return [
    ...manifest.recipes.map(raw => { const recipe = validateRecipeManifest(raw); return { kind: 'recipe' as const, id: recipe.id, value: recipe }; }),
    ...manifest.skills.map(raw => { const skill = validateSkillFile(raw); return { kind: 'skill' as const, id: skill.manifest.id, value: skill }; }),
    ...manifest.characters.map(value => ({ kind: 'character' as const, id: value.id, value })),
  ];
}
export async function reviewCreativeLifecycle(id: string, incoming?: CreativePackManifest): Promise<CreativeLifecycleReview> {
  const state = await readCreativePackState(id);
  if (!state.manifest) throw new CreativePackConflictError('Creative pack is no longer installed. Reload the library.');
  const recipePacks = readInstalledPacks(), recipePack = recipePacks.find(pack => pack.id === id) ?? null;
  const existingDefinitions = definitions(state.manifest), incomingDefinitions = incoming ? definitions(incoming) : [];
  const targets = new Map<string, { kind: CreativeMemberReview['kind']; id: string }>([...existingDefinitions, ...incomingDefinitions].map(item => [item.kind + ':' + item.id, { kind: item.kind, id: item.id }]));
  for (const recipeId of recipePack?.recipeIds ?? []) if (!targets.has('recipe:' + recipeId)) targets.set('recipe:' + recipeId, { kind: 'recipe', id: recipeId });
  const base = await loadRecipeDirectory(), recipes = readInstalledRecipes(), skills = await getSkillRegistry();
  const membership = new Map<string, { id: string; title: string }[]>();
  // Read one manifest at a time; do not retain every installed pack's definitions/images.
  for (const pack of await listStoredCreativePacks()) {
    if (pack.id === id) continue;
    const manifest = await readStoredCreativePack(pack.id); if (!manifest) continue;
    for (const member of definitions(manifest)) {
      const key = member.kind + ':' + member.id;
      if (targets.has(key)) membership.set(key, [...(membership.get(key) ?? []), { id: pack.id, title: pack.title }]);
    }
  }
  const members: CreativeMemberReview[] = [];
  for (const [key, target] of [...targets].sort(([a], [b]) => a.localeCompare(b))) {
    const next = incomingDefinitions.find(item => item.kind === target.kind && item.id === target.id)?.value ?? null;
    let current: unknown | null = null, reserved = false, blocking: string[] = [], same = false;
    const otherPacks = [...(membership.get(key) ?? [])];
    if (target.kind === 'recipe') {
      const file = base.find(recipe => recipe.id === target.id); reserved = !!file;
      current = file ?? recipes.find(recipe => recipe.id === target.id) ?? null;
      for (const pack of recipePacks) if (pack.id !== id && pack.recipeIds.includes(target.id) && !otherPacks.some(item => item.id === pack.id)) otherPacks.push({ id: pack.id, title: pack.title });
    } else if (target.kind === 'skill') {
      const skill = skills.get(target.id); current = skill ? packageSkill(skill) : null; reserved = !!skill && skill.source !== 'installed';
      if (next) blocking = (await inspectSkillFile(next)).skill.incompatibilities;
    } else current = readCharacter(target.id);
    if (current && next) {
      if (target.kind === 'character') {
        const character = current as Character;
        same = character.status === 'active' && canonicalJson({ schemaVersion: 1, kind: 'viral-hit-character', id: character.id, profile: pickProfile(character), references: character.references }) === canonicalJson(next);
      } else same = canonicalJson(current as Json) === canonicalJson(next);
    }
    if (reserved && next && !same) blocking.push('This ID belongs to the file catalog or an official/operator skill. Keep it or use another ID.');
    members.push({ key, kind: target.kind, id: target.id, current, incoming: next, reserved, blocking, otherPacks: otherPacks.sort((a, b) => a.id.localeCompare(b.id)),
      change: !next ? current ? 'detach' : 'missing' : !current ? 'add' : same ? 'same' : 'different' });
  }
  const review = { current: state.manifest, revision: state.revision, recipePack, members };
  return { ...review, stateDigest: lifecycleDigest(review) };
}
