import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { ExtensionDiagnostics } from '../../src/core/extensions/contract';

test('extension diagnostics agree across HTTP and MCP, show missing settings and refresh without execution', async ({ page, request }) => {
  const response = await request.get('/api/app/extensions');
  expect(response.ok()).toBe(true); expect(response.headers()['cache-control']).toBe('no-store');
  const status = await response.json() as ExtensionDiagnostics;
  const rpcResponse = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_extension_status', arguments: {} } },
  });
  const text = await rpcResponse.text(), rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc)).not.toBe(true);
  expect(rpc.result.structuredContent.result.groups).toEqual(status.groups);
  const protectedProvider = status.groups.find(group => group.kind === 'providers')!.items.find(item => item.id === 'protected-fixture')!;
  expect(protectedProvider.state).toBe('needs-setup');
  expect(protectedProvider.configuration).toEqual([{ name: 'VIRAL_HIT_E2E_PROVIDER_KEY', present: false }]);
  expect(JSON.stringify(status)).not.toContain('fixture-only-secret');
  expect(JSON.stringify(status)).not.toContain('DIAGNOSTICS_MUST_NOT_EXECUTE_MODULES');
  const models = await (await request.get('/api/app/effects/models?type=ai-image')).json();
  expect(models.models.find((model: { id: string }) => model.id === 'protected-fixture-image').available).toBe(false);
  const mutations: string[] = [];
  page.on('request', req => { if (req.method() !== 'GET' && req.url().includes('/api/')) mutations.push(req.url()); });
  await page.goto('/extensions');
  await expect(page.getByRole('heading', { name: 'Know what’s connected.' })).toBeVisible();
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Studio image service' }) });
  await expect(card).toContainText('Needs setup');
  await expect(card).toContainText('For a specific job');
  await expect(card).toContainText('VIRAL_HIT_E2E_PROVIDER_KEY');
  await expect(page.getByText('Execution is not tested here.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled();
  await expect(card.getByText('Missing', { exact: true })).toBeVisible();
  const evidence = '../../research/evidence/extension-diagnostics';
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: evidence + '/desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: evidence + '/mobile.png' });
  await page.getByRole('button', { name: /Workflow steps/ }).click();
  await expect(page.getByRole('region', { name: 'Workflow steps status' })).toContainText('restart the app');
  await page.getByRole('button', { name: /Publishing/ }).click();
  await expect(page.getByRole('region', { name: 'Publishing status' })).toContainText('Local release archive');
  await page.getByRole('button', { name: /Agent skills/ }).click();
  await expect(page.getByRole('region', { name: 'Agent skills status' })).toContainText('Consistent characters');
  expect(mutations).toEqual([]);
});
