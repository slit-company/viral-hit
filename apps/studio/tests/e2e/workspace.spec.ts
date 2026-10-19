import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createDemoMedia } from '../../scripts/demo-media.mjs';

const headers = { 'x-viral-hit-workspace-request': '1' };
let rpcId = 0;
async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(response.ok()).toBeTruthy();
  const text = await response.text();
  const data = JSON.parse(text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6));
  expect(data.error).toBeUndefined();
  expect(data.result?.isError).not.toBe(true);
  return data.result;
}

async function project(request: APIRequestContext, name: string) {
  const response = await request.post('/api/app/projects', { headers, data: { name } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).id as string;
}

test('Canvas UI commands and MCP edits share durable state; unchanged polling is lightweight', async ({ page, request }) => {
  const id = await project(request, 'Canvas concurrency QA');
  const initial = { id: 'qa-draft', kind: 'generation', type: 'image', name: 'QA draft', prompt: 'Original prompt', modelId: 'gpt-image-2.5-flare' };
  await mcp(request, 'viral_hit_canvas_apply', { projectId: id, operations: [{ type: 'upsert_card', card: initial, frame: { x: 200, y: 160, w: 360, h: 300 } }] });
  const writes: string[] = [];
  const reads: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/commands')) writes.push(req.postData() ?? '');
    if (req.method() === 'GET') reads.push(req.url());
    expect(req.method() === 'PUT' && req.url().includes('/snapshot')).toBe(false);
  });
  await page.goto(`/canvas/${id}`);
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  // Let initial snapshot hydration and camera fit finish before pointer input.
  await page.waitForTimeout(800);
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + box!.height / 2 + 60, { steps: 8 });
  await mcp(request, 'viral_hit_canvas_apply', { projectId: id, operations: [{ type: 'upsert_card', card: { ...initial, prompt: 'Agent revised prompt' } }] });
  await page.waitForTimeout(2500);
  await page.mouse.up();
  await expect.poll(() => writes.some((body) => JSON.parse(body).command.type === 'canvas.apply')).toBe(true);
  await expect.poll(async () => (await (await request.get(`/api/app/projects/${id}/snapshot`)).json()).document.cards[0].prompt).toBe('Agent revised prompt');
  await expect.poll(async () => (await (await request.get(`/api/app/projects/${id}/snapshot`)).json()).document.frames['qa-draft'].x).not.toBe(200);
  await node.hover();
  await node.dblclick();
  await expect(page.locator('textarea').first()).toHaveValue('Agent revised prompt');
  reads.length = 0;
  await page.waitForTimeout(4500);
  expect(reads.some((url) => url.endsWith('/revision'))).toBe(true);
  expect(reads.filter((url) => url.endsWith('/snapshot'))).toHaveLength(0);
  await page.screenshot({ path: 'test-results/canvas-desktop.png' });
  await page.reload();
  await expect(node).toBeVisible();
});

test('Local image media renders and exports MP4 without a provider key', async ({ page, request }) => {
  const id = await project(request, 'Local media QA');
  const uploaded = await request.post(`/api/app/projects/${id}/assets`, {
    headers,
    multipart: { file: { name: 'demo-logo.png', mimeType: 'image/png', buffer: await readFile('public/logo.png') } },
  });
  expect(uploaded.ok()).toBe(true);
  const { asset } = await uploaded.json();
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{
    type: 'add_clip', clipId: 'local-image', assetId: asset.id, sourceUrl: asset.publicUrl,
    name: 'Local demo', sourceType: 'image', sourceDuration: 2,
  }] });
  await page.goto(`/editor/${id}`);
  await expect(page.getByText('Local demo', { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.locator('img').evaluateAll((images) => images.some((image) => image instanceof HTMLImageElement && image.src.includes('/assets/') && image.complete && image.naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: 'test-results/editor-media-desktop.png' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  const result = await download;
  expect(result.suggestedFilename()).toMatch(/\.mp4$/);
  expect((await stat((await result.path())!)).size).toBeGreaterThan(1000);
  await result.saveAs('test-results/verified-local-export.mp4');
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', 'test-results/verified-local-export.mp4'], { encoding: 'utf8' }));
  const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
  expect(video.codec_name).toBe('h264');
  expect(Number(video.nb_read_frames)).toBeGreaterThanOrEqual(48);
  expect(Number(probe.format.duration)).toBeCloseTo(2, 0);
  expect(video.width).toBeGreaterThan(0); expect(video.height).toBeGreaterThan(0);
});

test('generation run panel checks configuration and rejects malformed and untrusted requests', async ({ page, request }) => {
  const id = await project(request, 'Harness visibility QA');
  const url = `/api/app/projects/${id}/runs`;
  const state = await request.get(url); expect(state.ok()).toBe(true);
  expect((await state.json()).runs).toEqual([]);
  const agentRuns = await mcp(request, 'viral_hit_runs_list', { projectId: id });
  expect(JSON.stringify(agentRuns)).toContain('"runs":[]');
  const catalog = await mcp(request, 'viral_hit_recipes_list', {});
  expect(catalog.structuredContent.result.recipes.some((r: { id: string }) => r.id === 'community-fixture')).toBe(true);
  expect((await request.post(url, { headers, data: { action: 'recipe', recipeId: 'community-fixture', values: { prompt: 'A new frame' }, requestKey: 'community-no-key' } })).status()).toBe(503);
  expect((await request.post(url, { data: { action: 'cancel', runId: 'not-a-uuid' } })).status()).toBe(403);
  expect((await request.post(url, { headers, data: { action: 'enqueue', nodes: [] } })).status()).toBe(400);
  expect((await request.post(url, { headers, data: { action: 'cancel', runId: '00000000-0000-4000-8000-000000000000' } })).status()).toBe(404);
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await expect(page.getByText('No generations yet', { exact: true })).toBeVisible();
  await page.getByLabel('Describe your frame').fill('A paper observatory');
  // E2E deliberately runs without provider credentials; never submit paid work.
  await expect(page.getByRole('button', { name: 'Queue generation' })).toBeDisabled();
  await page.getByLabel('Creative recipe').selectOption('community-fixture');
  await expect(page.getByLabel('Community frame prompt')).toBeVisible();
  await page.getByText(/Recipe details/, { exact: false }).click();
  await expect(page.getByText(/External test author/)).toBeVisible();
  await page.getByText(/Recipe details/, { exact: false }).click();
  await page.getByLabel('Creative recipe').selectOption('editorial-triptych');
  await expect(page.getByLabel('Opening · establish the world')).toBeVisible();
  await expect(page.getByLabel('Detail · the visual idea')).toBeVisible();
  await expect(page.getByLabel('Closing · the final image')).toBeVisible();
  await page.getByLabel('Creative recipe').selectOption('remote-media-import');
  await page.getByLabel('Public HTTPS media URL').fill('https://example.org/media.png');
  await expect(page.getByRole('button', { name: 'Queue import', exact: true })).toBeEnabled();
  await page.getByLabel('Creative recipe').selectOption('open-frame');
  await page.getByLabel('Describe your frame').fill('A paper observatory');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/harness-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/harness-mobile.png' });
  await expect(page.getByRole('button', { name: 'Queue generation' })).toBeVisible();
});

test('MCP captions appear without reload and local caption edits persist through editor.apply', async ({ page, request }) => {
  const id = await project(request, 'Editor visibility QA');
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'upsert_caption', clipId: 'caption-1', text: 'Original caption', startTime: 0, duration: 4 }] });
  await page.goto(`/editor/${id}`);
  await expect(page.getByText('Original caption', { exact: true }).first()).toBeVisible();
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'upsert_caption', clipId: 'caption-1', text: 'Agent caption', startTime: 0, duration: 3 }] });
  await expect(page.getByText('Agent caption', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Agent caption 3.00s', exact: true }).click();
  const save = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/commands'));
  await page.locator('textarea').first().fill('Locally edited caption');
  const saved = await save;
  expect(saved.request().postDataJSON().command.type).toBe('editor.apply');
  expect((await saved.json()).ok).toBe(true);
  await expect.poll(async () => {
    const state = await (await request.get(`/api/app/projects/${id}/timeline`)).json();
    return state.timeline.document.tracks.flatMap((track: { clips: { text?: string }[] }) => track.clips).find((clip: { text?: string }) => clip.text === 'Locally edited caption')?.text;
  }).toBe('Locally edited caption');
  await page.screenshot({ path: 'test-results/editor-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/editor-mobile.png' });
  await expect(page.getByText('Locally edited caption', { exact: true }).first()).toBeVisible();
});

test('Studio sends asset-first validation and does not submit when provider setup is missing', async ({ page, request }) => {
  const id = await project(request, 'Studio validation QA');
  const submissions: string[] = [];
  page.on('request', (req) => { if (req.url().endsWith('/api/effects/generate')) submissions.push(req.url()); });
  await page.goto(`/studio/${id}`);
  const prompt = page.locator('textarea').first();
  await prompt.fill('A bright green geometric sculpture');
  const validation = page.waitForRequest((req) => req.url().endsWith('/api/effects/precheck'));
  await page.getByRole('button', { name: /generate/i }).last().click();
  const payload = (await validation).postDataJSON();
  expect(payload.generation.projectId).toBe(id);
  expect(payload.generation.modelId).toBeTruthy();
  expect(payload.effectId).toBeUndefined();
  await expect(page.getByText(/key|configured|connect/i).last()).toBeVisible();
  expect(submissions).toHaveLength(0);
});

test('MCP renders edited video, captions and audio to a durable project asset', async ({ request }) => {
  createDemoMedia('test-results/motion-source.mp4');
  const id = await project(request, 'Motion and audio QA');
  const uploaded = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: {
    name: 'motion.mp4', mimeType: 'video/mp4', buffer: await readFile('test-results/motion-source.mp4'),
  } } });
  expect(uploaded.ok()).toBe(true); const { asset } = await uploaded.json();
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [
    { type: 'add_clip', clipId: 'motion', assetId: asset.id, sourceUrl: asset.publicUrl, name: 'Original procedural motion', sourceType: 'video', sourceDuration: 3 },
    { type: 'split_clip', clipId: 'motion', sourceTime: 1.5, rightClipId: 'motion-tail' },
    { type: 'upsert_caption', clipId: 'title', text: 'VIRAL HIT', startTime: 0, duration: 3 },
  ] });
  const render = await mcp(request, 'viral_hit_editor_render', { projectId: id });
  const output = render.structuredContent.result.asset;
  const media = await request.get(output.publicUrl); expect(media.ok()).toBe(true);
  await writeFile('test-results/verified-motion-export.mp4', await media.body());
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', 'test-results/verified-motion-export.mp4'], { encoding: 'utf8' }));
  const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  const audio = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
  expect(video.codec_name).toBe('h264'); expect(audio.codec_name).toBe('aac');
  expect(Number(video.nb_read_frames)).toBe(90);
  expect(Number(probe.format.duration)).toBeCloseTo(3, 1);
  expect(Math.abs(Number(video.duration) - Number(audio.duration))).toBeLessThan(0.1);
  const timeline = await (await request.get(`/api/app/projects/${id}/timeline`)).json();
  expect(timeline.timeline.document.lastRenderAssetId).toBe(output.id);
});

test('a materialized run attaches to the real editor once and survives a reload', async ({ page, request }) => {
  const replacementWrites: string[] = [];
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/commands') && req.postData()?.includes('editor.replace_document')) replacementWrites.push(req.postData()!); });
  const projects = await (await request.get('/api/app/projects')).json();
  const project = projects.projects.find((p: { name: string }) => p.name === 'Materialized media E2E fixture');
  expect(project).toBeTruthy(); const id = project.id;
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await expect(page.getByText('Asset ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add to timeline', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Added to timeline', exact: true })).toBeDisabled();
  const state = await (await request.get(`/api/app/projects/${id}/runs`)).json();
  const run = state.runs[0], job = run.jobs[0];
  const repeated = await request.post(`/api/app/projects/${id}/runs`, { headers, data: { action: 'attach', runId: run.id, jobId: job.id, expectedRevision: 0 } });
  expect(repeated.ok()).toBe(true);
  const timeline = await (await request.get(`/api/app/projects/${id}/timeline`)).json();
  expect(timeline.timeline.document.tracks.flatMap((t: { clips: unknown[] }) => t.clips)).toHaveLength(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/materialized-run-desktop.png' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // The first external clip must arrive in a previously empty editor without a reload or empty autosave.
  await expect(page.getByText('Imported E2E fixture.png', { exact: true }).first()).toBeVisible();
  expect(replacementWrites).toHaveLength(0);
  await page.reload();
  await expect(page.getByText('Imported E2E fixture.png', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/materialized-editor-desktop.png' });
});
