import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { fingerprint, type Json } from './durable';
import { loadRecipeDirectory, loadRecipes } from './recipe-registry';
import { validateRecipeManifest } from './recipe-library';
import { readInstalledPacks, readInstalledRecipes, recipeDigest, RecipeConflictError, storeInstalledPack } from './recipe-storage';
import { supportedOperations } from './capabilities';
import { fetchPackFromLink } from './recipe-pack-source';
import { composePack, MAX_PACK_BYTES, packBuildSchema, packManifestSchema, type PackInspection, type PackSummary } from './recipe-packs';
import type { Recipe } from './recipes';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const recipePackRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('inspect'), pack: z.unknown() }).strict(),
  z.object({ action: z.literal('install'), pack: z.unknown(), expectedDigest: digest }).strict(),
  z.object({ action: z.literal('build'), pack: packBuildSchema }).strict(),
  z.object({ action: z.literal('fetch'), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), url: z.string().url().max(2000) }).strict(),
]);

export function validatePack(raw: unknown) {
  const bytes = JSON.stringify(raw);
  if (!bytes || Buffer.byteLength(bytes) > MAX_PACK_BYTES) throw new Error('Recipe pack exceeds 1 MB');
  const parsed = packManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.slice(0, 6).map(issue => (issue.path.length ? issue.path.join('.') + ': ' : '') + issue.message).join('; ');
    throw new Error(raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'viral-hit-pack' ? 'Invalid pack: ' + fields : 'This file is not a Viral Hit pack (' + fields + ')');
  }
  const manifest = parsed.data;
  const recipes: Recipe[] = manifest.recipes.map((recipe, index) => {
    try { return validateRecipeManifest(recipe); }
    catch (error) { throw new Error(`Recipe ${index + 1}: ${error instanceof Error ? error.message : 'invalid'}`); }
  });
  const ids = new Set<string>();
  for (const recipe of recipes) {
    // The prefix keeps packs from claiming each other's or built-in recipe IDs.
    if (!recipe.id.startsWith(`${manifest.id}-`)) throw new Error(`Recipe ${recipe.id} must start with "${manifest.id}-"`);
    if (ids.has(recipe.id)) throw new Error(`Duplicate recipe ID in pack: ${recipe.id}`);
    ids.add(recipe.id);
  }
  const { recipes: _, ...meta } = manifest;
  const summary: PackSummary = { ...meta, recipeIds: recipes.map(recipe => recipe.id), digest: fingerprint({ ...meta, recipes } as unknown as Json) };
  return { summary, recipes };
}

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
    ...(collision === 'different' ? ['A different version of this pack is installed. Publish updates under a new pack ID.'] : []),
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
  switch (request.action) {
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
