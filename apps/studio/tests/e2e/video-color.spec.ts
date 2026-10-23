import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const headers = { 'x-viral-hit-workspace-request': '1' };
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
// Saturated and mid-tone patches are where a BT.601/BT.709 mismatch is largest.
const colors = ['0x204080', '0x32a05a', 'lime', '0x808080', 'white'];

async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  const body = await response.text();
  const rpc = JSON.parse(body.startsWith('{') ? body : body.split('\n').find((line) => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc)).not.toBe(true);
  return rpc.result;
}

function writeFixture(file: string, tag: string | null) {
  const input = colors.map((color, index) => `color=${color}:s=64x80:r=10:d=2[c${index}]`).join(';')
    + ';' + colors.map((_, index) => `[c${index}]`).join('') + 'hstack=inputs=5';
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', input,
    '-vf', `scale=320:80${tag ? ':out_color_matrix=' + tag : ''}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    ...(tag ? ['-colorspace', tag, '-color_primaries', tag, '-color_trc', tag] : []), file]);
}

// Exports are 1920x1080; the 4:1 source is contained at 6x scale, centered vertically.
function patchCenters(file: string) {
  const frame = execFileSync(ffmpeg, ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1920 * 1080 * 3 + 1024 });
  expect(frame.length).toBe(1920 * 1080 * 3);
  return colors.map((_, index) => {
    const offset = (540 * 1920 + 192 + index * 384) * 3;
    return [...frame.subarray(offset, offset + 3)];
  });
}

for (const tag of [null, 'smpte170m'] as const) {
  test(`browser and server exports agree on ${tag ?? 'untagged'} video color`, async ({ page, request }) => {
    test.setTimeout(150_000);
    const label = tag ?? 'untagged';
    const id = (await (await request.post('/api/app/projects', { headers, data: { name: `Color check · ${label}` } })).json()).id;
    const source = `test-results/color-${label}.mp4`;
    writeFixture(source, tag);
    const asset = (await (await request.post(`/api/app/projects/${id}/assets`, {
      headers, multipart: { file: { name: `color-${label}.mp4`, mimeType: 'video/mp4', buffer: await readFile(source) } },
    })).json()).asset;
    await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [
      { type: 'add_clip', clipId: 'patches', assetId: asset.id, name: 'Color patches', sourceType: 'video', sourceDuration: 2 },
    ] });

    await page.goto(`/editor/${id}`);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
    await (await download).saveAs(`test-results/color-${label}-browser.mp4`);
    const rendered = await mcp(request, 'viral_hit_editor_render', { projectId: id });
    const response = await request.get(rendered.structuredContent.result.asset.publicUrl);
    await writeFile(`test-results/color-${label}-server.mp4`, await response.body());

    const browser = patchCenters(`test-results/color-${label}-browser.mp4`);
    const server = patchCenters(`test-results/color-${label}-server.mp4`);
    await writeFile(`test-results/color-${label}-evidence.json`, JSON.stringify({ colors, browser, server }, null, 2));
    for (const [index, pixel] of browser.entries()) {
      for (const [channel, value] of pixel.entries()) {
        expect(Math.abs(value - server[index][channel]), `${colors[index]} channel ${channel}: ${pixel} vs ${server[index]}`).toBeLessThanOrEqual(8);
      }
    }
  });
}
