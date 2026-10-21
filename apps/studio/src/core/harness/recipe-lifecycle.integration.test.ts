import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  changeRecipeLibrary,
  inspectRecipe,
  installRecipe,
  validateRecipeManifest,
} from './recipe-library';
import { loadRecipeCatalog } from './recipe-registry';
import { readInstalledPacks, readInstalledRecipes } from './recipe-storage';
import { prepareRecipePlan } from './recipe-plan';
import {
  inspectPack,
  installPack,
  listRecipePacks,
} from './recipe-pack-library';
import { DurableHarness } from './durable';
import { changeCreativePacks } from '@/core/creative-packs/service.server';

const original = JSON.parse(
  await readFile('../../recipes/local-canvas.json', 'utf8'),
);
async function isolated(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'vh-recipe-lifecycle-'));
  const names = [
    'VIRAL_HIT_DATA_DIR',
    'VIRAL_HIT_RECIPES_DIR',
    'VIRAL_HIT_PACKS_DIR',
  ] as const;
  const before = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  process.env.VIRAL_HIT_DATA_DIR = join(root, 'data');
  process.env.VIRAL_HIT_RECIPES_DIR = join(root, 'recipes');
  process.env.VIRAL_HIT_PACKS_DIR = join(root, 'packs');
  await mkdir(process.env.VIRAL_HIT_RECIPES_DIR);
  await mkdir(process.env.VIRAL_HIT_PACKS_DIR);
  await writeFile(
    join(process.env.VIRAL_HIT_RECIPES_DIR, 'original.json'),
    JSON.stringify(original),
  );
  try {
    await run(root);
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
    await rm(root, { recursive: true, force: true });
  }
}
async function removal(id: string) {
  const review = await changeRecipeLibrary({
    action: 'review-remove',
    recipeId: id,
  });
  if (
    !('recipe' in review) ||
    !review.recipe ||
    !('digest' in review) ||
    !review.digest
  )
    throw new Error('Missing removal review');
  return review;
}

test('recipe replacement pins both definitions, stale run forms fail, and saved plans survive replacement/removal/reopen', () =>
  isolated(async (root) => {
    const first = validateRecipeManifest({
        ...original,
        id: 'maintained-canvas',
      }),
      firstReview = await inspectRecipe(first);
    await installRecipe(first, firstReview.digest);
    const initialCatalog = await loadRecipeCatalog();
    assert.deepEqual(initialCatalog.installedIds, [first.id]);
    assert.equal(initialCatalog.recipeDigests[first.id], firstReview.digest);
    const plan = await prepareRecipePlan(
      first.id,
      {},
      'project',
      firstReview.digest,
    );
    let harness = new DurableHarness(join(root, 'jobs.sqlite'));
    const run = harness.enqueue(plan, 'same-request'),
      jobs = harness.jobs(run);
    harness.close();
    const next = {
      ...first,
      title: 'Maintained canvas for product shots',
      category: 'product',
      version: '2.0.0',
    };
    const review = await inspectRecipe(next);
    assert.deepEqual(review.update?.current, first);
    assert.equal(review.update?.digest, firstReview.digest);
    await assert.rejects(
      changeRecipeLibrary({
        action: 'update',
        manifest: { ...next, title: 'Edited after review' },
        expectedDigest: review.digest,
        expectedInstalledDigest: firstReview.digest,
      }),
      /changed after inspection/,
    );
    const request = {
      action: 'update' as const,
      manifest: next,
      expectedDigest: review.digest,
      expectedInstalledDigest: firstReview.digest,
    };
    assert.equal(
      ((await changeRecipeLibrary(request)) as { updated: boolean }).updated,
      true,
    );
    assert.equal(
      ((await changeRecipeLibrary(request)) as { updated: boolean }).updated,
      false,
    );
    await assert.rejects(
      prepareRecipePlan(first.id, {}, 'project', firstReview.digest),
      /changed since these inputs/,
    );
    const currentPlan = await prepareRecipePlan(
      first.id,
      {},
      'project',
      review.digest,
    );
    assert.notDeepEqual(
      currentPlan.nodes.map((node) => node.version),
      plan.nodes.map((node) => node.version),
    );
    await assert.rejects(
      changeRecipeLibrary({
        action: 'remove',
        recipeId: first.id,
        expectedDigest: firstReview.digest,
      }),
      /changed after review/,
    );
    const checked = await removal(first.id);
    assert.deepEqual(checked.recipe, next);
    await changeRecipeLibrary({
      action: 'remove',
      recipeId: first.id,
      expectedDigest: checked.digest,
    });
    assert.deepEqual(
      await changeRecipeLibrary({
        action: 'remove',
        recipeId: first.id,
        expectedDigest: checked.digest,
      }),
      { removed: false, recipeId: first.id },
    );
    assert.equal(readInstalledRecipes().length, 0);
    await assert.rejects(
      prepareRecipePlan(first.id, {}, 'project', checked.digest),
      /not found/,
    );
    harness = new DurableHarness(join(root, 'jobs.sqlite'));
    assert.deepEqual(harness.jobs(run), jobs);
    assert.equal(harness.enqueue(plan, 'same-request'), run);
    harness.close();
    await installRecipe(first, firstReview.digest);
    assert.equal(readInstalledRecipes()[0].version, first.version);
    for (const action of ['update', 'remove', 'review-remove'] as const) {
      const request =
        action === 'update'
          ? {
              action,
              manifest: original,
              expectedDigest: (await inspectRecipe(original)).digest,
              expectedInstalledDigest: firstReview.digest,
            }
          : action === 'remove'
            ? {
                action,
                recipeId: original.id,
                expectedDigest: firstReview.digest,
              }
            : { action, recipeId: original.id };
      await assert.rejects(changeRecipeLibrary(request), /file catalog/);
    }
  }));

test('recipe packs expose modified/missing members; repair restores only missing definitions and cannot overwrite a newer member', () =>
  isolated(async (root) => {
    const recipe = { ...original, id: 'portable-kit-canvas' };
    const pack = {
      schemaVersion: 1,
      kind: 'viral-hit-pack',
      id: 'portable-kit',
      version: '1.0.0',
      title: 'Portable kit',
      description: 'Any project',
      author: 'Community',
      license: 'MIT',
      scope: 'general',
      useCases: ['editing'],
      recipes: [recipe],
    };
    await writeFile(join(root, 'packs', 'pack.json'), JSON.stringify(pack));
    const review = await inspectPack(pack);
    await installPack(pack, review.pack.digest);
    assert.equal(readInstalledPacks()[0].content.state, 'complete');
    const next = { ...recipe, version: '2.0.0' },
      inspected = await inspectRecipe(next);
    assert.equal(inspected.update?.packs[0].id, pack.id);
    await changeRecipeLibrary({
      action: 'update',
      manifest: next,
      expectedDigest: inspected.digest,
      expectedInstalledDigest: inspected.update!.digest,
    });
    assert.equal((await listRecipePacks()).available[0].state, 'modified');
    await assert.rejects(
      installPack(pack, review.pack.digest),
      /different contents/,
    );
    const remove = await removal(recipe.id);
    await changeRecipeLibrary({
      action: 'remove',
      recipeId: recipe.id,
      expectedDigest: remove.digest,
    });
    assert.deepEqual(readInstalledPacks()[0].content, {
      state: 'missing',
      missingRecipeIds: [recipe.id],
    });
    assert.equal((await listRecipePacks()).available[0].state, 'incomplete');
    const repair = await inspectPack(pack);
    assert.equal(repair.collision, 'same');
    assert.equal(repair.recipes[0].collision, 'none');
    assert.deepEqual((await installPack(pack, repair.pack.digest)).added, [
      recipe.id,
    ]);
    assert.equal((await listRecipePacks()).available[0].state, 'installed');
    assert.equal(readInstalledRecipes()[0].version, '1.0.0');
  }));

test('two separate CLI updates serialize on the reviewed installed digest and CLI export retains the winner', () =>
  isolated(async (root) => {
    const first = { ...original, id: 'cli-maintained' },
      installed = await inspectRecipe(first);
    await installRecipe(first, installed.digest);
    const a = { ...first, title: 'Writer A', version: '2.0.0' },
      b = { ...a, title: 'Writer B' };
    const [ar, br] = await Promise.all([inspectRecipe(a), inspectRecipe(b)]);
    const files = [join(root, 'a.json'), join(root, 'b.json')];
    await writeFile(files[0], JSON.stringify(a));
    await writeFile(files[1], JSON.stringify(b));
    const cli = (args: string[]) =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'scripts/recipe.ts', ...args],
        { env: { ...process.env } },
      );
    const results = await Promise.allSettled([
      cli(['update', files[0], ar.digest, installed.digest]),
      cli(['update', files[1], br.digest, installed.digest]),
    ]);
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.ok(
      String(
        (
          results.find(
            (result) => result.status === 'rejected',
          ) as PromiseRejectedResult
        ).reason,
      ).includes('changed after review'),
    );
    const out = join(root, 'export.json');
    await cli(['export', first.id, out]);
    assert.deepEqual(
      JSON.parse(await readFile(out, 'utf8')),
      readInstalledRecipes()[0],
    );
    const checked = JSON.parse((await cli(['review-remove', first.id])).stdout);
    await cli(['remove', first.id, checked.digest]);
    assert.equal(readInstalledRecipes().length, 0);
  }));

test('creative-pack exports preserve their original recipe snapshot after the live recipe changes', () =>
  isolated(async (root) => {
    const path = join(root, 'source.tar'),
      out = join(root, 'export.tar');
    await changeCreativePacks({
      action: 'build',
      path,
      pack: {
        id: 'snapshot-kit',
        version: '1.0.0',
        title: 'Snapshot kit',
        description: 'Portable recipe',
        author: 'Community',
        license: 'MIT',
        scope: 'general',
        useCases: ['editing'],
        recipeIds: [original.id],
        skillIds: [],
        characterIds: [],
      },
    });
    const inspected = await changeCreativePacks({ action: 'inspect', path });
    assert.ok('pack' in inspected);
    if (!('pack' in inspected)) throw new Error('No pack');
    const accepted = await changeCreativePacks({
      action: 'install',
      path,
      expectedDigest: inspected.pack.digest,
    });
    assert.ok('complete' in accepted && accepted.complete);
    const recipe = readInstalledRecipes()[0],
      review = await inspectRecipe({ ...recipe, version: '2.0.0' });
    await changeRecipeLibrary({
      action: 'update',
      manifest: review.recipe,
      expectedDigest: review.digest,
      expectedInstalledDigest: review.update!.digest,
    });
    await changeCreativePacks({
      action: 'export',
      id: 'snapshot-kit',
      path: out,
    });
    assert.deepEqual(await readFile(out), await readFile(path));
  }));
