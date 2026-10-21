import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
  expect(response.ok()).toBe(true);
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent?.result;
}

test('Canvas selects mixed analysis sources, inspects real originals and retains model/media identity after reload', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Mixed analysis sources' } })).json()).id;
  const model = (await mcp(request, 'viral_hit_generation_models', { kind: 'analysis' })).find((item: { id: string }) => item.id === 'media-batch-review');
  expect(model.referenceSchema.audio).toEqual({ min: 0, max: 4 });
  const assets: { id: string; kind: string; publicUrl: string; sha256: string }[] = [];
  for (const [kind, extension, mimeType, args] of [
    ['image', 'png', 'image/png', ['-f', 'lavfi', '-i', 'color=c=blue:s=80x60', '-frames:v', '1']],
    ['video', 'mp4', 'video/mp4', ['-f', 'lavfi', '-i', 'color=c=orange:s=180x320:r=12:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
    ['audio', 'wav', 'audio/wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '24000', '-c:a', 'pcm_s16le']],
  ] as const) {
    const file = resolve(`test-results/mixed-source.${extension}`);
    execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-y', ...args, file]);
    const response = await request.post(`/api/app/projects/${projectId}/assets`, { headers, multipart: { file: { name: `source.${extension}`, mimeType, buffer: readFileSync(file) } } });
    expect(response.ok()).toBe(true);
    assets.push({ ...(await response.json()).asset, kind });
  }
  await mcp(request, 'viral_hit_canvas_apply', { projectId, operations: [
    ...assets.flatMap(asset => [
      { type: 'upsert_card', card: { id: `source-${asset.kind}`, kind: 'asset', type: asset.kind, name: `Original ${asset.kind}`, url: asset.publicUrl, assetId: asset.id } },
      { type: 'place_card', cardId: `source-${asset.kind}` },
    ]),
    { type: 'upsert_card', card: { id: 'batch-draft', kind: 'generation', type: 'video', generationMode: 'analysis', modelId: 'media-batch-review', name: 'Batch review', prompt: 'Inventory these sources', referenceCardIds: [] } },
    { type: 'place_card', cardId: 'batch-draft' },
  ] });
  await page.goto('/canvas/' + projectId);
  const draft = page.locator('.react-flow__node[data-id="batch-draft"]');
  await expect(draft).toBeVisible();
  await expect(async () => {
    if (!(await page.locator('textarea').first().isVisible())) await draft.dblclick();
    await expect(page.locator('textarea').first()).toHaveValue('Inventory these sources', { timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await page.getByRole('button', { name: 'Analysis sources', exact: true }).click();
  for (const kind of ['image', 'video', 'audio']) await page.getByRole('button', { name: `Add Original ${kind}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Remove Original audio', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ animations: 'disabled', path: 'test-results/mixed-sources-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
  await page.screenshot({ animations: 'disabled', path: 'test-results/mixed-sources-mobile.png' });
  await dialog.getByRole('button', { name: 'Remove Original audio', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Add Original audio', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Add Original audio', exact: true }).click();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Analysis sources', exact: true })).toContainText('3');
  await page.setViewportSize({ width: 1440, height: 960 });
  const submitted = page.waitForRequest(req => req.url().endsWith('/api/effects/generate'));
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  const generation = (await submitted).postDataJSON().generation;
  expect(generation.modelId).toBe('media-batch-review');
  expect(generation.references.map((ref: { assetId: string }) => ref.assetId)).toEqual(assets.map(asset => asset.id));
  await expect(page.getByText('Media batch review — measured file metadata', { exact: false }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('80 × 60', { exact: false }).first()).toBeVisible();
  await page.locator('.react-flow__node[data-id="batch-draft"]').dblclick();
  await page.getByRole('button', { name: 'Analysis sources', exact: true }).click();
  for (const kind of ['image', 'video', 'audio']) await expect(page.getByRole('button', { name: `Remove Original ${kind}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const history = (await (await request.get(`/api/app/projects/${projectId}/generations`)).json()).items;
  expect(history[0].referenceAudios).toEqual([assets[2].publicUrl]);
  expect(history[0].resultText).toContain('pcm_s16le; 24000 Hz');
  expect(history[0].resultText).toContain('180 × 320');
  expect(history[0].resultText).toContain('No visual, speech, narrative or creative-quality interpretation');
  for (const asset of assets) expect((await request.get(asset.publicUrl)).ok()).toBe(true);
  expect(errors).toEqual([]);
  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } })).ok()).toBe(true);
});
