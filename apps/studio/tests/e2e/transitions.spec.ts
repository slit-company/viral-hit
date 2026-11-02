import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { radialMaskAlpha, transitionFrame, type TimelineTransitionKind, type TransitionLayer } from '../../src/core/editor/transition-contract';
import type { TimelineDocument } from '../../src/core/editor/timeline-document';

const headers = { 'x-viral-hit-workspace-request': '1' };
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
type Rgb = [number, number, number];
const CORAL: Rgb = [255, 90, 95];
const OCEAN: Rgb = [37, 99, 235];

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

function coverage(layer: TransitionLayer, x: number, y: number) {
  if (x - layer.dx < 0 || x - layer.dx >= 1 || y - layer.dy < 0 || y - layer.dy >= 1) return 0;
  const { mask } = layer;
  if (mask.kind === 'rect' && (x < mask.left || x > 1 - mask.right || y < mask.top || y > 1 - mask.bottom)) return 0;
  if (mask.kind === 'radial') return radialMaskAlpha(mask.offset, Math.hypot((x - 0.5) * 16, (y - 0.5) * 9) / Math.hypot(8, 4.5));
  return 1;
}

function expected(kind: TimelineTransitionKind, progress: number, x: number, y: number): Rgb {
  const frame = transitionFrame(kind, progress);
  if (frame.blend === 'add') return [0, 1, 2].map((c) => Math.min(255, frame.outgoing.weight * CORAL[c] + frame.incoming.weight * OCEAN[c] + frame.white * 255)) as Rgb;
  const under = coverage(frame.outgoing, x, y), top = coverage(frame.incoming, x, y);
  return [0, 1, 2].map((c) => OCEAN[c] * top + CORAL[c] * under * (1 - top)) as Rgb;
}

function frameAt(file: string, time: number) {
  return execFileSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'scale=160:90', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
}

test('editor transitions: inspector choice, preview layers and both real exports follow the shared frame math', async ({ page, request }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const project = await request.post('/api/app/projects', { headers, data: { name: 'Transition QA' } });
  expect(project.ok()).toBe(true);
  const id = (await project.json()).id;
  const upload = async (name: string, color: Rgb) => {
    const hex = color.map((value) => value.toString(16).padStart(2, '0')).join('');
    const buffer = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=0x${hex}:s=640x360`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
    const response = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name, mimeType: 'image/png', buffer } } });
    expect(response.ok()).toBe(true);
    return (await response.json()).asset;
  };
  const coral = await upload('Coral.png', CORAL), ocean = await upload('Ocean.png', OCEAN);
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [
    { type: 'add_clip', clipId: 'coral', assetId: coral.id, sourceType: 'image', sourceDuration: 2, name: 'Coral' },
    { type: 'add_clip', clipId: 'ocean', assetId: ocean.id, sourceType: 'image', sourceDuration: 2, name: 'Ocean' },
  ] });
  const read = async () => (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline.document as TimelineDocument;
  const transitionOf = async () => (await read()).tracks.flatMap((track) => track.clips).find((clip) => clip.id === 'ocean')?.transition;

  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Ocean 2.00s', exact: true }).click();
  await page.getByRole('radio', { name: 'Wipe left', exact: true }).click();
  await expect.poll(transitionOf).toEqual({ kind: 'wipe-left', duration: 0.5 });
  const slider = page.getByRole('slider', { name: /^Duration/ });
  await slider.focus();
  for (let step = 0; step < 10; step += 1) await slider.press('ArrowRight');
  await expect.poll(transitionOf).toEqual({ kind: 'wipe-left', duration: 1 });
  const ruler = page.getByRole('button', { name: 'Move timeline playhead', exact: true });
  const box = (await ruler.boundingBox())!;
  await page.mouse.click(box.x + box.width * (2.5 / 4), box.y + box.height / 2);
  await expect(page.getByRole('img', { name: 'Ocean', exact: true })).toHaveCSS('clip-path', /inset\(0(px|%) 0(px|%) 0(px|%) 50%\)/);
  await page.screenshot({ path: 'test-results/transition-preview.png' });

  for (const kind of ['wipe-left', 'crossfade', 'circle-open'] as const) {
    await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'set_transition', clipId: 'ocean', transition: { kind, duration: 1 } }] });
    await expect.poll(async () => (await transitionOf())?.kind).toBe(kind);
    await page.reload();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
    await (await downloaded).saveAs(`test-results/transition-${kind}-browser.mp4`);
    const rendered = await mcp(request, 'viral_hit_editor_render', { projectId: id });
    const video = await request.get(rendered.structuredContent.result.asset.publicUrl);
    expect(video.ok()).toBe(true);
    await writeFile(`test-results/transition-${kind}-server.mp4`, await video.body());
    for (const exporter of ['browser', 'server']) {
      for (const progress of [0.25, 0.5, 0.75]) {
        const raw = frameAt(`test-results/transition-${kind}-${exporter}.mp4`, 2 + progress);
        for (const [x, y] of [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.3, 0.15], [0.7, 0.85]]) {
          const nearby = [[0, 0], [0.04, 0], [-0.04, 0], [0, 0.06], [0, -0.06]].map(([dx, dy]) => expected(kind, progress, x + dx, y + dy));
          if (nearby.some((color) => color.some((value, channel) => Math.abs(value - nearby[0][channel]) > 30))) continue;
          const offset = (Math.round(y * 89) * 160 + Math.round(x * 159)) * 3;
          const actual = [...raw.subarray(offset, offset + 3)];
          expect(actual.every((value, channel) => Math.abs(value - nearby[0][channel]) <= 24), `${exporter} ${kind} p=${progress} at ${x},${y}: ${actual} vs ${nearby[0].map(Math.round)}`).toBe(true);
        }
      }
    }
  }
});
