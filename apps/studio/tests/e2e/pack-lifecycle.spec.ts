import { test, expect, type APIRequestContext } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function api(request: APIRequestContext, data: unknown) {
  const response = await request.post('/api/app/recipe-packs', { headers, data });
  expect(response.ok(), await response.text()).toBe(true); return response.json();
}
async function mcp(request: APIRequestContext, data: unknown) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_recipe_pack', arguments: { request: data } } },
  });
  const text = await response.text(), rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true); return rpc.result.structuredContent.result;
}
test('independent pack releases preserve chosen local recipes, require fresh reviews, and remove only selected unshared recipes', async ({ page, request }) => {
  const evidence = '../../research/evidence/pack-lifecycle'; await mkdir(evidence, { recursive: true });
  const original = JSON.parse(await readFile('../../recipes/local-canvas.json', 'utf8'));
  const recipe = (suffix: string, version = '1.0.0') => ({ ...original, id: 'maintained-ui-kit-' + suffix, title: { keep: 'My custom canvas workflow', take: 'Shared portrait composition', old: 'Previous release workflow', new: 'New product composition' }[suffix], version });
  const first = { schemaVersion: 1, kind: 'viral-hit-pack', id: 'maintained-ui-kit', version: '1.0.0', title: 'Independent creative kit', description: 'General workflows and custom recipes', author: 'Independent author', license: 'MIT', scope: 'general', useCases: ['editing'], recipes: [recipe('keep', '9.0.0'), recipe('take'), recipe('old')] };
  const inspected = await api(request, { action: 'inspect', pack: first });
  await api(request, { action: 'install', pack: first, expectedDigest: inspected.pack.digest });
  const next = { ...first, version: '2.0.0', scope: 'specialized', useCases: ['product'], recipes: [recipe('keep', '2.0.0'), recipe('take', '2.0.0'), recipe('new')] };
  const importNext = async () => {
    await page.getByLabel('Import pack file', { exact: true }).setInputFiles({ name: 'new-release.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(next)) });
    await page.getByRole('button', { name: 'Review pack update', exact: true }).click();
  };
  await page.goto('/recipe-packs');
  await expect(page.getByRole('region', { name: 'Installed recipe packs' })).toContainText(first.id);
  await importNext();
  const panel = page.getByRole('region', { name: 'Pack lifecycle review' });
  await expect(panel.getByRole('button', { name: 'Update pack', exact: true })).toBeDisabled();
  await expect(panel.getByRole('checkbox', { name: 'Replace maintained-ui-kit-keep', exact: true })).not.toBeChecked();
  await panel.getByText('Current: maintained-ui-kit-keep · v9.0.0', { exact: true }).click();
  expect(JSON.parse((await panel.getByLabel('Current: maintained-ui-kit-keep', { exact: true }).textContent())!).version).toBe('9.0.0');
  await panel.getByText('Current: maintained-ui-kit-keep · v9.0.0', { exact: true }).click();
  await panel.getByRole('checkbox', { name: 'Replace maintained-ui-kit-take', exact: true }).check();
  const confirm = panel.getByRole('checkbox', { name: 'I reviewed these choices for maintained-ui-kit.' });
  await confirm.check();
  // Any choice change clears confirmation.
  await panel.getByRole('checkbox', { name: 'Replace maintained-ui-kit-take', exact: true }).uncheck();
  await expect(confirm).not.toBeChecked();
  await panel.getByRole('checkbox', { name: 'Replace maintained-ui-kit-take', exact: true }).check();
  await panel.scrollIntoViewIfNeeded();
  await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
  expect((await panel.getByRole('heading').boundingBox())!.y).toBeGreaterThan(80);
  await page.screenshot({ path: evidence + '/update-overview-desktop.png', animations: 'disabled' });
  await panel.getByRole('button', { name: 'Update pack', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence + '/update-actions-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
  expect((await panel.getByRole('heading').boundingBox())!.y).toBeGreaterThan(80);
  await page.screenshot({ path: evidence + '/update-overview-mobile.png', animations: 'disabled' });
  await panel.getByRole('button', { name: 'Update pack', exact: true }).scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: evidence + '/update-actions-mobile.png', animations: 'disabled' });
  const downloaded = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download reviewed definitions' }).click();
  const backup = JSON.parse(await readFile((await (await downloaded).path())!, 'utf8'));
  expect(backup.members.find((member: { id: string }) => member.id === 'maintained-ui-kit-keep').current.version).toBe('9.0.0');
  // A concurrent agent maintains the same release before this stale browser submits.
  const agentReview = await mcp(request, { action: 'review-update', pack: { ...first, title: 'Concurrent maintained kit' } });
  await mcp(request, { action: 'update', pack: { ...first, title: 'Concurrent maintained kit' }, expectedDigest: agentReview.incoming.digest, expectedStateDigest: agentReview.stateDigest, replaceRecipeIds: [] });
  await confirm.check(); await panel.getByRole('button', { name: 'Update pack', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('changed after review');
  await panel.getByRole('button', { name: 'Cancel pack change' }).click();
  await importNext();
  await panel.getByRole('checkbox', { name: 'Replace maintained-ui-kit-take', exact: true }).check();
  await confirm.check(); await panel.getByRole('button', { name: 'Update pack', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(first.title + ' is in your recipe library');
  const catalog = await (await request.get('/api/app/recipes')).json();
  expect(catalog.recipes.find((item: { id: string }) => item.id === 'maintained-ui-kit-keep').version).toBe('9.0.0');
  expect(catalog.recipes.find((item: { id: string }) => item.id === 'maintained-ui-kit-take').version).toBe('2.0.0');
  expect(catalog.installedIds).toContain('maintained-ui-kit-old');
  expect((await mcp(request, { action: 'list' })).installed.find((item: { id: string }) => item.id === first.id).content.state).toBe('modified');
  // Prefixes can overlap: protect members another pack still references.
  const parent = { ...first, id: 'maintained-ui', recipes: [recipe('take', '2.0.0')] };
  const parentReview = await api(request, { action: 'inspect', pack: parent });
  await api(request, { action: 'install', pack: parent, expectedDigest: parentReview.pack.digest });
  await page.getByRole('button', { name: 'Review removal of ' + first.id, exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Remove pack', exact: true })).toBeDisabled();
  expect((await panel.getByRole('heading').boundingBox())!.y).toBeGreaterThan(80);
  await expect(panel.getByRole('checkbox', { name: 'Delete maintained-ui-kit-take', exact: true })).toHaveCount(0);
  await expect(panel).toContainText('Also used by Independent creative kit (maintained-ui)');
  await expect(panel.getByRole('checkbox', { name: 'Delete maintained-ui-kit-keep', exact: true })).not.toBeChecked();
  await panel.getByRole('checkbox', { name: 'Delete maintained-ui-kit-new', exact: true }).check();
  await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
  expect((await panel.getByRole('heading').boundingBox())!.y).toBeGreaterThan(80);
  await page.screenshot({ path: evidence + '/remove-overview-mobile.png', animations: 'disabled' });
  await panel.getByRole('button', { name: 'Remove pack', exact: true }).scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  await page.screenshot({ path: evidence + '/remove-actions-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await panel.evaluate(element => element.scrollIntoView({ block: 'start' }));
  expect((await panel.getByRole('heading').boundingBox())!.y).toBeGreaterThan(80);
  await page.screenshot({ path: evidence + '/remove-overview-desktop.png', animations: 'disabled' });
  await confirm.check(); await panel.getByRole('button', { name: 'Remove pack', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(first.title + ' was removed');
  const after = await (await request.get('/api/app/recipes')).json();
  expect(after.installedIds).not.toContain('maintained-ui-kit-new');
  for (const suffix of ['keep', 'take', 'old']) expect(after.installedIds).toContain('maintained-ui-kit-' + suffix);
  expect((await mcp(request, { action: 'list' })).installed.map((item: { id: string }) => item.id)).not.toContain(first.id);
  const denied = await request.post('/api/app/recipe-packs', { data: { action: 'remove', packId: parent.id, expectedStateDigest: '0'.repeat(64), deleteRecipeIds: [] } });
  expect(denied.status()).toBe(403);
});
