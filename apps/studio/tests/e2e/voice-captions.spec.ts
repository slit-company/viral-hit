import { test, expect, type APIRequestContext } from '@playwright/test';
import type { TimelineDocument } from '../../src/core/editor/timeline-document';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  const text = await response.text();
  return JSON.parse(text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6)).result;
}

test('voice timing from the provider becomes captions with measured words, from the editor and from MCP', async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = (await (await request.post('/api/app/projects', { headers, data: { name: 'Voice captions QA' } })).json()).id;
  await page.goto(`/studio/${id}?target=audio&model=voice-fixture-speech`);
  await page.getByLabel('Audio prompt', { exact: true }).fill('Find the hit first');
  await page.getByRole('button', { name: 'Generate audio', exact: true }).click();
  await expect(page.getByText('Listen to generated audio', { exact: true })).toBeVisible({ timeout: 30_000 });
  const assets = (await (await request.get(`/api/app/projects/${id}/assets`)).json()).assets as Array<{ id: string; type: string }>;
  const voice = assets.find((asset) => asset.type === 'audio')!;
  const timing = await (await request.get(`/api/app/projects/${id}/assets/${voice.id}/speech-words`)).json();
  expect(timing.words.map((word: { text: string }) => word.text)).toEqual(['Find', 'the', 'hit', 'first']);
  expect((await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'add_clip', clipId: 'voice', assetId: voice.id, sourceType: 'audio', sourceDuration: 1.8, startTime: 1, name: 'Narration' }] })).isError).not.toBe(true);
  const read = async () => (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline.document as TimelineDocument;
  const captions = async () => (await read()).tracks.filter((track) => track.kind === 'caption').flatMap((track) => track.clips);

  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Narration 1.80s', exact: true }).click();
  await page.getByRole('button', { name: 'Captions from voice (4 words)', exact: true }).click();
  await expect.poll(async () => (await captions()).map((clip) => [clip.startTime, clip.text])).toEqual([[1, 'Find the hit first']]);
  expect((await captions())[0].words).toEqual([
    { text: 'Find', start: 0, end: 0.35 }, { text: 'the', start: 0.4, end: 0.75 }, { text: 'hit', start: 0.8, end: 1.15 }, { text: 'first', start: 1.2, end: 1.55 },
  ]);
  await page.screenshot({ path: 'test-results/voice-captions-editor.png' });

  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'move_clip', clipId: 'voice', startTime: 2 }] });
  const moved = await mcp(request, 'viral_hit_captions_from_voice', { projectId: id, clipId: 'voice', replace: true });
  expect(moved.isError, JSON.stringify(moved)).not.toBe(true);
  expect((await captions()).map((clip) => [clip.startTime, clip.text])).toEqual([[2, 'Find the hit first']]);
  const missing = await mcp(request, 'viral_hit_captions_from_voice', { projectId: id, clipId: 'nope' });
  expect(missing.isError).toBe(true);
});

