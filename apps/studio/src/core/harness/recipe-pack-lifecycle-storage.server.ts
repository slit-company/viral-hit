import type { DatabaseSync } from 'node:sqlite';
import { fingerprint, type Json } from './durable';
import { openRecipeLibrary, recipeDigest, RecipeConflictError } from './recipe-database.server';
import { packSummarySchema, type PackSummary } from './recipe-packs';
import { recipeSchema, type Recipe } from './recipes';
import type { PackStateReview } from './recipe-pack-lifecycle-contract';

function snapshot(db: DatabaseSync, id: string, extraIds: string[], reservedIds: string[]): PackStateReview {
  const rows = db.prepare('SELECT id, summary, digest, installed_at FROM packs ORDER BY id LIMIT 201').all() as { id: string; summary: string; digest: string; installed_at: number }[];
  if (rows.length > 200) throw new Error('Pack library exceeds 200 packs');
  const packs = rows.map(row => {
    const parsed = packSummarySchema.parse(JSON.parse(row.summary));
    if (parsed.id !== row.id || parsed.digest !== row.digest) throw new Error('Recipe pack identity mismatch');
    return { ...parsed, installedAt: row.installed_at };
  });
  const pack = packs.find(item => item.id === id);
  if (!pack) throw new RecipeConflictError('Pack is no longer installed. Reload the library.');
  const query = db.prepare('SELECT manifest FROM recipes WHERE id=?');
  const members = [...new Set([...pack.recipeIds, ...extraIds])].sort().map(recipeId => {
    const row = query.get(recipeId) as { manifest: string } | undefined;
    if (row && Buffer.byteLength(row.manifest) > 128_000) throw new Error('Recipe manifest exceeds 128 KB');
    const current = row ? recipeSchema.parse(JSON.parse(row.manifest)) : undefined;
    if (current && current.id !== recipeId) throw new Error('Recipe library identity mismatch');
    return { id: recipeId, ...(current ? { current } : {}), reserved: reservedIds.includes(recipeId),
      otherPacks: packs.filter(item => item.id !== id && item.recipeIds.includes(recipeId)).map(item => ({ id: item.id, title: item.title })) };
  });
  return { pack, members, stateDigest: fingerprint({ pack, members } as unknown as Json) };
}

export function reviewInstalledPack(id: string, extraIds: string[], reservedIds: string[]) {
  const db = openRecipeLibrary(true);
  if (!db) throw new RecipeConflictError('Pack is not installed. Reload the library.');
  try {
    db.exec('BEGIN');
    return snapshot(db, id, extraIds, reservedIds);
  } finally { db.close(); }
}

function assertSelection(ids: string[], eligible: string[]) {
  if (new Set(ids).size !== ids.length || ids.some(id => !eligible.includes(id)))
    throw new RecipeConflictError('Recipe selection is not eligible for this reviewed change.');
}
function assertFresh(state: PackStateReview, expected: string) {
  if (state.stateDigest !== expected) throw new RecipeConflictError('Pack or recipes changed after review. Review the current library again.');
}

/** The reviewed composition and all selected member changes commit together. */
export function updateInstalledPack(summary: PackSummary, recipes: Recipe[], expectedStateDigest: string, replaceRecipeIds: string[], reservedIds: string[]) {
  const db = openRecipeLibrary()!;
  try {
    db.exec('BEGIN IMMEDIATE');
    const state = snapshot(db, summary.id, summary.recipeIds, reservedIds);
    assertFresh(state, expectedStateDigest);
    if (state.members.some(member => member.reserved && summary.recipeIds.includes(member.id)))
      throw new RecipeConflictError('Incoming recipe belongs to the file catalog.');
    const differing = recipes.filter(recipe => {
      const member = state.members.find(item => item.id === recipe.id)!;
      return member.current && recipeDigest(member.current) !== recipeDigest(recipe);
    }).map(recipe => recipe.id);
    assertSelection(replaceRecipeIds, differing);
    const added = recipes.filter(recipe => !state.members.find(item => item.id === recipe.id)!.current);
    const count = db.prepare('SELECT COUNT(*) AS n FROM recipes').get() as { n: number };
    if (count.n + added.length > 200) throw new RecipeConflictError('The local library cannot hold this update (200 recipes).');
    const now = Date.now();
    for (const recipe of added) db.prepare('INSERT INTO recipes (id,manifest,digest,installed_at) VALUES (?,?,?,?)').run(recipe.id, JSON.stringify(recipe), recipeDigest(recipe), now);
    for (const id of replaceRecipeIds) {
      const recipe = recipes.find(item => item.id === id)!;
      db.prepare('UPDATE recipes SET manifest=?,digest=? WHERE id=?').run(JSON.stringify(recipe), recipeDigest(recipe), id);
    }
    db.prepare('UPDATE packs SET summary=?,digest=? WHERE id=?').run(JSON.stringify(summary), summary.digest, summary.id);
    db.exec('COMMIT');
    return { pack: summary, updated: true, added: added.map(recipe => recipe.id), replaced: replaceRecipeIds,
      kept: state.members.filter(member => member.current && !replaceRecipeIds.includes(member.id)).map(member => member.id),
      detached: state.pack.recipeIds.filter(id => !summary.recipeIds.includes(id)) };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
}

export function removeInstalledPack(id: string, expectedStateDigest: string, deleteRecipeIds: string[], reservedIds: string[]) {
  const db = openRecipeLibrary()!;
  try {
    db.exec('BEGIN IMMEDIATE');
    if (!db.prepare('SELECT id FROM packs WHERE id=?').get(id)) {
      db.exec('COMMIT'); return { packId: id, removed: false, deleted: [], kept: [] };
    }
    const state = snapshot(db, id, [], reservedIds);
    assertFresh(state, expectedStateDigest);
    assertSelection(deleteRecipeIds, state.members.filter(member => member.current && !member.reserved && !member.otherPacks.length).map(member => member.id));
    for (const recipeId of deleteRecipeIds) db.prepare('DELETE FROM recipes WHERE id=?').run(recipeId);
    db.prepare('DELETE FROM packs WHERE id=?').run(id);
    db.exec('COMMIT');
    return { packId: id, removed: true, deleted: deleteRecipeIds, kept: state.members.filter(member => member.current && !deleteRecipeIds.includes(member.id)).map(member => member.id) };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
}
