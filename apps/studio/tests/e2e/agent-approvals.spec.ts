import { test, expect, type APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENERATION_REQUEST_VERSION } from '../../src/core/commands/generation-contract';

const headers = { 'x-viral-hit-workspace-request': '1' };
type ToolResult = {
  isError?: boolean;
  structuredContent?: { result?: any; error?: { message: string; details?: { approvalId?: string; approvalState?: string } } };
};

async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(response.ok()).toBe(true);
  const text = await response.text();
  return JSON.parse(text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6)).result;
}

test('asking before generating holds agent runs and direct generations until a person decides, and memory is shared with agents', async ({ page, request }) => {
  test.setTimeout(240_000);
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Agent approval QA' } })).json()).id as string;
  const env = JSON.parse(await readFile(join(tmpdir(), 'viral-hit-e2e-worker.json'), 'utf8'));
  const worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/harness-worker.ts'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  try {
    await page.goto('/agent');
    const ask = page.getByRole('radio', { name: 'Ask me', exact: true });
    await ask.click();
    await expect(ask).toHaveAttribute('aria-checked', 'true');
    expect((await mcp(request, 'viral_hit_approvals', { action: 'list' })).structuredContent?.result.mode).toBe('ask');

    // Memory an agent saves appears for the person, and the person's rewrite reaches the agent.
    expect((await mcp(request, 'viral_hit_memory', { action: 'save', projectId, scope: 'workspace', text: 'Captions in Korean, casual tone' })).isError).not.toBe(true);
    await page.reload();
    const entry = page.getByRole('listitem').filter({ hasText: 'Captions in Korean, casual tone' });
    await expect(entry).toContainText('Agent');
    await entry.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('textbox', { name: 'Edit', exact: true }).fill('Captions in Korean, playful tone');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const memory = async () => (await mcp(request, 'viral_hit_memory', { action: 'list', projectId })).structuredContent?.result.memory as Array<{ text: string; source: string }>;
    await expect.poll(async () => (await memory()).map((item) => [item.text, item.source])).toEqual([['Captions in Korean, playful tone', 'person']]);

    // A run an agent queues waits without starting, then runs once approved from the header badge.
    const produce = (subject: string) => mcp(request, 'viral_hit_shot', { projectId, request: { action: 'produce', requestId: randomUUID(),
      spec: { subject, action: 'walks through a night market', duration: 3, provider: 'cinema-fixture', variations: 1 } } });
    const runs = async () => (await mcp(request, 'viral_hit_runs_list', { projectId })).structuredContent!.result.runs as Array<{ id: string; held: number; jobs: Array<{ state: string }> }>;
    const run = async (id: string) => (await runs()).find((item) => item.id === id)!;
    const first = await produce('A courier in a lime rain jacket');
    expect(first.isError, JSON.stringify(first)).not.toBe(true);
    const runId = first.structuredContent!.result.runId as string;
    expect((await run(runId)).held).toBe(1);
    await page.waitForTimeout(2500);
    expect((await run(runId)).jobs.every((job) => job.state === 'queued'), 'the worker leaves a held run alone').toBe(true);
    await page.goto('/editor/' + projectId);
    await page.getByRole('link', { name: '1 waiting', exact: true }).click();
    await expect(page).toHaveURL(/\/agent$/);
    const card = page.getByRole('article', { name: 'Approval for Agent approval QA', exact: true });
    await expect(card).toContainText('Requested by an agent through viral_hit_shot');
    await expect(card).toContainText('Video');
    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect.poll(async () => (await run(runId)).jobs.every((job) => job.state === 'succeeded'), { timeout: 90_000 }).toBe(true);
    await expect(page.getByRole('link', { name: /waiting$/ })).toHaveCount(0);

    // A rejected run is canceled before anything is submitted.
    const second = await produce('A florist closing her shop at dusk');
    const refusedId = second.structuredContent!.result.runId as string;
    await page.reload();
    await page.getByRole('article', { name: 'Approval for Agent approval QA', exact: true }).getByRole('button', { name: 'Reject', exact: true }).click();
    await expect.poll(async () => (await run(refusedId)).jobs.every((job) => job.state === 'canceled')).toBe(true);

    // A direct generation stops with an approval, then the same call goes through once a person approves it.
    const generation = { version: GENERATION_REQUEST_VERSION, projectId, mode: 'audio', modelId: 'voice-fixture-speech', prompt: 'Find the hit first', references: [], parameters: {} };
    const prepared = (await mcp(request, 'viral_hit_asset_generation', { request: { action: 'prepare', generation } })).structuredContent!.result;
    const submit = () => mcp(request, 'viral_hit_asset_generation', { request: { action: 'submit', generation: prepared.generation, generationIntentToken: prepared.generationIntentToken, expectedDigest: prepared.digest } });
    const waiting = await submit();
    expect(waiting.isError).toBe(true);
    expect(waiting.structuredContent!.error!.message).toContain('call this tool again with the same arguments');
    const approvalId = waiting.structuredContent!.error!.details!.approvalId!;
    expect((await submit()).structuredContent!.error!.details!.approvalId, 'asking again keeps one approval').toBe(approvalId);
    await page.reload();
    const direct = page.getByRole('article', { name: 'Approval for Agent approval QA', exact: true });
    await expect(direct).toContainText('voice-fixture-speech');
    await expect(direct).toContainText('Audio');
    await direct.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText('Nothing is waiting. Agent requests appear here.', { exact: true })).toBeVisible();
    const sent = await submit();
    expect(sent.isError, JSON.stringify(sent)).not.toBe(true);
    expect((await mcp(request, 'viral_hit_approvals', { action: 'get', id: approvalId })).structuredContent!.result.approval.state).toBe('used');
    await expect.poll(async () => ((await (await request.get('/api/app/projects/' + projectId + '/assets')).json()).assets as Array<{ type: string }>)
      .some((asset) => asset.type === 'audio'), { timeout: 30_000 }).toBe(true);
    await page.screenshot({ path: 'test-results/agent-approvals.png' });
  } finally {
    worker.kill();
    await request.post('/api/app/agent', { headers, data: { action: 'set_mode', mode: 'off' } });
  }
});
