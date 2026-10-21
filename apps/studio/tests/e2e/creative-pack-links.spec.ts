import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const headers = { 'x-viral-hit-workspace-request': '1' }, url = 'https://public-packs.viralhit.test/community.tar';
async function mcp(request: APIRequestContext, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_creative_pack', arguments: { request: args } } },
  });
  const text = await response.text(), rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent.result;
}

test('a public creative-pack link is reviewed as retained bytes, installs once, and shares the same download through MCP and CLI', async ({ page, request }) => {
  let downloads = 0;
  page.on('request', req => { if (req.url().endsWith('/api/app/creative-packs') && req.method() === 'POST' && req.postDataJSON()?.action === 'fetch') downloads++; });
  await page.goto('/packs');
  await page.getByLabel('Creative pack link', { exact: true }).fill(url);
  const evidence = '../../research/evidence/creative-pack-links'; await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: evidence + '/link-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: evidence + '/link-mobile.png' });
  await page.getByRole('button', { name: 'Review link', exact: true }).click();
  const review = page.getByRole('region', { name: 'Creative pack review' });
  await expect(review.getByRole('heading', { name: 'Community creative toolkit' })).toBeVisible();
  await expect(review).toContainText('General');
  await expect(review).toContainText('Installation uses this reviewed file.');
  expect((await mcp(request, { action: 'list' })).installed.some((item: { id: string }) => item.id === 'community-toolkit')).toBe(false);
  await review.locator('summary').filter({ hasText: 'Community shot planning' }).click();
  await expect(review.locator('pre')).toContainText('keep them editable');
  await expect(review.getByRole('button', { name: 'Install creative pack', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 1440, height: 960 });
  await review.scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence + '/review-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await review.getByRole('button', { name: 'Install creative pack', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: evidence + '/review-mobile.png' });
  await review.getByRole('checkbox').check();
  await review.getByRole('button', { name: 'Install creative pack', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Community creative toolkit is ready');
  expect(downloads).toBe(1);

  const path = resolve('test-results/community-from-mcp.tar');
  const fetched = await mcp(request, { action: 'fetch', url, path });
  expect(fetched.inspected).toBe(false);
  const inspected = await mcp(request, { action: 'inspect', path });
  expect(inspected.skills[0].inspection.collision).toBe('same');
  expect((await mcp(request, { action: 'install', path, expectedDigest: inspected.pack.digest })).complete).toBe(true);
  expect((await mcp(request, { action: 'list' })).installed.filter((item: { id: string }) => item.id === 'community-toolkit')).toHaveLength(1);

  const cliRoot = await mkdtemp(join(tmpdir(), 'viral-hit-e2e-cli-'));
  try {
    const bytes = await readFile(path), target = join(cliRoot, 'downloaded.tar');
    await writeFile(join(cliRoot, 'shared-creative-pack.tar'), bytes);
    const output = execFileSync(process.execPath, ['--import', './scripts/e2e-pack-download.mjs', '--import', 'tsx', 'scripts/creative-pack.ts', 'fetch', url, target], {
      env: { ...process.env, VIRAL_HIT_DATA_DIR: cliRoot }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(JSON.parse(output).inspected).toBe(false);
    expect(await readFile(target)).toEqual(bytes);
  } finally { await rm(cliRoot, { recursive: true, force: true }); }

  expect((await request.post('/api/app/creative-packs', { data: { action: 'fetch', url } })).status()).toBe(403);
  const privateRedirect = await request.post('/api/app/creative-packs', { headers, data: { action: 'fetch', url: 'https://public-packs.viralhit.test/private-redirect.tar' } });
  expect(privateRedirect.status()).toBe(400);
  expect((await privateRedirect.json()).error).toContain('public network');
  await page.getByLabel('Creative pack link', { exact: true }).fill('https://127.0.0.1/pack.tar');
  await page.getByRole('button', { name: 'Review link', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('public network');
  await expect(page.getByRole('region', { name: 'Creative pack review' })).toHaveCount(0);
});

test('canceling a pending link request ends review without installing or keeping stale content', async ({ page }) => {
  let requested = false;
  await page.route('**/api/app/creative-packs', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requested = true;
    // No artificial response is sent; cancellation must release the pending browser request.
    await new Promise<void>(resolve => route.request().response().then(() => resolve(), () => resolve()));
  });
  await page.goto('/packs');
  await page.getByLabel('Creative pack link', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Review link', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByRole('status')).toContainText('Downloading shared pack');
  await page.getByRole('button', { name: 'Cancel review', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Pack review stopped');
  await expect(page.getByRole('region', { name: 'Creative pack review' })).toHaveCount(0);
  await expect(page.getByLabel('Creative pack link', { exact: true })).toBeEnabled();
});
