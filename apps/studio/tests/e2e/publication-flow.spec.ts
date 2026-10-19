import { test, expect, type APIRequestContext, type Locator } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createDemoMedia } from '../../scripts/demo-media.mjs';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function fixture(request: APIRequestContext) {
  await mkdir('test-results', { recursive: true }); createDemoMedia('test-results/publication-source.mp4');
  const created = await request.post('/api/app/projects', { headers, data: { name: 'A small film · Publication QA' } });
  expect(created.ok()).toBe(true); const { id } = await created.json();
  const uploaded = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name: 'studio-motion.mp4', mimeType: 'video/mp4', buffer: await readFile('test-results/publication-source.mp4') } } });
  expect(uploaded.ok()).toBe(true);
  const account = (await (await request.get('/api/app/publishing/accounts', { headers })).json()).accounts.find((value: { status: string }) => value.status === 'connected');
  expect(account).toBeTruthy();
  return { projectId: id as string, assetId: (await uploaded.json()).asset.id as string, accountId: account.id as string };
}

async function playPreview(video: Locator) {
  await video.evaluate(async (node: HTMLVideoElement) => { node.muted = true; await node.play(); });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.7);
  await video.evaluate((node: HTMLVideoElement) => { node.pause(); return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}

test('project publication UI retains preview, edits revisions and requires reviewed approval before queued delivery', async ({ page, request }) => {
  const f = await fixture(request);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/publish/${f.projectId}`);
  await expect(page.getByRole('heading', { name: 'Publish your work' })).toBeVisible();
  await page.getByRole('combobox', { name: 'YouTube channel', exact: true }).selectOption(f.accountId);
  await page.getByRole('combobox', { name: 'Project video', exact: true }).selectOption(f.assetId);
  await page.getByLabel('Video title', { exact: true }).fill('A small film, a new beginning');
  await page.getByLabel('Description', { exact: true }).fill('A studio experiment in movement and color.');
  await page.getByRole('combobox', { name: 'Made for kids?', exact: true }).selectOption('false');
  await page.getByRole('combobox', { name: 'Realistic altered or synthetic content?', exact: true }).selectOption('true');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  let card = page.getByRole('article', { name: 'Publication A small film, a new beginning', exact: true });
  await expect(card.getByText('Draft', { exact: true })).toBeVisible();
  const approve = card.getByRole('button', { name: 'Approve upload', exact: true });
  await expect(approve).toBeDisabled();
  await expect.poll(() => card.locator('video').evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(1);
  await playPreview(card.locator('video'));
  const snapshot = await (await request.get(`/api/app/projects/${f.projectId}/publications`, { headers })).json();
  expect(snapshot.publications).toHaveLength(1); expect(snapshot.publications[0].state).toBe('draft');
  const crossSite = await request.get(await card.locator('video').getAttribute('src') ?? '', { headers: { 'sec-fetch-dest': 'video', 'sec-fetch-site': 'cross-site' } });
  expect(crossSite.status()).toBe(403);
  await page.screenshot({ path: 'test-results/publication-review-desktop.png' });
  await card.getByRole('button', { name: 'Edit draft', exact: true }).click();
  await page.getByLabel('Video title', { exact: true }).fill('A small film, revised');
  await page.getByRole('combobox', { name: 'Visibility', exact: true }).selectOption('unlisted');
  await page.getByRole('button', { name: 'Save new revision', exact: true }).click();
  card = page.getByRole('article', { name: 'Publication A small film, revised', exact: true });
  await expect(card.getByText('unlisted', { exact: true })).toBeVisible();
  const stale = await request.post(`/api/app/projects/${f.projectId}/publications`, { headers, data: { action: 'approve', publicationId: snapshot.publications[0].id, expectedRevision: 1, expectedDigest: snapshot.publications[0].digest, confirmed: true } });
  expect(stale.status()).toBe(409);
  await page.setViewportSize({ width: 390, height: 844 });
  await playPreview(card.locator('video'));
  await card.evaluate(node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'test-results/publication-preview-mobile.png' });
  await expect(card.getByRole('checkbox')).toBeEnabled(); await card.getByRole('checkbox').check();
  await expect(card.getByRole('button', { name: 'Approve upload', exact: true })).toBeEnabled();
  const reviewState = await card.getByRole('button', { name: 'Approve upload', exact: true }).evaluate(async (node: HTMLButtonElement) => {
    await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => undefined)));
    const style = getComputedStyle(node);
    return { disabled: node.disabled, ariaDisabled: node.getAttribute('aria-disabled'), opacity: style.opacity, background: style.backgroundColor };
  });
  await writeFile('test-results/publication-review-state.json', JSON.stringify(reviewState));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/publication-review-mobile.png' });
  await card.getByRole('button', { name: 'Approve upload', exact: true }).click();
  await expect(card.getByText('Queued for upload', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Queued for upload', { exact: true })).toBeVisible();
  // E2E deliberately has no publication worker. This proves admission/UI, not a remote upload.
  const stored = await (await request.get(`/api/app/projects/${f.projectId}/publications`, { headers })).json();
  expect(stored.publications[0].state).toBe('approved'); expect(stored.publications[0].delivery).toBeNull();
  await page.getByRole('button', { name: 'Cancel delivery', exact: true }).click();
  await expect(page.getByText('Canceled', { exact: true })).toBeVisible();
  const back = page.getByRole('button', { name: 'Back home', exact: true }), publish = page.getByRole('link', { name: 'Publish project', exact: true });
  const a = await back.boundingBox(), b = await publish.boundingBox(); expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x);
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await page.getByRole('link', { name: 'Publish project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Publish your work' })).toBeVisible();
});

test('MCP and HTTP observe the same draft and enforce digest-bound approval', async ({ request }) => {
  const f = await fixture(request); let id = 0;
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } } });
    expect(response.ok()).toBe(true); const text = await response.text();
    const data = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
    expect(data.error).toBeUndefined(); return data.result;
  };
  const created = await call('viral_hit_publication_change', { projectId: f.projectId, request: { action: 'create', requestKey: 'mcp-draft', connector: 'youtube', accountId: f.accountId, assetId: f.assetId, metadata: { title: 'MCP reviewed video', description: '', categoryId: '22', privacy: 'private', tags: [], madeForKids: false, containsSyntheticMedia: true, notifySubscribers: false } } });
  expect(created.isError).not.toBe(true); const draft = created.structuredContent.result;
  const failed = await call('viral_hit_publication_change', { projectId: f.projectId, request: { action: 'approve', publicationId: draft.id, expectedRevision: 1, expectedDigest: '0'.repeat(64), confirmed: true } });
  expect(failed.isError).toBe(true);
  const listed = await call('viral_hit_publication_list', { projectId: f.projectId });
  expect(listed.structuredContent.result.publications[0].state).toBe('draft');
  const http = await (await request.get(`/api/app/projects/${f.projectId}/publications`, { headers })).json();
  expect(http.publications[0].id).toBe(draft.id); expect(JSON.stringify(http)).not.toMatch(/e2e-token|e2e-refresh|checkpoint|leaseToken/);
});

test('a failed retained preview blocks approval and an explicit retry loads the real video', async ({ page, request }) => {
  const f = await fixture(request);
  const response = await request.post(`/api/app/projects/${f.projectId}/publications`, { headers, data: {
    action: 'create', requestKey: 'preview-recovery', connector: 'youtube', accountId: f.accountId, assetId: f.assetId,
    metadata: { title: 'Preview recovery', description: '', categoryId: '22', privacy: 'private', tags: [], madeForKids: false, containsSyntheticMedia: true, notifySubscribers: false },
  } });
  expect(response.ok()).toBe(true);
  const route = `**/api/app/projects/${f.projectId}/publications/*/media?*`;
  await page.route(route, intercepted => intercepted.fulfill({ status: 503, body: '' }));
  await page.goto(`/publish/${f.projectId}`);
  const card = page.getByRole('article', { name: 'Publication Preview recovery', exact: true });
  await expect(card.getByRole('button', { name: 'Retry preview' })).toBeVisible();
  await expect(card.getByRole('checkbox')).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Approve upload' })).toBeDisabled();
  await page.unroute(route);
  await card.getByRole('button', { name: 'Retry preview' }).click();
  await expect(card.getByRole('checkbox')).toBeEnabled();
  await expect(card.getByRole('checkbox')).not.toBeChecked();
  await expect(card.getByRole('button', { name: 'Approve upload' })).toBeDisabled();
  await expect.poll(() => card.locator('video').evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(1);
});
