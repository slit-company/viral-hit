import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
  expect(response.ok()).toBe(true);
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent?.result;
}

test('an installed publishing destination supplies its form, ordered media review and shared approval boundary', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Open publishing destination' } })).json()).id;
  await mkdir('test-results', { recursive: true });
  execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x8caa77:s=320x240:d=1', '-frames:v', '1', 'test-results/release-image.png']);
  execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.2', 'test-results/release-audio.wav']);
  const assets = [];
  for (const [name, type] of [['release-image.png', 'image/png'], ['release-audio.wav', 'audio/wav']]) {
    const uploaded = await request.post('/api/app/projects/' + projectId + '/assets', { headers, multipart: { file: { name, mimeType: type, buffer: await readFile('test-results/' + name) } } });
    expect(uploaded.ok()).toBe(true); assets.push((await uploaded.json()).asset);
  }
  const catalog = await mcp(request, 'viral_hit_publication_list', { projectId });
  expect(catalog.installedConnectors.connectors[0].scope).toBe('general');
  expect(catalog.installedConnectors.connectors[0].metadataSchema.required).toEqual(['title', 'collection']);
  expect(catalog.installedConnectors.connectors[0].destinations[0].configuration).toBeUndefined();
  await page.goto('/publish/' + projectId);
  await page.getByRole('combobox', { name: 'Destination', exact: true }).selectOption('ext.local-archive');
  const form = page.getByRole('region', { name: 'Installed destination draft' });
  await form.getByRole('combobox', { name: 'Configured destination' }).selectOption('archive');
  await form.getByRole('checkbox', { name: /release-image.png/ }).check();
  await form.getByRole('checkbox', { name: /release-audio.wav/ }).check();
  await form.getByRole('textbox', { name: 'Release title', exact: true }).fill('October release set');
  await form.getByRole('combobox', { name: 'Collection', exact: true }).selectOption('"portfolio"');
  await form.getByRole('textbox', { name: 'Release notes', exact: true }).fill('A still and its original score, kept together.');
  await form.getByRole('button', { name: 'Save draft', exact: true }).click();
  const card = page.getByRole('article', { name: 'Publication October release set' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('img', { name: 'Retained image 1' })).toBeVisible();
  await expect.poll(() => card.locator('audio').evaluate(node => (node as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  const confirmation = card.getByRole('checkbox'); await expect(confirmation).toBeEnabled();
  await expect(card.getByRole('button', { name: 'Approve delivery' })).toBeDisabled();
  const listed = await mcp(request, 'viral_hit_publication_list', { projectId }), draft = listed.publications[0];
  expect(draft.state).toBe('draft'); expect(draft.external.assets.map((asset: { assetId: string }) => asset.assetId)).toEqual(assets.map(asset => asset.id));
  for (let index = 0; index < assets.length; index++) {
    const result = await request.get('/api/app/projects/' + projectId + '/publications/' + draft.id + '/media?digest=' + draft.digest + '&asset=' + index);
    expect(result.ok()).toBe(true); expect(await result.body()).toEqual(await readFile('test-results/' + ['release-image.png', 'release-audio.wav'][index]));
  }
  const evidence = '../../research/evidence/publishing-extensions'; await mkdir(evidence, { recursive: true });
  await page.screenshot({ animations: 'disabled', path: evidence + '/desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await confirmation.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ animations: 'disabled', path: evidence + '/mobile.png' });
  await confirmation.check();
  await card.getByRole('button', { name: 'Approve delivery', exact: true }).click();
  await expect(card.getByText('Queued for delivery', { exact: true })).toBeVisible();
  expect((await mcp(request, 'viral_hit_publication_list', { projectId })).publications[0].state).toBe('approved');
  const untrusted = await request.post('/api/app/projects/' + projectId + '/publications', { data: { action: 'stop', publicationId: draft.id, expectedRevision: draft.revision } });
  expect(untrusted.status()).toBe(403);
  await mcp(request, 'viral_hit_publication_change', { projectId, request: { action: 'stop', publicationId: draft.id, expectedRevision: draft.revision } });
  await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } });
});
