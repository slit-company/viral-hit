import { test, expect, type APIRequestContext } from '@playwright/test';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
  expect(response.ok()).toBe(true);
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
}

test('shot controls write one editable Shot line that UI and agents share', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Shot controls' } })).json()).id;
  const card = { id: 'run-draft', kind: 'generation', type: 'video', name: 'Fox run', prompt: 'A fox runs through tall grass.', modelId: 'kling-3' };
  await mcp(request, 'viral_hit_canvas_apply', { projectId, operations: [{ type: 'upsert_card', card }, { type: 'place_card', cardId: 'run-draft' }] });
  const saved = async () => (await (await request.get('/api/app/projects/' + projectId + '/snapshot')).json()).document.cards.find((item: { id: string }) => item.id === 'run-draft').prompt as string;

  await page.goto('/canvas/' + projectId);
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  await page.waitForTimeout(800);
  await node.dblclick();
  const prompt = page.locator('textarea').first();
  await expect(prompt).toHaveValue(card.prompt);
  await page.getByRole('button', { name: 'Shot', exact: true }).click();
  const panel = page.getByRole('group', { name: 'Shot controls' });
  for (const name of ['Close-up', 'Low angle', 'Push in', 'Golden hour']) await panel.getByRole('button', { name, exact: true }).click();
  const line = 'A fox runs through tall grass.\nShot: close-up, low angle, slow push in, golden hour.';
  await expect(prompt).toHaveValue(line);
  await expect(panel.getByRole('button', { name: 'Push in', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(saved).toBe(line);
  await page.screenshot({ path: 'test-results/cinema-shot-desktop.png' });
  await panel.getByRole('button', { name: 'Close-up', exact: true }).click();
  await expect.poll(saved).toBe('A fox runs through tall grass.\nShot: low angle, slow push in, golden hour.');
  await page.setViewportSize({ width: 390, height: 844 });
  // The Canvas camera keeps its desktop position on a phone; the panel itself narrows to the viewport.
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(390 - 48);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // An agent writes the same line through the prompt; the picker shows it as chosen.
  await mcp(request, 'viral_hit_canvas_apply', { projectId, operations: [{ type: 'upsert_card', card: { ...card, prompt: 'A fox sleeps.\nShot: wide shot, overhead shot, rain on the lens.' } }] });
  await expect(prompt).toHaveValue('A fox sleeps.\nShot: wide shot, overhead shot, rain on the lens.');
  await page.getByRole('button', { name: 'Shot, 2 chosen', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Overhead', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'Clear shot', exact: true }).click();
  await expect.poll(saved).toBe('A fox sleeps.\nShot: rain on the lens.');
  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } })).ok()).toBe(true);
});
