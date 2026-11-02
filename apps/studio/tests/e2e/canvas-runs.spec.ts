import { test, expect, type APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, text).not.toBe(true);
  return rpc.result.structuredContent.result;
}

// Select a card away from its centre: a finished video card has a play button there that opens the preview.
const select = (page: import('@playwright/test').Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 24, y: 40 } });

test('canvas runs only the stale steps of a chain, then branches it below the original', async ({ page, request }) => {
  test.setTimeout(180_000);
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Canvas branch QA' } })).json()).id as string;
  const upload = await request.post(`/api/app/projects/${projectId}/assets`, { headers, multipart: { file: { name: 'photo.png', mimeType: 'image/png', buffer: await readFile('public/logo.png') } } });
  const asset = (await upload.json()).asset as { id: string; publicUrl: string };
  await mcp(request, 'viral_hit_canvas_apply', { projectId, operations: [
    { type: 'upsert_card', card: { id: 'photo', kind: 'asset', type: 'image', name: 'Photo', url: asset.publicUrl, assetId: asset.id, status: 'ready' }, frame: { x: 0, y: 160, w: 300, h: 300 } },
    { type: 'upsert_card', card: { id: 'poster', kind: 'generation', type: 'image', name: 'Poster', prompt: 'A paper lantern poster', modelId: 'cinema-keyframe-fixture', referenceCardIds: ['photo'], aspectRatio: '1:1' }, frame: { x: 420, y: 160, w: 360, h: 300 } },
    { type: 'upsert_card', card: { id: 'motion', kind: 'generation', type: 'video', name: 'Motion', prompt: 'The lantern sways', modelId: 'cinema-video-fixture', referenceCardIds: ['poster'], aspectRatio: '1:1', duration: '3s' }, frame: { x: 900, y: 160, w: 360, h: 300 } },
  ] });
  const status = async () => (await (await request.get(`/api/app/projects/${projectId}/canvas-runs`, { headers })).json()) as { active: boolean; runs: Array<{ steps: Array<{ cardId: string; state: string }> }> };
  const env = JSON.parse(await readFile(join(tmpdir(), 'viral-hit-e2e-worker.json'), 'utf8'));
  const worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/harness-worker.ts'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  try {
    await page.goto('/canvas/' + projectId);
    await expect(page.locator('.react-flow__node[data-id="poster"] img')).toHaveCount(0);
    await select(page, 'motion');
    await page.getByRole('button', { name: 'Run changed', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'What will run', exact: true });
    await expect(dialog.getByRole('listitem')).toHaveText([/Poster.*No result yet/, /Motion.*Input runs first/]);
    await page.screenshot({ path: 'test-results/canvas-run-plan.png' });
    await dialog.getByRole('button', { name: 'Run changed steps (2)', exact: true }).click();
    await expect.poll(async () => (await status()).runs[0]?.steps.map((step) => step.state), { timeout: 60_000 }).toEqual(['succeeded', 'succeeded']);
    // Each card shows its new take in place: the image in the poster card, the video in the motion card.
    await expect(page.locator('.react-flow__node[data-id="poster"] img').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.react-flow__node[data-id="motion"] video')).toHaveCount(1, { timeout: 15_000 });

    await select(page, 'motion');
    await page.getByRole('button', { name: 'Run changed', exact: true }).click();
    await expect(dialog).toContainText('Everything is up to date.');
    await expect(dialog.getByRole('listitem')).toHaveText([/Poster.*Reuses result/, /Motion.*Reuses result/]);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await select(page, 'poster');
    await page.getByRole('button', { name: 'Branch', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Branch added below.' })).toBeVisible();
    const copies = page.locator('.react-flow__node[data-id^="shape:branch-"]');
    await expect(copies).toHaveCount(2, { timeout: 15_000 });
    const ids = await copies.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')!));
    const plans = await Promise.all(ids.map((cardId) => mcp(request, 'viral_hit_canvas_run', { projectId, request: { action: 'plan', cardId } })));
    const chain = plans.find((result) => result.plan.steps.length === 2)!.plan.steps;
    expect(chain.map((step: { name: string; action: string; reason: string }) => [step.name, step.action, step.reason])).toEqual([['Poster', 'run', 'no-result'], ['Motion', 'run', 'upstream']]);
    expect(chain.every((step: { cardId: string }) => ids.includes(step.cardId)), 'the branch uses its own copies').toBe(true);
    await page.screenshot({ path: 'test-results/canvas-branch.png' });
  } finally { worker.kill(); }
});
