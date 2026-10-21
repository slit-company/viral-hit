import { test, expect, type APIRequestContext } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: {
      authorization: 'Bearer e2e-local-only',
      accept: 'application/json, text/event-stream',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    },
  });
  const text = await response.text(),
    rpc = JSON.parse(
      text.startsWith('{')
        ? text
        : text
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6),
    );
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent.result;
}
test('installed recipe revisions are reviewed, stale forms/removal conflict, and a pack can restore a missing member', async ({
  page,
  request,
}) => {
  const evidence = '../../research/evidence/recipe-lifecycle';
  await mkdir(evidence, { recursive: true });
  const original = JSON.parse(
    await readFile('../../recipes/local-canvas.json', 'utf8'),
  );
  const recipe = {
    ...original,
    id: 'lifecycle-kit-canvas',
    title:
      'A reusable canvas workflow for independently authored creative projects',
  };
  const pack = {
    schemaVersion: 1,
    kind: 'viral-hit-pack',
    id: 'lifecycle-kit',
    version: '1.0.0',
    title: 'Lifecycle kit',
    description: 'General creative workflow',
    author: 'Independent author',
    license: 'MIT',
    scope: 'general',
    useCases: ['editing'],
    recipes: [recipe],
  };
  const packReview = await mcp(request, 'viral_hit_recipe_pack', {
    request: { action: 'inspect', pack },
  });
  await mcp(request, 'viral_hit_recipe_pack', {
    request: {
      action: 'install',
      pack,
      expectedDigest: packReview.pack.digest,
    },
  });
  const before = await mcp(request, 'viral_hit_recipes_list', {});
  const created = await request.post('/api/app/projects', {
    headers,
    data: { name: 'Recipe lifecycle QA' },
  });
  const projectId = (await created.json()).id;
  await page.goto('/editor/' + projectId);
  await page
    .getByRole('button', { name: 'Generation runs', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Creative recipe' })
    .selectOption(recipe.id);
  await page
    .getByRole('button', { name: 'Recipe library', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Edit installed recipe', exact: true })
    .click();
  const next = {
    ...recipe,
    title: 'A maintained canvas workflow for specialized product photography',
    category: 'product',
    version: '2.0.0',
  };
  await page
    .getByRole('textbox', { name: 'Recipe JSON', exact: true })
    .fill(JSON.stringify(next, null, 2));
  await page.getByRole('button', { name: 'Inspect JSON', exact: true }).click();
  const inspection = page.getByRole('region', { name: 'Recipe inspection' });
  await expect(
    inspection.getByText('Review recipe update', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Update recipe', exact: true }),
  ).toBeDisabled();
  await inspection
    .getByText('Installed definition · v1.0.0', { exact: true })
    .click();
  await inspection
    .getByText('Incoming definition · v2.0.0', { exact: true })
    .click();
  expect(
    JSON.parse(
      (await inspection
        .getByLabel('Installed definition', { exact: true })
        .textContent()) ?? '{}',
    ).title,
  ).toBe(recipe.title);
  expect(
    JSON.parse(
      (await inspection
        .getByLabel('Incoming definition', { exact: true })
        .textContent()) ?? '{}',
    ).title,
  ).toBe(next.title);
  await inspection.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: evidence + '/definitions-desktop.png',
    animations: 'disabled',
  });
  await inspection
    .getByText('Installed definition · v1.0.0', { exact: true })
    .click();
  await inspection
    .getByText('Incoming definition · v2.0.0', { exact: true })
    .click();
  await inspection.getByRole('checkbox').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: evidence + '/update-desktop.png',
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await inspection.getByRole('checkbox').scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: evidence + '/update-mobile.png',
    animations: 'disabled',
  });
  await inspection.getByRole('checkbox').check();
  await page
    .getByRole('button', { name: 'Update recipe', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: next.title + ' is ready' }),
  ).toBeVisible();
  const updated = await mcp(request, 'viral_hit_recipe_library', {
    request: { action: 'get', recipeId: recipe.id },
  });
  expect(updated.recipe.version).toBe('2.0.0');
  const packs = await mcp(request, 'viral_hit_recipe_pack', {
    request: { action: 'list' },
  });
  expect(
    packs.installed.find((item: { id: string }) => item.id === pack.id).content
      .state,
  ).toBe('modified');
  const stale = await request.post('/api/app/projects/' + projectId + '/runs', {
    headers,
    data: {
      action: 'recipe',
      recipeId: recipe.id,
      values: {},
      expectedRecipeDigest: before.recipeDigests[recipe.id],
      requestKey: 'stale-recipe-form',
    },
  });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error).toContain('changed since these inputs');
  expect(
    (
      await (
        await request.get('/api/app/projects/' + projectId + '/runs')
      ).json()
    ).runs,
  ).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Recipe library', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Review removal', exact: true })
    .click();
  const removal = page.getByRole('region', { name: 'Recipe removal review' });
  await expect(
    removal.getByText(recipe.id + ' · v2.0.0', { exact: true }),
  ).toBeVisible();
  await expect(
    removal.getByRole('button', { name: 'Remove recipe', exact: true }),
  ).toBeDisabled();
  await removal.getByRole('checkbox').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: evidence + '/remove-mobile-overview.png',
    animations: 'disabled',
  });
  await removal
    .getByRole('button', { name: 'Remove recipe', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    removal.getByRole('checkbox', { name: new RegExp(recipe.id) }),
  ).toBeInViewport();
  await page.screenshot({
    path: evidence + '/remove-mobile.png',
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await removal.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: evidence + '/remove-desktop.png',
    animations: 'disabled',
  });
  const third = { ...next, version: '3.0.0' },
    another = await mcp(request, 'viral_hit_recipe_library', {
      request: { action: 'inspect', manifest: third },
    });
  await mcp(request, 'viral_hit_recipe_library', {
    request: {
      action: 'update',
      manifest: third,
      expectedDigest: another.digest,
      expectedInstalledDigest: another.update.digest,
    },
  });
  await removal.getByRole('checkbox').check();
  await removal
    .getByRole('button', { name: 'Remove recipe', exact: true })
    .click();
  await expect(removal.getByRole('alert')).toContainText(
    'changed after review',
  );
  await removal.getByRole('button', { name: 'Cancel removal' }).click();
  await page
    .getByRole('button', { name: 'Review removal', exact: true })
    .click();
  await expect(
    removal.getByText(recipe.id + ' · v3.0.0', { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await removal
    .getByRole('button', { name: 'Download recipe before removal' })
    .click();
  expect(
    JSON.parse(await readFile((await (await download).path())!, 'utf8'))
      .version,
  ).toBe('3.0.0');
  await removal.getByRole('checkbox').check();
  await removal
    .getByRole('button', { name: 'Remove recipe', exact: true })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'was removed from the library' }),
  ).toBeVisible();
  expect(
    (await mcp(request, 'viral_hit_recipes_list', {})).installedIds,
  ).not.toContain(recipe.id);
  await page.goto('/recipe-packs');
  await expect(
    page.getByRole('region', { name: 'Changed recipe packs' }),
  ).toContainText('Recipes missing: ' + recipe.id);
  await page.getByLabel('Import pack file', { exact: true }).setInputFiles({
    name: 'original-pack.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(pack)),
  });
  await page
    .getByRole('button', { name: 'Restore missing recipes', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Lifecycle kit is in your recipe library',
  );
  expect(
    (
      await mcp(request, 'viral_hit_recipe_library', {
        request: { action: 'get', recipeId: recipe.id },
      })
    ).recipe.version,
  ).toBe('1.0.0');
  const denied = await request.post('/api/app/recipes', {
    data: {
      action: 'remove',
      recipeId: recipe.id,
      expectedDigest: before.recipeDigests[recipe.id],
    },
  });
  expect(denied.status()).toBe(403);
  await request.delete('/api/app/projects', {
    headers,
    data: { projectIds: [projectId] },
  });
});
