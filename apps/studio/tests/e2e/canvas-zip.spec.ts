import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
const headers = { 'x-viral-hit-workspace-request': '1' };
test('Canvas batch download retains both original files in a standard ZIP without loading an archive reader', async ({ request, page }) => {
  const response = await request.post('/api/app/projects', { headers, data: { name: 'Canvas ZIP proof' } });
  const id = (await response.json()).id, bytes = await readFile('public/logo.png');
  const upload = await request.post('/api/app/projects/' + id + '/assets', { headers, multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: bytes } } });
  expect(upload.ok()).toBe(true); const asset = (await upload.json()).asset;
  const call = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_canvas_apply', arguments: { projectId: id, operations: ['first', 'second'].map((name, i) => ({
      type: 'upsert_card', card: { id: name, kind: 'asset', type: 'image', name: name + '.png', url: asset.publicUrl, assetId: asset.id, status: 'ready' }, frame: { x: 200 + i * 420, y: 160, w: 360, h: 300 },
    })) } } } });
  const text = await call.text(), rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, text).not.toBe(true);
  const scripts: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('/canvas/' + id);
  const first = page.locator('.react-flow__node[data-id="first"]'), second = page.locator('.react-flow__node[data-id="second"]');
  await expect(first).toBeVisible(); await expect(second).toBeVisible();
  await first.click(); await second.click({ modifiers: ['Meta'] });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Batch download', exact: true }).click();
  const file = await downloaded; expect(file.suggestedFilename()).toBe('canvas-group-assets.zip');
  const archive = await JSZip.loadAsync(await readFile((await file.path())!), { checkCRC32: true });
  const entries = Object.values(archive.files).filter(entry => !entry.dir);
  expect(entries).toHaveLength(2);
  for (const entry of entries) expect(Buffer.from(await entry.async('uint8array'))).toEqual(bytes);
  expect(scripts.some(url => url.includes('jszip'))).toBe(false);
});
