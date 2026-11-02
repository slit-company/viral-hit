import { test, expect, type APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TimelineDocument } from '../../src/core/editor/timeline-document';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function call(request: APIRequestContext, projectId: string, payload: unknown) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_shot', arguments: { projectId, request: payload } } },
  });
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent.result;
}

type Shot = { requestId: string; sequenceId: string; shotId: string; position: number; attempt: number; continuesFrom: string | null; spec: { startAssetId?: string } | null; takes: Array<{ state: string; assetId?: string }> };

test('Cinema continues a scene from a take, re-renders one shot and cuts the sequence with transitions', async ({ page, request }) => {
  test.setTimeout(180_000);
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Cinema sequence fixture' } })).json()).id;
  const url = '/api/app/projects/' + projectId + '/shots';
  const shots = async () => (await (await request.get(url)).json()).shots as Shot[];
  const done = (shot?: Shot) => Boolean(shot && shot.takes.length > 0 && shot.takes.every(take => take.state === 'succeeded'));
  await page.goto('/cinema/' + projectId);
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('A courier in a lime rain jacket');
  await page.getByRole('textbox', { name: 'Action', exact: true }).fill('runs through a night market');
  await page.getByRole('combobox', { name: 'Service', exact: true }).selectOption('cinema-fixture');
  await page.getByRole('combobox', { name: 'Length', exact: true }).selectOption('3');
  await page.getByRole('combobox', { name: 'Takes', exact: true }).selectOption('1');
  const env = JSON.parse(await readFile(join(tmpdir(), 'viral-hit-e2e-worker.json'), 'utf8'));
  const worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/harness-worker.ts'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  try {
    await page.getByRole('button', { name: 'Render takes (1)', exact: true }).click();
    await expect.poll(async () => done((await shots())[0]), { timeout: 45_000 }).toBe(true);
    const [first] = await shots();
    expect(first.sequenceId).toBe(first.requestId);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'The next shot starts from the last frame of shot 1.' })).toBeVisible();
    const frame = await page.evaluate(id => JSON.parse(localStorage.getItem('viral-hit:cinema:' + id)!).startAssetId as string, projectId);
    expect(frame).toMatch(/^tail-/);
    expect((await call(request, projectId, { action: 'continue', assetId: first.takes[0].assetId })).frame.assetId).toBe(frame);
    await page.getByRole('textbox', { name: 'Action', exact: true }).fill('turns toward the camera and smiles');
    await page.getByRole('button', { name: 'Render takes (1)', exact: true }).click();
    await expect.poll(async () => { const list = await shots(); return list.length === 2 && list.every(done); }, { timeout: 45_000 }).toBe(true);
    const second = (await shots()).find(shot => shot.position === 2)!;
    expect(second.sequenceId).toBe(first.sequenceId);
    expect(second.continuesFrom).toBe(first.takes[0].assetId);
    expect(second.spec?.startAssetId).toBe(frame);
    await expect(page.getByRole('status').filter({ hasText: 'Rendering adds shot 3 to this sequence.' })).toBeVisible();
    await page.getByRole('article').filter({ hasText: 'turns toward the camera' }).getByRole('button', { name: 'Render again', exact: true }).click();
    await expect.poll(async () => { const list = await shots(); return list.length === 3 && list.every(done); }, { timeout: 45_000 }).toBe(true);
    const attempts = (await shots()).filter(shot => shot.position === 2);
    expect(attempts.map(shot => shot.attempt).sort()).toEqual([1, 2]);
    expect(new Set(attempts.map(shot => shot.shotId)).size).toBe(1);
    await expect(page.getByRole('heading', { name: 'Sequence · 2 shots', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Between shots', exact: true }).selectOption('crossfade');
    await page.getByRole('button', { name: 'Add sequence to timeline', exact: true }).click();
    await expect(page.getByText('Added 2 shots to the timeline.', { exact: true })).toBeVisible();
    const timeline = (await (await request.get('/api/app/projects/' + projectId + '/timeline')).json()).timeline.document as TimelineDocument;
    const visuals = timeline.tracks.filter(track => track.kind === 'video').flatMap(track => track.clips);
    expect(visuals).toHaveLength(2);
    expect(visuals[0].transition).toBeUndefined();
    expect(visuals[1].transition).toEqual({ kind: 'crossfade', duration: 0.5 });
    await page.screenshot({ path: 'test-results/cinema-sequence-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/cinema-sequence-mobile.png' });
  } finally {
    const exit = new Promise(resolve => worker.once('exit', resolve)); worker.kill('SIGTERM'); await exit;
  }
});

