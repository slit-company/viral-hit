import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, projectId: string, body: unknown) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_storyboard', arguments: { projectId, request: body } } },
  });
  expect(response.ok()).toBe(true); const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc)).not.toBe(true);
  return rpc.result.structuredContent.result;
}
test('an independently authored specialized storyboard shares revision and accepted media through MCP, HTTP and existing Runs', async ({ request, page }) => {
  const project = await request.post('/api/app/projects', { headers, data: { name: 'Independent storyboard flow' } });
  const projectId = (await project.json()).id, endpoint = '/api/app/projects/' + projectId + '/storyboards';
  const buffer = await readFile('public/logo.png'), sha256 = createHash('sha256').update(buffer).digest('hex');
  const uploaded = await request.post('/api/app/projects/' + projectId + '/assets', { headers, multipart: { file: { name: 'storyboard-source.png', mimeType: 'image/png', buffer } } });
  expect(uploaded.ok()).toBe(true); const asset = (await uploaded.json()).asset;
  const plan = { schemaVersion: 1, scope: 'specialized', title: 'Independent logo introduction', intent: 'Two editable beats using an owned logo',
    references: [{ id: 'logo', assetId: asset.id, sha256, observation: 'Proposed use of uploaded logo', basis: 'proposed' }],
    shots: ['opening', 'closing'].map(id => ({ id, title: id, duration: 1, direction: 'Hold the original logo', references: ['logo'], caption: id })) };
  const saved = await mcp(request, projectId, { action: 'save', id: 'intro', expectedRevision: 0, plan });
  expect(saved.revision).toBe(1);
  const read = await request.post(endpoint, { headers, data: { action: 'read', id: 'intro' } });
  expect(read.ok()).toBe(true); expect((await read.json()).plan.title).toBe(plan.title);
  for (const [index, shotId] of ['opening', 'closing'].entries()) {
    const result = await mcp(request, projectId, { action: 'accept', id: 'intro', expectedRevision: index + 1, shotId,
      source: { kind: 'asset', assetId: asset.id, sha256 }, notes: 'Fixture input selected explicitly; no AI-quality claim' });
    expect(result.accepted[shotId].sha256).toBe(sha256);
  }
  const stale = await request.post(endpoint, { headers, data: { action: 'save', id: 'intro', expectedRevision: 1, plan } }); expect(stale.status()).toBe(409);
  const requestId = randomUUID(), run = await mcp(request, projectId, { action: 'assemble', id: 'intro', expectedRevision: 3, requestId });
  const resumed = await mcp(request, projectId, { action: 'resume', id: 'intro', requestId }); expect(resumed.runId).toBe(run.runId);
  const runs = (await (await request.get('/api/app/projects/' + projectId + '/runs')).json()).runs;
  expect(runs).toHaveLength(1); expect(runs[0].jobs[0].operation).toBe('editor.sequence');
  await page.goto('/editor/' + projectId);
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  const runCard = page.getByRole('article').filter({ hasText: run.runId.slice(0, 8) });
  await expect(runCard).toContainText('sequence');
  await expect(runCard).toContainText('queued');
});
