import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { changeRecipePacks, inspectPack, installPack } from './recipe-pack-library';
import { reviewPackUpdate, updatePack, reviewPackRemoval, removePack } from './recipe-pack-lifecycle.server';
import { inspectRecipe, changeRecipeLibrary } from './recipe-library';
import { readInstalledPacks, readInstalledRecipes, storeInstalledRecipe } from './recipe-storage';
import { recipeDigest } from './recipe-database.server';
import { recipeSchema } from './recipes';
import { prepareRecipePlan } from './recipe-plan';
import { DurableHarness } from './durable';

const source = JSON.parse(await readFile('../../recipes/local-canvas.json', 'utf8'));
const recipe = (id: string, version = '1.0.0') => recipeSchema.parse({ ...source, id, version });
const makePack = (id = 'maintained-kit', recipes = [recipe(id + '-canvas'), recipe(id + '-old')]) => ({
  schemaVersion: 1, kind: 'viral-hit-pack', id, version: '1.0.0', title: 'Maintained kit', description: 'Any creative project', author: 'Independent author', license: 'MIT', scope: 'general', useCases: ['editing'], recipes,
});
async function isolated(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'vh-pack-lifecycle-'));
  const before = { data: process.env.VIRAL_HIT_DATA_DIR, recipes: process.env.VIRAL_HIT_RECIPES_DIR };
  process.env.VIRAL_HIT_DATA_DIR = join(root, 'data'); process.env.VIRAL_HIT_RECIPES_DIR = join(root, 'recipes');
  await mkdir(process.env.VIRAL_HIT_RECIPES_DIR);
  try { await run(root); }
  finally {
    for (const [key, value] of [['VIRAL_HIT_DATA_DIR', before.data], ['VIRAL_HIT_RECIPES_DIR', before.recipes]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}
async function install(pack: ReturnType<typeof makePack>) { return installPack(pack, (await inspectPack(pack)).pack.digest); }
async function revise(id: string, version: string) {
  const current = readInstalledRecipes().find(item => item.id === id)!;
  const inspection = await inspectRecipe({ ...current, version });
  await changeRecipeLibrary({ action: 'update', manifest: inspection.recipe, expectedDigest: inspection.digest, expectedInstalledDigest: recipeDigest(current) });
}
test('pack update adds recipes, explicitly replaces selected definitions, preserves custom/dropped recipes and queued plans', () => isolated(async root => {
  const first = makePack(); await install(first);
  await revise(first.recipes[0].id, '9.0.0');
  const beforeInstallTime = readInstalledPacks()[0].installedAt;
  const plan = await prepareRecipePlan(first.recipes[0].id, {}, 'project');
  let harness = new DurableHarness(join(root, 'jobs.sqlite'));
  const run = harness.enqueue(plan, 'queued-before-update'), jobs = harness.jobs(run); harness.close();
  const next = { ...first, version: '2.0.0', scope: 'specialized', useCases: ['product'], recipes: [recipe(first.recipes[0].id, '2.0.0'), recipe(first.id + '-new')] };
  const review = await reviewPackUpdate(next);
  assert.equal(review.changes.find(item => item.id === first.recipes[0].id)?.current?.version, '9.0.0');
  assert.deepEqual(review.changes.map(item => item.change), ['different', 'add', 'detach']);
  const applied = await updatePack(next, review.incoming.digest, review.stateDigest, []);
  assert.deepEqual(applied.added, [first.id + '-new']); assert.deepEqual(applied.replaced, []);
  assert.deepEqual(applied.detached, [first.id + '-old']);
  assert.equal(readInstalledRecipes().find(item => item.id === first.id + '-canvas')?.version, '9.0.0');
  assert.ok(readInstalledRecipes().some(item => item.id === first.id + '-old'));
  assert.equal(readInstalledPacks()[0].installedAt, beforeInstallTime);
  assert.equal(readInstalledPacks()[0].scope, 'specialized');
  assert.equal(readInstalledPacks()[0].content.state, 'modified');
  await assert.rejects(updatePack(next, review.incoming.digest, review.stateDigest, [first.id + '-canvas']), /changed after review/);
  const again = await reviewPackUpdate(next);
  await updatePack(next, again.incoming.digest, again.stateDigest, [first.id + '-canvas']);
  assert.equal(readInstalledPacks()[0].content.state, 'complete');
  assert.equal(readInstalledRecipes().find(item => item.id === first.id + '-canvas')?.version, '2.0.0');
  const removal = await reviewPackRemoval(first.id);
  await removePack(first.id, removal.stateDigest, [first.id + '-canvas']);
  assert.equal(readInstalledPacks().length, 0);
  assert.deepEqual(readInstalledRecipes().map(item => item.id), [first.id + '-new', first.id + '-old']);
  harness = new DurableHarness(join(root, 'jobs.sqlite'));
  assert.deepEqual(harness.jobs(run), jobs); harness.close();
  // A replay after removal cannot delete detached recipes.
  assert.equal((await removePack(first.id, removal.stateDigest, [first.id + '-new'])).removed, false);
  assert.equal(readInstalledRecipes().length, 2);
}));

test('incoming bytes, concurrent recipe edits, absence, membership and file-catalog changes invalidate reviews', () => isolated(async root => {
  const first = makePack(); await install(first);
  const next = { ...first, version: '2.0.0', recipes: [recipe(first.recipes[0].id, '2.0.0'), recipe(first.id + '-new')] };
  let review = await reviewPackUpdate(next);
  await assert.rejects(updatePack({ ...next, title: 'Changed bytes' }, review.incoming.digest, review.stateDigest, []), /Incoming pack changed/);
  await revise(first.recipes[0].id, '9.0.0');
  await assert.rejects(updatePack(next, review.incoming.digest, review.stateDigest, []), /changed after review/);
  review = await reviewPackUpdate(next);
  storeInstalledRecipe(recipe(first.id + '-new', '8.0.0'));
  await assert.rejects(updatePack(next, review.incoming.digest, review.stateDigest, []), /changed after review/);
  review = await reviewPackUpdate(next);
  await writeFile(join(root, 'recipes', 'reserved.json'), JSON.stringify(recipe(first.id + '-new')));
  await assert.rejects(updatePack(next, review.incoming.digest, review.stateDigest, []), /changed after review/);
  const reserved = await reviewPackUpdate(next);
  assert.match(reserved.blocking.join(), /file catalog/);
  await assert.rejects(updatePack(next, reserved.incoming.digest, reserved.stateDigest, []), /file catalog/);
  await rm(join(root, 'recipes', 'reserved.json'));
  const beforeRemove = await reviewPackRemoval(first.id);
  const parent = makePack('maintained', [readInstalledRecipes().find(item => item.id === first.recipes[0].id)!]);
  await install(parent);
  await assert.rejects(removePack(first.id, beforeRemove.stateDigest, [first.recipes[0].id]), /changed after review/);
  const shared = await reviewPackRemoval(first.id);
  assert.deepEqual(shared.members[0].otherPacks.map(pack => pack.id), ['maintained']);
  await assert.rejects(removePack(first.id, shared.stateDigest, [first.recipes[0].id]), /not eligible/);
  await removePack(first.id, shared.stateDigest, [first.recipes[1].id]);
  assert.ok(readInstalledRecipes().some(item => item.id === first.recipes[0].id));
  assert.equal(readInstalledPacks()[0].id, 'maintained');
}));

test('invalid selections reject atomically and removal keeps every member by default, including missing and reserved members', () => isolated(async root => {
  const first = makePack(); await install(first);
  const next = { ...first, version: '2.0.0', recipes: [recipe(first.recipes[0].id, '2.0.0'), recipe(first.id + '-new')] };
  const review = await reviewPackUpdate(next);
  for (const selected of [[first.id + '-new'], ['unrelated'], [first.recipes[0].id, first.recipes[0].id]])
    await assert.rejects(updatePack(next, review.incoming.digest, review.stateDigest, selected), /not eligible/);
  assert.equal(readInstalledRecipes().length, 2); assert.equal(readInstalledPacks()[0].version, '1.0.0');
  await changeRecipeLibrary({ action: 'remove', recipeId: first.recipes[1].id, expectedDigest: recipeDigest(first.recipes[1]) });
  const missing = await reviewPackUpdate(next);
  assert.equal(missing.changes.find(item => item.id === first.recipes[1].id)?.change, 'missing');
  await writeFile(join(root, 'recipes', 'reserved.json'), JSON.stringify(first.recipes[0]));
  const removal = await reviewPackRemoval(first.id);
  await assert.rejects(removePack(first.id, removal.stateDigest, [first.recipes[0].id]), /not eligible/);
  assert.equal((await removePack(first.id, removal.stateDigest, [])).removed, true);
  assert.equal(readInstalledRecipes().length, 1);
  await assert.rejects(reviewPackRemoval(first.id), /no longer installed/);
  await assert.rejects(changeRecipePacks({ action: 'remove', packId: 'bad/path', expectedStateDigest: 'x', deleteRecipeIds: [] }), /Invalid/);
}));

test('capacity failures roll back the whole release; missing members can be restored with the same release', () => isolated(async () => {
  const first = makePack(); await install(first);
  for (let index = 0; index < 198; index++) storeInstalledRecipe(recipe('filler-' + index));
  const next = { ...first, version: '2.0.0', recipes: [recipe(first.recipes[0].id, '2.0.0'), recipe(first.id + '-new')] };
  const review = await reviewPackUpdate(next);
  await assert.rejects(updatePack(next, review.incoming.digest, review.stateDigest, [first.recipes[0].id]), /200 recipes/);
  assert.equal(readInstalledPacks()[0].version, '1.0.0');
  assert.equal(readInstalledRecipes().find(item => item.id === first.recipes[0].id)?.version, '1.0.0');
  await changeRecipeLibrary({ action: 'remove', recipeId: first.recipes[1].id, expectedDigest: recipeDigest(first.recipes[1]) });
  const restore = await reviewPackUpdate(first);
  await updatePack(first, restore.incoming.digest, restore.stateDigest, []);
  assert.equal(readInstalledPacks()[0].content.state, 'complete');
  assert.equal(readInstalledRecipes().length, 200);
}));

test('two CLI processes cannot apply different releases against one pack review', () => isolated(async root => {
  const first = makePack(); await install(first);
  const a = { ...first, version: '2.0.0', title: 'Release A' }, b = { ...a, title: 'Release B' };
  const ar = await reviewPackUpdate(a), br = await reviewPackUpdate(b);
  const files = [join(root, 'a.json'), join(root, 'b.json')];
  for (const [index, [pack, review]] of [[a, ar], [b, br]].entries()) {
    const r = review as typeof ar;
    await writeFile(files[index], JSON.stringify({ action: 'update', pack, expectedDigest: r.incoming.digest, expectedStateDigest: r.stateDigest, replaceRecipeIds: [] }));
  }
  const cli = (args: string[]) => promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/recipe.ts', ...args], { env: { ...process.env } });
  const outcomes = await Promise.allSettled(files.map(file => cli(['pack-request', file])));
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.match(String((outcomes.find(item => item.status === 'rejected') as PromiseRejectedResult).reason), /changed after review/);
  const removal = JSON.parse((await cli(['review-remove-pack', first.id])).stdout);
  const path = join(root, 'remove.json');
  await writeFile(path, JSON.stringify({ action: 'remove', packId: first.id, expectedStateDigest: removal.stateDigest, deleteRecipeIds: [] }));
  await cli(['pack-request', path]);
  assert.equal(readInstalledPacks().length, 0); assert.equal(readInstalledRecipes().length, 2);
}));
