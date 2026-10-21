import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function setup(request: APIRequestContext) {
  const created = await request.post('/api/app/projects', { headers, data: { name: 'Storyboard browser proof' } });
  expect(created.ok()).toBe(true);
  const projectId = (await created.json()).id;
  const upload = await request.post('/api/app/projects/' + projectId + '/assets', { headers, multipart: { file: { name: 'Owned logo.png', mimeType: 'image/png', buffer: await readFile('public/logo.png') } } });
  expect(upload.ok()).toBe(true);
  const assets = (await (await request.get('/api/app/projects/' + projectId + '/assets')).json()).assets;
  return { projectId, asset: assets[0], endpoint: '/api/app/projects/' + projectId + '/storyboards' };
}
async function createInBrowser(page: Page, projectId: string) {
  await page.goto('/storyboards/' + projectId);
  await page.getByRole('button', { name: 'New storyboard', exact: true }).click();
  await page.getByLabel('Storyboard title', { exact: true }).fill('A film made for an independent workflow');
  await page.getByLabel('Use case', { exact: true }).selectOption('specialized');
  await page.getByRole('textbox', { name: 'Creative intent', exact: true }).fill('Two distinct beats, editable after assembly.');
  await page.getByRole('button', { name: 'Shots & results', exact: true }).click();
  await page.getByLabel('Shot title', { exact: true }).fill('Opening');
  await page.getByLabel('Shot direction', { exact: true }).fill('Hold the owned image unchanged.');
  await page.getByLabel('Shot duration (seconds)', { exact: true }).fill('1');
  await page.getByLabel('Shot caption', { exact: true }).fill('First beat');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Storyboard status' })).toContainText('Revision 1 · Saved');
}
async function save(page: Page, revision: number) {
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Storyboard status' })).toContainText('Revision ' + revision + ' · Saved');
}

test('author, reorder, inspect and accept two shots; shared agent edits preserve local drafts; assembly uses existing Runs', async ({ page, request }) => {
  page.on('dialog', dialog => void dialog.accept());
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { projectId, asset, endpoint } = await setup(request);
  await createInBrowser(page, projectId);
  const list = await (await request.get(endpoint)).json(), id = list[0].id;
  const read = async () => (await (await request.post(endpoint, { headers, data: { action: 'read', id } })).json());
  await page.getByRole('button', { name: 'Plan & references', exact: true }).click();
  await page.getByLabel('Add reference media', { exact: true }).selectOption(asset.id);
  await page.getByLabel('Observation 1', { exact: true }).fill('Use the supplied mark; no inferred character details.');
  await page.getByLabel('Observation basis 1', { exact: true }).selectOption('observed');
  await save(page, 2);
  await page.getByRole('button', { name: 'Shots & results', exact: true }).click();
  await page.getByText('References & creative decisions', { exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByLabel('Preserve (one per line)', { exact: true }).fill('Original image\nUnchanged palette\n');
  await save(page, 3);
  await page.getByLabel('Result to review', { exact: true }).selectOption('asset:' + asset.id);
  await expect(page.getByRole('region', { name: 'Review shot result' }).getByRole('img')).toBeVisible();
  await page.getByLabel('Review notes', { exact: true }).fill('Original logo inspected in preview; accepted for opening.');
  await page.getByRole('button', { name: 'Accept this result', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Storyboard status' })).toContainText('Revision 4 · Saved');
  await page.getByRole('button', { name: 'Add shot', exact: true }).click();
  await page.getByLabel('Shot title', { exact: true }).fill('Closing with a deliberately long descriptive title for independent authors');
  await page.getByLabel('Shot direction', { exact: true }).fill('Finish with the same original image.');
  await page.getByLabel('Shot duration (seconds)', { exact: true }).fill('2');
  await page.getByLabel('Shot caption', { exact: true }).fill('Second beat');
  await save(page, 5);
  expect(Object.keys((await read()).accepted)).toHaveLength(1);
  await page.getByLabel('Result to review', { exact: true }).selectOption('asset:' + asset.id);
  await page.getByLabel('Review notes', { exact: true }).fill('Reviewed closing image.');
  await page.getByRole('button', { name: 'Accept this result', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Storyboard status' })).toContainText('Revision 6 · Saved');
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await save(page, 7);
  expect((await read()).plan.shots[0].title).toContain('Closing');
  expect(Object.keys((await read()).accepted)).toHaveLength(2);

  await page.getByLabel('Shot direction', { exact: true }).fill('Local revised closing direction');
  const server = await read();
  const other = await request.post(endpoint, { headers, data: { action: 'save', id, expectedRevision: 7, plan: { ...server.plan, title: 'Agent changed the project title' } } });
  expect(other.ok()).toBe(true);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('server is at revision 8');
  await expect(page.getByLabel('Shot direction', { exact: true })).toHaveValue('Local revised closing direction');
  await page.reload();
  await page.getByRole('button', { name: 'Shots & results', exact: true }).click();
  await expect(page.getByLabel('Shot direction', { exact: true })).toHaveValue('Local revised closing direction');
  await expect(page.getByRole('alert')).toContainText('server is at revision 8');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download draft', exact: true }).click();
  const saved = await download; expect(saved.suggestedFilename()).toContain('.storyboard-draft.json');
  await page.getByText('Compare server plan', { exact: true }).click();
  await expect(page.getByLabel('Current server plan')).toContainText('Agent changed the project title');
  await page.getByRole('button', { name: 'Discard local changes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Storyboard status' })).toContainText('Revision 8 · Saved');
  await expect(page.getByRole('button', { name: 'Prepare editable sequence', exact: true })).toBeEnabled();

  const evidence = '../../research/evidence/storyboard-ui';
  await mkdir(evidence, { recursive: true });
  await page.getByRole('region', { name: 'Edit shot 1' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence + '/desktop-source.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Shot direction', { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: evidence + '/mobile-source.png' });
  await page.getByRole('button', { name: 'Prepare editable sequence', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Assemble storyboard' })).toContainText('sequence: queued');
  const runs = (await (await request.get('/api/app/projects/' + projectId + '/runs')).json()).runs;
  expect(runs).toHaveLength(1);
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: runs[0].id.slice(0, 8) })).toContainText('sequence');
  expect(errors).toEqual([]);
});

test('a lost assembly response survives reload and retries the exact reservation without another run', async ({ page, request }) => {
  page.on('dialog', dialog => void dialog.accept());
  const { projectId, asset, endpoint } = await setup(request);
  await createInBrowser(page, projectId);
  await page.getByLabel('Result to review', { exact: true }).selectOption('asset:' + asset.id);
  await page.getByLabel('Review notes', { exact: true }).fill('Approved real image preview.');
  await page.getByRole('button', { name: 'Accept this result', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Storyboard status' })).toContainText('Revision 2 · Saved');
  await expect(page.getByRole('button', { name: 'Prepare editable sequence', exact: true })).toBeEnabled();
  let requestId = '';
  await page.route('**' + endpoint, async route => {
    const body = route.request().postDataJSON();
    if (body?.action !== 'assemble') return route.continue();
    requestId = body.requestId;
    const response = await route.fetch(); expect(response.ok()).toBe(true);
    await route.abort('connectionreset');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Prepare editable sequence', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recover same request', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Pending storyboard request' })).toContainText(requestId);
  await page.getByRole('button', { name: 'Recover same request', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Pending storyboard request' })).toHaveCount(0);
  const runs = (await (await request.get('/api/app/projects/' + projectId + '/runs')).json()).runs;
  expect(runs).toHaveLength(1);
  expect(runs[0].request_key).toBe('storyboard:' + requestId);
});

test('independent recipe selection exposes typed inputs, pins saved definitions and reports missing runtime without a stuck request', async ({ page, request }) => {
  const { projectId } = await setup(request);
  await createInBrowser(page, projectId);
  await page.getByLabel('Generation recipe', { exact: true }).selectOption('community-fixture');
  await expect(page.getByLabel('Community frame prompt', { exact: true })).toBeVisible();
  await page.getByLabel('Community frame prompt', { exact: true }).fill('A still composition from an independent author');
  await save(page, 2);
  await page.getByRole('button', { name: 'Generate new attempt', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pending storyboard request' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate new attempt', exact: true })).toBeEnabled();
  expect((await (await request.get('/api/app/projects/' + projectId + '/runs')).json()).runs).toHaveLength(0);
});
