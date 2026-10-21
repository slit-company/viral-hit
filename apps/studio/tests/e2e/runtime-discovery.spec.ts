import { test, expect, type APIRequestContext } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const headers = { 'x-viral-hit-workspace-request': '1' };
const endpoint = '/api/app/runtime-packages';
const source = 'https://public-packs.viralhit.test/runtime.json';
const evidence = '../../research/evidence/runtime-discovery';
async function post(request: APIRequestContext, endpoint: string, data: unknown) {
  const response = await request.post(endpoint, { headers, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function mcp(request: APIRequestContext, data: unknown) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_runtime_package', arguments: { request: data } } },
  });
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc)).not.toBe(true);
  return rpc.result.structuredContent.result;
}

test('independent runtime catalog hands off verified source to explicit install and retains releases after discovery removal', async ({ page, request }) => {
  await mkdir(evidence, { recursive: true });
  const before = await mcp(request, { action: 'list' });
  const catalog = await post(request, '/api/app/community', { action: 'fetch', url: 'https://public-packs.viralhit.test/runtime-catalog.json' });
  await post(request, '/api/app/community', { action: 'save', catalog: catalog.catalog, source: catalog.source, expectedDigest: catalog.digest, expectedPreviousDigest: catalog.previousDigest });
  const entry = catalog.catalog.entries[0];
  let fetches = 0;
  page.on('request', req => { if (req.url().endsWith(endpoint) && req.method() === 'POST' && req.postDataJSON()?.action === 'fetch') fetches++; });
  await page.goto('/community');
  await page.getByRole('button', { name: 'Runtime package', exact: true }).click();
  const entries = page.getByRole('region', { name: 'Discover entries' });
  await expect(entries.getByRole('listitem')).toHaveCount(2);
  await entries.getByRole('button', { name: 'For a specific job', exact: true }).click();
  await expect(entries.getByRole('listitem')).toHaveCount(1);
  await entries.getByRole('button', { name: 'General', exact: true }).click();
  await entries.getByRole('link', { name: 'Open Independent sound engine (runtime-discovery-proof/sound-engine)' }).click();
  await expect(page.getByLabel('Runtime package URL', { exact: true })).toHaveValue(source);
  const launch = page.getByRole('button', { name: 'Review link', exact: true });
  await expect(launch).toBeEnabled();
  expect(fetches).toBe(0);
  expect(new URL(page.url()).searchParams.get('sha256')).toBe(entry.sha256);
  await page.screenshot({ path: evidence + '/link-desktop.png', animations: 'disabled' });
  await launch.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Review runtime installation' })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Downloaded source' })).toContainText(entry.sha256);
  await expect(dialog.getByText('Catalog file verified', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Install package', exact: true })).toBeDisabled();
  expect((await mcp(request, { action: 'list' })).installed).toEqual(before.installed);
  await page.screenshot({ path: evidence + '/review-desktop.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(launch).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('region', { name: 'Runtime package link' }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: evidence + '/link-mobile.png', animations: 'disabled' });
  await launch.click();
  await expect(dialog.getByText('Catalog file verified', { exact: true })).toBeVisible();
  await page.screenshot({ path: evidence + '/review-mobile.png', animations: 'disabled' });
  await dialog.getByRole('region', { name: 'Incoming definition' }).locator('summary').click();
  await expect(dialog.getByLabel('Incoming definition source 0', { exact: true })).toContainText('CATALOG_MUST_NOT_EXECUTE');
  const fetched = await mcp(request, { action: 'fetch', url: source, expectedSha256: entry.sha256 });
  const viaHttp = await post(request, endpoint, { action: 'fetch', url: source, expectedSha256: entry.sha256 });
  expect(viaHttp).toEqual(fetched);
  expect(fetched.download.sha256).toBe(entry.sha256);
  expect(fetched.digest).not.toBe(entry.sha256);
  await dialog.getByRole('button', { name: 'Review again', exact: true }).click();
  await expect(dialog.getByText('Catalog file verified', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Install package', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence + '/action-mobile.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Install package', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const installed = await mcp(request, { action: 'list' });
  expect(installed.installed.some((pkg: { id: string }) => pkg.id === fetched.package.id)).toBe(true);
  expect(installed.loaded.some((pkg: { id: string }) => pkg.id === fetched.package.id)).toBe(false);
  await post(request, '/api/app/community', { action: 'remove', id: catalog.catalog.id, expectedDigest: catalog.digest });
  expect((await mcp(request, { action: 'export', id: fetched.package.id })).entries).toEqual(fetched.package.entries);
  const removal = await mcp(request, { action: 'review-remove', id: fetched.package.id });
  await mcp(request, { action: 'remove', id: fetched.package.id, expectedStateDigest: removal.stateDigest });
});

test('runtime links reject catalog drift and private redirects, and canceled reviews cannot replace a later result', async ({ page, request }) => {
  const mismatch = '/runtime-packages?' + new URLSearchParams({ source, sha256: '0'.repeat(64) });
  await page.goto(mismatch);
  const launch = page.getByRole('button', { name: 'Review link', exact: true });
  await expect(launch).toBeEnabled(); await launch.click();
  await expect(page.getByRole('alert')).toContainText('differs from the catalog');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const denied = await request.post(endpoint, { data: { action: 'fetch', url: source } });
  expect(denied.status()).toBe(403);
  const redirect = await request.post(endpoint, { headers, data: { action: 'fetch', url: 'https://public-packs.viralhit.test/private-redirect.tar' } });
  expect(redirect.status()).toBe(400);
  expect(await redirect.text()).toContain('public network');
  await page.goto('/runtime-packages?' + new URLSearchParams({ source }));
  await expect(launch).toBeEnabled();
  const fetched = await post(request, endpoint, { action: 'fetch', url: source });
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let intercepted!: () => void;
  const started = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/api/app/runtime-packages', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'fetch') return route.continue();
    intercepted(); await barrier;
    await route.fulfill({ json: fetched });
  });
  await launch.click(); await started;
  await page.getByRole('button', { name: 'Cancel download', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Download canceled' })).toBeVisible();
  release(); await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(launch).toBeEnabled(); await launch.click();
  await expect(page.getByRole('dialog').getByText('Downloaded file', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(launch).toBeFocused();
});
