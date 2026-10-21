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
test('an independent catalog discovers all three package types, preserves checksums through review and keeps installed contents when removed', async ({
  page,
  request,
}) => {
  const evidence = '../../research/evidence/community-catalog';
  await mkdir(evidence, { recursive: true });
  const before = await mcp(request, 'viral_hit_skill_list', {});
  await page.goto('/community');
  await expect(
    page.getByRole('textbox', { name: 'Catalog link' }),
  ).toBeEnabled();
  await page
    .getByRole('textbox', { name: 'Catalog link' })
    .fill('https://public-packs.viralhit.test/catalog.json');
  await page
    .getByRole('button', { name: 'Review catalog link', exact: true })
    .click();
  const review = page.getByRole('region', {
    name: 'Catalog review',
    exact: true,
  });
  await expect(
    review.getByText('4 entries · 4 added · 0 changed · 0 removed'),
  ).toBeVisible();
  expect(
    (await mcp(request, 'viral_hit_community', { request: { action: 'list' } }))
      .catalogs,
  ).toHaveLength(0);
  await expect(
    review.getByRole('button', { name: 'Save catalog' }),
  ).toBeDisabled();
  await review.getByText('Entries and changes', { exact: true }).click();
  await page.screenshot({
    path: evidence + '/review-desktop.png',
    animations: 'disabled',
  });
  await review.getByRole('checkbox').check();
  await review.getByRole('button', { name: 'Save catalog' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'ready to browse' }),
  ).toBeVisible();
  const saved = await mcp(request, 'viral_hit_community', {
    request: { action: 'get', id: 'independent-studio' },
  });
  expect(saved.catalog.entries).toHaveLength(4);
  expect((await mcp(request, 'viral_hit_skill_list', {})).skills).toHaveLength(
    before.skills.length,
  );
  const entries = page.getByRole('region', { name: 'Discover entries' });
  await entries
    .getByRole('button', { name: 'For a specific job', exact: true })
    .click();
  await expect(entries.getByRole('listitem')).toHaveCount(1);
  await entries.evaluate((element) =>
    element.scrollIntoView({ block: 'start' }),
  );
  await page.screenshot({
    path: evidence + '/browse-desktop.png',
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await entries.evaluate((element) =>
    element.scrollIntoView({ block: 'start' }),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: evidence + '/browse-mobile.png',
    animations: 'disabled',
  });
  await entries.getByRole('button', { name: 'All uses', exact: true }).click();
  await entries
    .getByRole('textbox', { name: 'Find a workflow' })
    .fill('planning');
  await expect(entries.getByRole('listitem')).toHaveCount(3);
  await entries
    .getByRole('link', {
      name: 'Open Shared planning (independent-studio/planning)',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Add from link', exact: true }),
  ).toHaveValue(saved.catalog.entries[0].url);
  await page.getByRole('button', { name: 'Review link', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText(
      'Plan a story for any project. Review the plan before generating.',
      { exact: true },
    ),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Install skill', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('is installed');
  expect(
    (
      await mcp(request, 'viral_hit_skill_get', {
        skillId: 'catalog-general-skill',
      })
    ).manifest.scope,
  ).toBe('general');
  await page.goto('/community');
  await page
    .getByRole('link', {
      name: 'Open Community editing basics (independent-studio/editing)',
    })
    .click();
  await expect(page.getByLabel('Add from link', { exact: true })).toHaveValue(
    'https://public-packs.viralhit.test/recipes.json',
  );
  await page.getByRole('button', { name: 'Review link', exact: true }).click();
  const packReview = page.getByRole('region', {
    name: 'Pack review',
    exact: true,
  });
  await expect(
    packReview.getByText('Community editing basics', { exact: false }),
  ).toBeVisible();
  await packReview
    .getByRole('button', { name: 'Install pack', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('No jobs were started');
  await page.goto('/community');
  await page
    .getByRole('link', {
      name: 'Open Product story kit (independent-studio/product-kit)',
    })
    .click();
  await page.getByRole('button', { name: 'Review link', exact: true }).click();
  const creative = page.getByRole('region', { name: 'Creative pack review' });
  await expect(
    creative.getByRole('heading', { name: 'Product story kit' }),
  ).toBeVisible();
  await creative.getByRole('checkbox').check();
  await creative.getByRole('button', { name: 'Install creative pack' }).click();
  await expect(page.getByRole('status')).toContainText('is ready');
  await page.goto('/community');
  await page
    .getByRole('link', {
      name: 'Open Shared planning (independent-studio/changed-file)',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Review link', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'differs from the catalog',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/community');
  await page.getByText('Manage catalogs (1)', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download catalog independent-studio' })
    .click();
  expect(
    JSON.parse(await readFile((await (await download).path())!, 'utf8')),
  ).toEqual(saved.catalog);
  await page
    .getByRole('button', { name: 'Review changes to independent-studio' })
    .click();
  await expect(
    review.getByText('4 entries · 0 added · 0 changed · 0 removed'),
  ).toBeVisible();
  const changed = {
    ...saved.catalog,
    description: 'Changed by another client',
  };
  const other = await mcp(request, 'viral_hit_community', {
    request: { action: 'inspect', catalog: changed, source: saved.source },
  });
  expect(other.changes.details).toEqual(['description']);
  await mcp(request, 'viral_hit_community', {
    request: {
      action: 'save',
      catalog: changed,
      source: saved.source,
      expectedDigest: other.digest,
      expectedPreviousDigest: saved.digest,
    },
  });
  await review.getByRole('checkbox').check();
  await review.getByRole('button', { name: 'Save catalog' }).click();
  await expect(page.getByRole('alert')).toContainText('changed after review');
  await page.reload();
  await page.getByText('Manage catalogs (1)', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Review changes to independent-studio' })
    .click();
  await expect(
    review.getByText('Catalog details changed: description', { exact: true }),
  ).toBeVisible();
  await review.getByRole('button', { name: 'Cancel review' }).click();
  await page.getByText('Manage catalogs (1)', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Remove catalog independent-studio' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'removed from discovery' }),
  ).toBeVisible();
  for (const skillId of ['catalog-general-skill', 'catalog-product-skill']) {
    expect(
      (await mcp(request, 'viral_hit_skill_get', { skillId })).source,
    ).toBe('installed');
    const removal = await mcp(request, 'viral_hit_skill_library', {
      request: { action: 'review-remove', skillId },
    });
    await mcp(request, 'viral_hit_skill_library', {
      request: { action: 'remove', skillId, expectedDigest: removal.digest },
    });
  }
  expect(
    (
      await mcp(request, 'viral_hit_recipe_pack', {
        request: { action: 'list' },
      })
    ).installed.some((pack: { id: string }) => pack.id === 'catalog-editing'),
  ).toBe(true);
  expect(
    (
      await mcp(request, 'viral_hit_creative_pack', {
        request: { action: 'list' },
      })
    ).installed.some(
      (pack: { id: string }) => pack.id === 'catalog-product-kit',
    ),
  ).toBe(true);
  const denied = await request.post('/api/app/community', {
    data: {
      action: 'save',
      catalog: saved.catalog,
      expectedDigest: saved.digest,
      expectedPreviousDigest: null,
    },
  });
  expect(denied.status()).toBe(403);
  const malformed = await request.post('/api/app/community', {
    headers,
    data: { action: 'fetch', url: 'https://127.0.0.1/file.json' },
  });
  expect(malformed.status()).toBe(400);
});
