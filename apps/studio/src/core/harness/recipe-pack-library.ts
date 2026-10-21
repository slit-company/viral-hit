import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { reviewPackUpdate, updatePack, reviewPackRemoval, removePack } from './recipe-pack-lifecycle.server';
import { packManifestSchema } from './recipe-packs';
import { recipeSchema } from './recipes';
import { loadRecipeDirectory, loadRecipes } from './recipe-registry';
import { readInstalledPacks, readInstalledRecipes, recipeDigest, RecipeConflictError, storeInstalledPack } from './recipe-storage';
import { supportedOperations } from './capabilities';
import { fetchPackFromLink } from './recipe-pack-source';
import { composePack, MAX_PACK_BYTES, packBuildSchema, type PackInspection } from './recipe-packs';
import { validatePack } from './recipe-pack-definition.server';
export { validatePack } from './recipe-pack-definition.server';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const recipePackRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('review-update'), pack: z.unknown() }).strict(),
  z.object({ action: z.literal('update'), pack: z.unknown(), expectedDigest: digest, expectedStateDigest: digest, replaceRecipeIds: z.array(recipeSchema.shape.id).max(24) }).strict(),
  z.object({ action: z.literal('review-remove'), packId: packManifestSchema.shape.id }).strict(),
  z.object({ action: z.literal('remove'), packId: packManifestSchema.shape.id, expectedStateDigest: digest, deleteRecipeIds: z.array(recipeSchema.shape.id).max(24) }).strict(),
  z.object({ action: z.literal('inspect'), pack: z.unknown() }).strict(),
  z.object({ action: z.literal('install'), pack: z.unknown(), expectedDigest: digest }).strict(),
  z.object({ action: z.literal('build'), pack: packBuildSchema }).strict(),
  z.object({ action: z.literal('fetch'), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), url: z.string().url().max(2000) }).strict(),
]);

export async function inspectPack(raw: unknown): Promise<PackInspection> {
  const { summary, recipes } = validatePack(raw);
  const [base, installed, packs] = [await loadRecipeDirectory(), readInstalledRecipes(), readInstalledPacks()];
  const supported = supportedOperations();
  const reviews = recipes.map(recipe => {
    const operations = [...new Set(recipe.nodes.map(node => node.operation))];
    const existing = installed.find(item => item.id === recipe.id);
    const collision = base.some(item => item.id === recipe.id) ? 'reserved' as const
      : existing ? recipeDigest(existing) === recipeDigest(recipe) ? 'same' as const : 'different' as const : 'none' as const;
    return { id: recipe.id, title: recipe.title, description: recipe.description, category: recipe.category, collision, operations,
      unavailableOperations: operations.filter(operation => !supported.has(operation)), parameterCount: recipe.parameters.length };
  });
  const previous = packs.find(pack => pack.id === summary.id);
  const collision = !previous ? 'none' as const : previous.digest === summary.digest ? 'same' as const : 'different' as const;
  const blocking = [
    ...(collision === 'different' ? ['A different version of this pack is installed. Use Review pack update to maintain the same pack ID.'] : []),
    ...reviews.filter(review => review.collision === 'reserved' || review.collision === 'different').map(review => `${review.id} conflicts with an existing recipe.`),
  ];
  const operations = [...new Set(reviews.flatMap(review => review.operations))];
  return { pack: summary, collision, recipes: reviews, operations, unavailableOperations: operations.filter(operation => !supported.has(operation)), blocking };
}

export async function installPack(raw: unknown, expectedDigest: string) {
  const { summary, recipes } = validatePack(raw);
  if (summary.digest !== expectedDigest) throw new RecipeConflictError('Pack changed after review. Review the current file again.');
  const base = await loadRecipeDirectory();
  const reserved = recipes.find(recipe => base.some(item => item.id === recipe.id));
  if (reserved) throw new RecipeConflictError(`${reserved.id} belongs to the file catalog.`);
  return storeInstalledPack(summary, recipes);
}

async function readPackFiles(files: string[]) {
  const result = [];
  for (const path of files) {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_PACK_BYTES) throw new Error('Invalid recipe pack file');
    const manifest = JSON.parse((await readFile(path)).toString('utf8'));
    result.push({ manifest, summary: validatePack(manifest).summary });
  }
  return result;
}

async function listDirectory(directory: string) {
  try { return await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

/** Packs shipped with an installation; they are offered, never installed automatically. */
export async function loadPackDirectory(directory = resolve(process.cwd(), '../../packs')) {
  const files = (await listDirectory(directory)).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => resolve(directory, entry.name)).sort();
  if (files.length > 50) throw new Error('Pack directory contains too many files');
  return readPackFiles(files);
}

/** Each optional extension may ship one pack.json describing its recipes and setup. */
export async function loadExtensionPacks(root = resolve(process.cwd(), '../../extensions')) {
  const files = (await listDirectory(root)).filter(entry => entry.isDirectory()).map(entry => resolve(root, entry.name, 'pack.json')).sort();
  const present = [];
  for (const file of files) if ((await lstat(file).catch(() => null))?.isFile()) present.push(file);
  if (present.length > 50) throw new Error('Too many extension packs');
  return readPackFiles(present);
}

/** VIRAL_HIT_PACKS_DIR replaces the bundled catalog; otherwise packs/ and extension packs are offered. */
export async function loadBundledPacks() {
  if (process.env.VIRAL_HIT_PACKS_DIR) return loadPackDirectory(process.env.VIRAL_HIT_PACKS_DIR);
  const packs = [...await loadPackDirectory(), ...await loadExtensionPacks()];
  const ids = new Set<string>();
  for (const pack of packs) { if (ids.has(pack.summary.id)) throw new Error('Duplicate bundled pack: ' + pack.summary.id); ids.add(pack.summary.id); }
  return packs;
}

export async function listRecipePacks() {
  const installed = readInstalledPacks();
  const available = (await loadBundledPacks()).map(item => {
    const current = installed.find(pack => pack.id === item.summary.id);
    return { ...item, state: !current ? 'available' as const : current.digest !== item.summary.digest ? 'other-version' as const : current.content.state === 'missing' ? 'incomplete' as const : current.content.state === 'modified' ? 'modified' as const : 'installed' as const };
  });
  return { installed, available };
}

/** Shared by HTTP, MCP and CLI. Installing never queues work. */
export async function changeRecipePacks(request: z.infer<typeof recipePackRequest>) {
  request = recipePackRequest.parse(request);
  switch (request.action) {
    case 'review-update': return reviewPackUpdate(request.pack);
    case 'update': return updatePack(request.pack, request.expectedDigest, request.expectedStateDigest, request.replaceRecipeIds);
    case 'review-remove': return reviewPackRemoval(request.packId);
    case 'remove': return removePack(request.packId, request.expectedStateDigest, request.deleteRecipeIds);
    case 'list': return listRecipePacks();
    case 'inspect': return inspectPack(request.pack);
    case 'install': return installPack(request.pack, request.expectedDigest);
    case 'build': return buildPack(request.pack);
    case 'fetch': {
      const fetched = await fetchPackFromLink(request.url, undefined, undefined, request.expectedSha256);
      return { ...fetched, inspection: await inspectPack(fetched.manifest) };
    }
  }
}

/** Builds a shareable pack file from local recipes. Nothing is installed or run. */
export async function buildPack(raw: z.input<typeof packBuildSchema>) {
  const manifest = composePack(raw, await loadRecipes());
  validatePack(manifest);
  return { manifest, inspection: await inspectPack(manifest) };
}
