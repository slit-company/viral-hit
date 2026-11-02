import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

const headers = { 'x-viral-hit-workspace-request': '1' };
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';

async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(response.ok()).toBe(true);
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6));
  expect(rpc.error).toBeUndefined();
  expect(rpc.result?.isError).not.toBe(true);
  return rpc.result;
}

test('editor toolbar and MCP export the timeline as separate layers in one ZIP', async ({ page, request }) => {
  test.setTimeout(180_000);
  const project = await request.post('/api/app/projects', { headers, data: { name: 'Layer QA' } });
  expect(project.ok()).toBe(true);
  const id = (await project.json()).id;
  const upload = async (name: string, color: string) => {
    const buffer = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=0x${color}:s=640x360`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
    const response = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name, mimeType: 'image/png', buffer } } });
    expect(response.ok()).toBe(true);
    return (await response.json()).asset as { id: string };
  };
  const coral = await upload('Coral.png', 'ff5a5f'), badge = await upload('Badge.png', 'ffffff');
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [
    { type: 'add_clip', clipId: 'coral', assetId: coral.id, sourceType: 'image', sourceDuration: 2, name: 'Coral' },
    { type: 'add_overlay', clipId: 'badge', assetId: badge.id, name: 'Badge', startTime: 0.5, duration: 1, width: 0.2 },
    { type: 'upsert_caption', clipId: 'cue', text: 'Layers ship separately', startTime: 0.2, duration: 1.5 },
  ] });
  const layers = ['README.txt', 'captions.mov', 'captions.srt', 'overlays.mov', 'picture.mp4'];

  await page.goto(`/editor/${id}`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export layers', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-layers\.zip$/);
  const saved = test.info().outputPath('layers.zip');
  await file.saveAs(saved);
  const zip = await JSZip.loadAsync(await readFile(saved));
  expect(Object.keys(zip.files).sort()).toEqual(layers);
  expect(await zip.file('captions.srt')!.async('string')).toBe('1\n00:00:00,200 --> 00:00:01,700\nLayers ship separately\n');
  await expect(page.getByRole('button', { name: 'Export layers', exact: true })).toBeEnabled();

  const outputPath = join(await mkdtemp(join(tmpdir(), 'vh-layers-e2e-')), 'layers.zip');
  const result = await mcp(request, 'viral_hit_editor_render_layers', { projectId: id, outputPath });
  const { files } = result.structuredContent.result as { files: Array<{ name: string; kind: string }> };
  expect(files.map((item) => item.name).sort()).toEqual(layers.filter((name) => name !== 'README.txt'));
  expect(Object.keys((await JSZip.loadAsync(await readFile(outputPath))).files).sort()).toEqual(layers);
});
