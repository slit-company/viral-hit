import { test, expect, type APIRequestContext } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function library(request: APIRequestContext, action: Record<string, unknown>) {
  const response = await request.post('/api/app/skills', { headers, data: action });
  expect(response.ok(), await response.text()).toBe(true); return response.json();
}
async function agentSkill(request: APIRequestContext, id: string) {
  const response = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_skill_get', arguments: { skillId: id } } } });
  const text = await response.text(), rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  return rpc.result;
}

test('same-ID skill updates show both definitions; removal is reviewed and visible to connected agents', async ({ page, request }) => {
  const file = { schemaVersion: 1, kind: 'viral-hit-skill',
    manifest: { ...JSON.parse(await readFile('skills/official/consistent-characters/skill.json', 'utf8')), id: 'lifecycle-e2e', title: 'Shared story planning', version: '1.0.0', inputs: [], stages: [] },
    instructions: 'Plan a story for any project. Ask for the audience before drafting.' };
  const original = await library(request, { action: 'inspect', file });
  await library(request, { action: 'install', file, expectedDigest: original.digest });
  expect((await agentSkill(request, file.manifest.id)).structuredContent.result.instructions).toBe(file.instructions);
  const next = { ...file, manifest: { ...file.manifest, version: '2.0.0', scope: 'specialized', summary: 'Plan a three-scene product story with a reviewed opening.' }, instructions: 'Plan three scenes for a product story. Review the opening before generating.' };
  const upload = { name: 'story.viralhit-skill.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(next)) };
  const evidence = '../../research/evidence/skill-lifecycle'; await mkdir(evidence, { recursive: true });
  await page.goto('/skills');
  await expect(page.getByRole('button', { name: 'Import skill file', exact: true })).toBeEnabled();
  await page.getByLabel('Import skill file', { exact: true }).setInputFiles(upload);
  const dialog = page.getByRole('dialog'), update = dialog.getByRole('button', { name: 'Update skill', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Review update: Shared story planning' })).toBeVisible();
  await expect(dialog.getByText('Installed v1.0.0 → Incoming v2.0.0')).toBeVisible();
  await dialog.getByText('Read installed definition', { exact: true }).click();
  await expect(dialog.getByText(file.instructions, { exact: true })).toHaveText(file.instructions);
  await expect(dialog.getByText(next.instructions, { exact: true })).toHaveText(next.instructions);
  expect((await agentSkill(request, file.manifest.id)).structuredContent.result.instructions).toBe(file.instructions);
  await expect(update).toBeDisabled();
  await page.screenshot({ path: evidence + '/update-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await update.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: evidence + '/update-mobile.png', animations: 'disabled' });
  await dialog.getByText('Read installed definition', { exact: true }).click();
  await expect(dialog.getByText(next.instructions, { exact: true })).toBeVisible();
  await page.screenshot({ path: evidence + '/incoming-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: evidence + '/incoming-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('checkbox').check(); await update.click();
  await expect(page.getByRole('status')).toContainText('is updated');
  const active = (await agentSkill(request, file.manifest.id)).structuredContent.result;
  expect(active.instructions).toBe(next.instructions); expect(active.manifest.scope).toBe('specialized');
  await page.getByRole('button', { name: 'Read Shared story planning (lifecycle-e2e)', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove skill…', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Remove Shared story planning?' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Remove skill', exact: true })).toBeDisabled();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download skill first' }).click();
  const exported = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(exported.instructions).toBe(next.instructions);
  await page.screenshot({ path: evidence + '/remove-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: evidence + '/remove-desktop.png', animations: 'disabled' });
  // A change from another client makes this removal review stale.
  const newer = { ...next, instructions: 'A newer revision from another client.' };
  const newerReview = await library(request, { action: 'inspect', file: newer });
  await library(request, { action: 'update', file: newer, expectedDigest: newerReview.digest, expectedInstalledDigest: newerReview.update.digest });
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Remove skill', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed after review');
  expect((await agentSkill(request, file.manifest.id)).structuredContent.result.instructions).toBe(newer.instructions);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Read Shared story planning (lifecycle-e2e)', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove skill…', exact: true }).click();
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Remove skill', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('was removed');
  await expect(page.getByRole('heading', { name: 'Shared story planning', exact: true })).toHaveCount(0);
  expect((await agentSkill(request, file.manifest.id)).isError).toBe(true);
  const denied = await request.post('/api/app/skills', { data: { action: 'remove', skillId: file.manifest.id, expectedDigest: newerReview.digest } });
  expect(denied.status()).toBe(403);
  const restored = await library(request, { action: 'inspect', file });
  await library(request, { action: 'install', file, expectedDigest: restored.digest });
  expect((await agentSkill(request, file.manifest.id)).structuredContent.result.instructions).toBe(file.instructions);
  // Leave the shared browser workspace as it was for later catalog tests.
  await library(request, { action: 'remove', skillId: file.manifest.id, expectedDigest: restored.digest });
});
