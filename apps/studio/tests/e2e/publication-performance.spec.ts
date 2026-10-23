import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('a delivered post shows connector readings and hand-entered numbers with their change', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Performance readings' } })).json()).id;
  await mkdir('test-results', { recursive: true });
  execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x1d2b53:s=320x240:d=1', '-frames:v', '1', 'test-results/performance-still.png']);
  const uploaded = await request.post('/api/app/projects/' + projectId + '/assets', { headers, multipart: { file: { name: 'performance-still.png', mimeType: 'image/png', buffer: await readFile('test-results/performance-still.png') } } });
  const asset = (await uploaded.json()).asset;
  const draft = await mcp(request, 'viral_hit_publication_change', { projectId, request: { action: 'create', requestKey: 'performance-e2e', connector: 'ext.local-archive', accountId: 'archive', assetIds: [asset.id], metadata: { title: 'Night drive teaser', collection: 'campaign' } } });
  await mcp(request, 'viral_hit_publication_change', { projectId, request: { action: 'approve', publicationId: draft.id, expectedRevision: draft.revision, expectedDigest: draft.digest, confirmed: true } });

  // Deliver with the real worker process against the same workspace, then stop it.
  const workspace = JSON.parse(await readFile(join(tmpdir(), 'viral-hit-e2e-worker.json'), 'utf8'));
  const worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/publication-worker.ts'], { env: { ...process.env, ...workspace }, stdio: 'ignore' });
  try {
    await expect.poll(async () => (await mcp(request, 'viral_hit_publication_list', { projectId })).publications[0].state, { timeout: 30_000 }).toBe('published');
  } finally { worker.kill('SIGTERM'); }
  let folder = '';
  for (const name of await readdir(workspace.VIRAL_HIT_ARCHIVE_DIR)) {
    const release = await readFile(join(workspace.VIRAL_HIT_ARCHIVE_DIR, name, 'release.json'), 'utf8').catch(() => '');
    if (release.includes(projectId)) folder = join(workspace.VIRAL_HIT_ARCHIVE_DIR, name);
  }
  expect(folder).not.toBe('');
  await writeFile(join(folder, 'metrics.json'), JSON.stringify({ views: 42, downloads: 5 }));

  await page.goto('/publish/' + projectId);
  const section = page.getByRole('region', { name: 'Performance' });
  const row = section.getByRole('listitem').filter({ hasText: 'Night drive teaser' });
  await expect(row).toContainText('no numbers yet');
  await row.getByRole('button', { name: 'Update' }).click();
  await expect(row.getByRole('definition').first()).toHaveText('42');
  await expect(row).toContainText('Downloads');

  await row.getByRole('button', { name: 'Enter numbers' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton', { name: 'Views' }).fill('50');
  await dialog.getByRole('textbox', { name: 'Note' }).fill('Checked on the archive dashboard');
  await dialog.getByRole('button', { name: 'Save numbers' }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByRole('definition').first()).toHaveText('50+8');
  await expect(row).toContainText('entered by hand');
  await expect(row).toContainText('Local release archive');

  const overview = await mcp(request, 'viral_hit_performance_read', { projectId });
  expect(overview.metrics).toEqual(['views', 'downloads']);
  expect(overview.items[0].latest.metrics).toEqual({ views: 50 });
  expect(overview.items[0].change).toEqual({ views: 8 });
  const history = await mcp(request, 'viral_hit_performance_read', { projectId, publicationId: draft.id });
  expect(history.history.map((item: { source: string }) => item.source)).toEqual(['manual', 'connector']);

  const evidence = '../../research/evidence/performance'; await mkdir(evidence, { recursive: true });
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: evidence + '/desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ animations: 'disabled', path: evidence + '/mobile.png' });
  await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } });
});
