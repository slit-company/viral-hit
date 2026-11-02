import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import type { TimelineDocument } from '../../src/core/editor/timeline-document';

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

/** Horizontal extent of highlight-yellow and white caption pixels in one decoded frame. */
function captionSpans(file: string, time: number) {
  const width = 640, height = 360;
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  let yellowMin = width, yellowMax = -1, whiteMin = width, whiteMax = -1;
  for (let y = Math.floor(height * 0.6); y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 3;
    const [r, g, b] = [raw[offset], raw[offset + 1], raw[offset + 2]];
    if (r > 200 && g > 160 && b < 100) { yellowMin = Math.min(yellowMin, x); yellowMax = Math.max(yellowMax, x); }
    if (r > 215 && g > 215 && b > 215) { whiteMin = Math.min(whiteMin, x); whiteMax = Math.max(whiteMax, x); }
  }
  return { yellowMin, yellowMax, whiteMin, whiteMax };
}

test('spoken-word captions: measured words, preview colour, re-timed edits and both real exports', async ({ page, request }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const project = await request.post('/api/app/projects', { headers, data: { name: 'Caption words QA' } });
  const id = (await project.json()).id;
  const buffer = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=0x1e293b:s=640x360', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
  const upload = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name: 'Slate.png', mimeType: 'image/png', buffer } } });
  const slate = (await upload.json()).asset;
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [
    { type: 'add_clip', clipId: 'slate', assetId: slate.id, sourceType: 'image', sourceDuration: 3, name: 'Slate' },
    { type: 'captions_from_words', words: [{ text: 'ONE', start: 0, end: 1 }, { text: 'TWO', start: 1, end: 2 }, { text: 'THREE', start: 2, end: 3 }], maxWords: 6, maxSeconds: 4 },
    { type: 'set_caption_style', preset: 'bold' },
  ] });
  const read = async () => (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline.document as TimelineDocument;
  const cue = async () => (await read()).tracks.flatMap((track) => track.clips).find((clip) => clip.sourceType === 'caption')!;
  expect((await cue()).words?.map((word) => word.start)).toEqual([0, 1, 2]);

  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: /^ONE TWO THREE/ }).click();
  await page.getByRole('radio', { name: 'Yellow', exact: true }).click();
  await expect.poll(async () => (await read()).captionHighlight).toBe('#FFD60A');
  await expect(page.getByText('This caption uses measured word timing.')).toBeVisible();
  const ruler = page.getByRole('button', { name: 'Move timeline playhead', exact: true });
  await ruler.scrollIntoViewIfNeeded();
  const box = (await ruler.boundingBox())!;
  await page.mouse.click(box.x + box.width * (1.5 / 3), box.y + box.height / 2);
  await expect(page.getByText('TWO', { exact: true })).toHaveCSS('color', 'rgb(255, 214, 10)');
  await expect(page.getByText('ONE', { exact: true })).not.toHaveCSS('color', 'rgb(255, 214, 10)');
  await page.screenshot({ path: 'test-results/caption-words-preview.png' });

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  await (await downloaded).saveAs('test-results/caption-words-browser.mp4');
  const rendered = await mcp(request, 'viral_hit_editor_render', { projectId: id });
  const video = await request.get(rendered.structuredContent.result.asset.publicUrl);
  await writeFile('test-results/caption-words-server.mp4', await video.body());
  for (const exporter of ['browser', 'server']) {
    const [one, two, three] = [0.5, 1.5, 2.5].map((time) => captionSpans(`test-results/caption-words-${exporter}.mp4`, time));
    expect(one.yellowMax, `${exporter}: one lit`).toBeGreaterThan(0);
    expect(one.yellowMax < two.yellowMin && two.yellowMax < three.yellowMin, `${exporter} word order ${JSON.stringify({ one, two, three })}`).toBe(true);
    expect(two.whiteMin < two.yellowMin && two.whiteMax > two.yellowMax, `${exporter}: other words stay white`).toBe(true);
    expect(Math.abs((one.yellowMin + three.yellowMax) / 2 - 320), `${exporter}: centred`).toBeLessThan(16);
  }

  const textbox = page.getByRole('textbox', { name: 'Caption text' });
  await textbox.fill('ONE MORE TWO THREE');
  await expect.poll(async () => (await cue()).words?.map((word) => word.text)).toEqual(['ONE', 'MORE', 'TWO', 'THREE']);
  const edited = (await cue()).words!;
  expect(edited[2]).toEqual({ text: 'TWO', start: 1, end: 2 });
  expect(edited[3]).toEqual({ text: 'THREE', start: 2, end: 3 });
});

