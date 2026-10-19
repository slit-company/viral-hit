import { createServer } from 'node:http';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createDemoMedia } from '../../scripts/demo-media.mjs';

const headers = { 'x-viral-hit-workspace-request': '1' };
test('recipe image inputs list this project only and preview the selected local asset', async ({ page, request }) => {
  const id = await project(request, 'Recipe input scope'), other = await project(request, 'Other input scope');
  const buffer = await readFile('public/logo.png');
  const upload = async (projectId: string, name: string) => {
    const response = await request.post(`/api/app/projects/${projectId}/assets`, { headers, multipart: { file: { name, mimeType: 'image/png', buffer } } });
    expect(response.ok()).toBe(true); return (await response.json()).asset;
  };
  const mine = await upload(id, 'my-reference.png'); await upload(other, 'other-reference.png');
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await page.getByLabel('Creative recipe').selectOption('local-image-resize');
  const selection = page.getByLabel('Source image', { exact: true });
  await expect(selection.locator('option', { hasText: 'my-reference.png' })).toHaveCount(1);
  await expect(selection.locator('option', { hasText: 'other-reference.png' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Queue generation', exact: true })).toBeDisabled();
  await selection.selectOption(mine.id);
  await expect(page.getByRole('img', { name: 'Selected Source image', exact: true })).toBeVisible();
  await expect(page.getByText('This image will be sent to your configured ComfyUI server.', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(selection).toBeVisible();
  await expect(page.getByRole('button', { name: 'Queue generation', exact: true })).toBeVisible();
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
});
test('recipe server check is read-only and reports unconfigured state consistently in HTTP, MCP and UI', async ({ page, request }) => {
  const id = await project(request, 'Read-only server check');
  const body = { recipeId: 'local-canvas', values: {} };
  expect((await request.post(`/api/app/projects/${id}/preflight`, { data: body })).status()).toBe(403);
  const response = await request.post(`/api/app/projects/${id}/preflight`, { headers, data: body });
  expect(response.ok()).toBe(true); expect((await response.json()).status).toBe('unavailable');
  const report = await mcp(request, 'viral_hit_recipe_check', { projectId: id, ...body });
  expect(report.structuredContent.result.status).toBe('unavailable');
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await page.getByLabel('Creative recipe').selectOption('local-canvas');
  await page.getByRole('button', { name: 'Check server', exact: true }).click();
  await expect(page.getByLabel('Server check result')).toContainText('Server check: unavailable');
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const dialog = await page.getByRole('dialog').boundingBox(), queue = await page.getByRole('button', { name: 'Queue generation', exact: true }).boundingBox();
    expect(queue!.y).toBeGreaterThanOrEqual(dialog!.y);
    expect(queue!.y + queue!.height).toBeLessThanOrEqual(dialog!.y + dialog!.height);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Width', { exact: true }).fill('640');
  await expect(page.getByLabel('Server check result')).toHaveCount(0);
  let finish: (() => void) | undefined;
  await page.route(`**/api/app/projects/${id}/preflight`, async route => {
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ json: { status: 'checked', checkedAt: new Date().toISOString(), connection: null, classes: [], issues: [], limits: 'Delayed fixture' } });
  });
  await page.getByRole('button', { name: 'Check server', exact: true }).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await page.getByLabel('Width', { exact: true }).fill('768');
  const replied = page.waitForResponse(`**/api/app/projects/${id}/preflight`); finish!(); await replied;
  await expect(page.getByLabel('Server check result')).toHaveCount(0);
  expect((await (await request.get(`/api/app/projects/${id}/runs`)).json()).runs).toEqual([]);
});
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
  await expect(page.getByText('No runs yet', { exact: true })).toBeVisible();
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
  await page.getByLabel('Creative recipe').selectOption('local-canvas');
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('512');
  await expect(page.getByText('Choose your ComfyUI server in Connections to run this recipe.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Queue generation' })).toBeDisabled();
  expect((await request.post(url, { headers, data: { action: 'recipe', recipeId: 'local-canvas', values: {}, requestKey: 'local-not-configured' } })).status()).toBe(503);
  await page.getByLabel('Creative recipe').selectOption('local-diffusion');
  await expect(page.getByLabel('Installed checkpoint filename')).toBeVisible();
  await page.getByLabel('Creative recipe').selectOption('open-motion');
  await page.getByLabel('Describe the action and camera').fill('A slow orbit around an original paper sculpture.');
  await page.getByLabel('Frame shape').selectOption('9:16');
  await page.getByLabel('Duration in seconds').fill('8');
  await page.getByLabel('Resolution', { exact: true }).selectOption('1080p');
  await expect(page.getByRole('button', { name: 'Queue generation' })).toBeDisabled();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/motion-recipe-desktop.png' });
  await page.getByLabel('Creative recipe').selectOption('spoken-line');
  await page.getByLabel('Text to speak').fill('This is an unsubmitted recipe form, not generated speech.');
  await page.getByLabel('ElevenLabs voice ID').fill('test-voice');
  await expect(page.getByLabel('Voice stability')).toHaveValue('0.5');
  await expect(page.getByRole('button', { name: 'Queue generation' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/speech-recipe-desktop.png' });
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

test('video and binary audio recipes attach through Runs and export a decoded movie together', async ({ page, request }) => {
  const projects = await (await request.get('/api/app/projects')).json();
  const project = projects.projects.find((p: { name: string }) => p.name === 'Multimodal E2E fixture');
  expect(project).toBeTruthy(); const id = project.id;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await expect(page.getByText('Asset ready', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Add to timeline', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Added to timeline', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Add to timeline', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Added to timeline', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('open motion.mp4', { exact: true }).first()).toBeVisible();
  await page.reload();
  const timeline = await (await request.get(`/api/app/projects/${id}/timeline`)).json();
  const tracks = timeline.timeline.document.tracks;
  expect(tracks.flatMap((t: { clips: unknown[] }) => t.clips)).toHaveLength(2);
  expect(tracks.find((t: { kind: string }) => t.kind === 'audio').clips).toHaveLength(1);
  await expect(page.getByText('open motion.mp4', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/multimodal-editor-desktop.png' });
  const render = await mcp(request, 'viral_hit_editor_render', { projectId: id });
  const output = render.structuredContent.result.asset;
  const media = await request.get(output.publicUrl); expect(media.ok()).toBe(true);
  const path = 'test-results/verified-multimodal-export.mp4'; await writeFile(path, await media.body());
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', path], { encoding: 'utf8' }));
  const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  const audio = probe.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
  expect(video.codec_name).toBe('h264'); expect(audio.codec_name).toBe('aac');
  expect(Number(video.nb_read_frames)).toBeGreaterThanOrEqual(90);
  expect(Math.abs(Number(video.duration) - Number(audio.duration))).toBeLessThan(0.1);
  execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], { stdio: 'pipe' });
});

test('Light surfaces and SEED dialog keep keyboard focus on desktop and mobile', async ({ page, request }) => {
  const id = await project(request, 'SEED component QA');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/canvas/${id}`);
  await expect(page.locator('.react-flow')).toHaveClass(/light/);
  await expect(page.locator('html')).toHaveAttribute('data-seed-color-mode', 'light-only');
  await expect(page.locator('.vh-product-shell').first()).toHaveCSS('background-color', 'rgb(252, 252, 252)');
  const trigger = page.getByRole('button', { name: 'Generation runs', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto('/projects');
  await expect(page.locator('img[src="/brand/viral-hit-wordmark.png"]').first()).toBeVisible();
  expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
});

test('a harness result replaces only a selected scene, exports its real pixels, and restores the original', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const projects = await (await request.get('/api/app/projects')).json();
  const id = projects.projects.find((p: { name: string }) => p.name === 'Take E2E fixture').id;
  const readTimeline = async () => (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline;
  const before = await readTimeline();
  const neighbor = before.document.tracks.flatMap((t: { clips: any[] }) => t.clips).find((c: { id: string }) => c.id === 'take-neighbor');
  const runs = (await (await request.get(`/api/app/projects/${id}/runs`)).json()).runs;
  const run = runs.find((r: { jobs: any[] }) => r.jobs.some(j => JSON.parse(j.input_json).label === 'Alternative lime'));
  const job = run.jobs[0], output = JSON.parse(job.output_json);
  await page.goto(`/editor/${id}`);
  await expect(page.getByText('Opening scene', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  const card = page.locator('article').filter({ hasText: run.id.slice(0, 8) });
  await card.getByRole('button', { name: 'Use as take', exact: true }).click();
  await page.getByLabel('Target clip', { exact: true }).selectOption('take-target');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/take-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const apply = page.getByRole('button', { name: 'Apply take', exact: true });
  await apply.scrollIntoViewIfNeeded();
  const modal = await page.getByRole('dialog').boundingBox(), button = await apply.boundingBox();
  expect(button!.y).toBeGreaterThanOrEqual(modal!.y); expect(button!.y + button!.height).toBeLessThanOrEqual(modal!.y + modal!.height + 1);
  const close = await page.getByRole('button', { name: 'Close', exact: true }).boundingBox();
  expect(close!.y).toBeGreaterThanOrEqual(modal!.y); expect(close!.y + close!.height).toBeLessThanOrEqual(modal!.y + modal!.height + 1);
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/take-mobile.png' });
  await apply.click();
  await expect(page.getByRole('status').filter({ hasText: 'Take applied.' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('Clip take', { exact: true })).not.toHaveValue('');
  const current = await readTimeline();
  const clips = current.document.tracks.flatMap((t: { clips: any[] }) => t.clips);
  const target = clips.find((c: { id: string }) => c.id === 'take-target');
  expect(clips).toHaveLength(2); expect(target.duration).toBe(2); expect(target.startTime).toBe(0);
  expect(target.takes[0].assetId).toBe(output.assetId);
  expect(clips.find((c: { id: string }) => c.id === 'take-neighbor')).toEqual(neighbor);
  await expect(page.locator(`img[src="${output.publicUrl}"]`).first()).toBeVisible();
  await page.reload(); await expect(page.getByLabel('Clip take', { exact: true })).toHaveValue(target.activeTakeId);
  await page.screenshot({ path: 'test-results/take-editor-mobile.png' });
  // Verify both browser and server exporters resolve the chosen source.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  await (await downloaded).saveAs('test-results/take-browser-export.mp4');
  const render = await mcp(request, 'viral_hit_editor_render', { projectId: id });
  const media = await request.get(render.structuredContent.result.asset.publicUrl);
  await writeFile('test-results/take-server-export.mp4', await media.body());
  for (const file of ['test-results/take-browser-export.mp4', 'test-results/take-server-export.mp4']) {
    const pixel = (at: string) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', at, '-i', file, '-vf', 'crop=2:2:iw/2:ih/2,scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
    const opening = pixel('0.5'), closing = pixel('2.5');
    expect(opening[1]).toBeGreaterThan(opening[0] + 40); expect(opening[1]).toBeGreaterThan(opening[2] + 100);
    expect(closing[0]).toBeGreaterThan(closing[1] + 100);
  }
  await page.getByLabel('Clip take', { exact: true }).selectOption('');
  await expect.poll(async () => (await readTimeline()).document.tracks.flatMap((t: { clips: any[] }) => t.clips).find((c: { id: string }) => c.id === 'take-target').activeTakeId).toBeNull();
  const repeat = await request.post(`/api/app/projects/${id}/runs`, { headers, data: { action: 'take', runId: run.id, jobId: job.id, clipId: 'take-target', expectedRevision: before.version } });
  expect(repeat.ok()).toBe(true);
  await page.reload(); await expect(page.getByLabel('Clip take', { exact: true })).toHaveValue('');
  const restored = await readTimeline();
  expect(restored.document.tracks.flatMap((t: { clips: any[] }) => t.clips).find((c: { id: string }) => c.id === 'take-target').takes).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('recipe library imports, reviews, exports and forks portable JSON without creating runs', async ({ page, request }) => {
  const id = await project(request, 'Recipe library QA');
  const catalog = await (await request.get('/api/app/recipes')).json();
  const original = catalog.recipes.find((r: { id: string }) => r.id === 'local-canvas');
  const manifest = { ...original, id: 'portable-test-canvas', title: 'Portable color study', author: 'Community fixture', license: 'MIT' };
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await page.getByLabel('Creative recipe').selectOption('local-canvas');
  await page.getByRole('button', { name: 'Recipe library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recipe library', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install recipe', exact: true })).toBeDisabled();
  await page.getByLabel('Import recipe file').setInputFiles({ name: 'portable.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest, null, 2)) });
  await page.getByRole('button', { name: 'Inspect JSON', exact: true }).click();
  const review = page.getByRole('region', { name: 'Recipe inspection', exact: true });
  await expect(review).toContainText('Community fixture · MIT');
  await expect(review).toContainText('Ready to install as a new local recipe.');
  await expect.poll(async () => { const r = await review.boundingBox(), a = await page.getByRole('button', { name: 'Install recipe', exact: true }).boundingBox(); return Boolean(r && a && r.y + r.height <= a.y); }).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Install recipe', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/recipe-library-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await review.scrollIntoViewIfNeeded();
  const modal = await page.getByRole('dialog').boundingBox();
  for (const name of ['Install recipe', 'Close']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(modal!.y); expect(box!.y + box!.height).toBeLessThanOrEqual(modal!.y + modal!.height + 1);
  }
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/recipe-library-mobile.png' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviewed JSON', exact: true }).click();
  const exported = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(exported).toEqual(manifest);
  expect((await (await request.get(`/api/app/projects/${id}/runs`)).json()).runs).toHaveLength(0);
  await page.getByRole('button', { name: 'Install recipe', exact: true }).click();
  await expect(page.getByLabel('Creative recipe')).toHaveValue(manifest.id);
  await expect(page.getByRole('status').filter({ hasText: 'No jobs started.' })).toBeVisible();
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('512');
  // API and MCP read the same persistent local library.
  const listed = await mcp(request, 'viral_hit_recipes_list', {});
  expect(listed.structuredContent.result.recipes.some((r: { id: string }) => r.id === manifest.id)).toBe(true);
  const inspected = await mcp(request, 'viral_hit_recipe_library', { request: { action: 'inspect', manifest: exported } });
  expect(inspected.structuredContent.result.collision).toBe('same');
  const replay = await mcp(request, 'viral_hit_recipe_library', { request: { action: 'install', manifest: exported, expectedDigest: inspected.structuredContent.result.digest } });
  expect(replay.structuredContent.result.installed).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await page.getByLabel('Creative recipe').selectOption(manifest.id);
  await page.getByRole('button', { name: 'Recipe library', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate & edit', exact: true }).click();
  const fork = JSON.parse(await page.getByLabel('Recipe JSON', { exact: true }).inputValue());
  expect(fork.id).not.toBe(manifest.id); expect(fork.author).toBe(manifest.author); expect(fork.license).toBe(manifest.license); expect(fork.nodes).toEqual(manifest.nodes);
  await page.getByRole('button', { name: 'Inspect JSON', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Install recipe', exact: true })).toBeEnabled();
  await page.getByLabel('Recipe JSON', { exact: true }).fill(JSON.stringify({ ...fork, title: 'Changed after review' }));
  await expect(page.getByRole('button', { name: 'Install recipe', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Inspect JSON', exact: true }).click();
  await page.getByRole('button', { name: 'Install recipe', exact: true }).click();
  await expect(page.getByLabel('Creative recipe')).toHaveValue(fork.id);
  const final = await (await request.get('/api/app/recipes')).json();
  expect(final.recipes.find((r: { id: string }) => r.id === 'local-canvas')).toEqual(original);
  expect(final.recipes.filter((r: { id: string }) => r.id === manifest.id)).toHaveLength(1);
  expect((await (await request.get(`/api/app/projects/${id}/runs`)).json()).runs).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('recipe library HTTP rejects untrusted, oversized and stale installation requests', async ({ request }) => {
  const manifest = (await (await request.get('/api/app/recipes')).json()).recipes[0];
  const url = '/api/app/recipes';
  expect((await request.post(url, { data: { action: 'inspect', manifest } })).status()).toBe(403);
  expect((await request.post(url, { headers: { ...headers, origin: 'https://example.org' }, data: { action: 'inspect', manifest } })).status()).toBe(403);
  expect((await request.post(url, { headers, data: { action: 'inspect', manifest: { ...manifest, description: 'x'.repeat(133_000) } } })).status()).toBe(413);
  const copy = { ...manifest, id: 'stale-library-review' };
  const report = await (await request.post(url, { headers, data: { action: 'inspect', manifest: copy } })).json();
  expect((await request.post(url, { headers, data: { action: 'install', manifest: { ...copy, title: 'Changed' }, expectedDigest: report.digest } })).status()).toBe(409);
  expect((await (await request.get(url)).json()).recipes.some((r: { id: string }) => r.id === copy.id)).toBe(false);
});

test('ComfyUI graph builder exposes image and numeric controls while preserving native connections', async ({ page, request }) => {
  const id = await project(request, 'Comfy graph builder QA');
  const graph = JSON.parse(await readFile('../../examples/comfy-api-resize.json', 'utf8'));
  const projectsRuns = async () => (await (await request.get(`/api/app/projects/${id}/runs`)).json()).runs;
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await page.getByRole('button', { name: 'Recipe library', exact: true }).click();
  await page.getByRole('button', { name: /Import ComfyUI workflow/ }).click();
  await page.getByLabel('ComfyUI API graph JSON', { exact: true }).fill('{"nodes":[],"links":[]}');
  await page.getByRole('button', { name: 'Inspect API graph', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('API-format');
  await page.getByLabel('Import ComfyUI graph file').setInputFiles({ name: 'resize-api.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(graph)) });
  await page.getByRole('button', { name: 'Inspect API graph', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build recipe for review', exact: true })).toBeDisabled();
  await page.getByLabel('Recipe name', { exact: true }).fill('Portable image workshop');
  await page.getByLabel('Recipe ID', { exact: true }).fill('builder-image-workshop');
  await page.getByLabel('Source author', { exact: true }).fill('Viral Hit');
  await page.getByLabel('Source license', { exact: true }).fill('Apache-2.0');
  await page.getByLabel('Recipe description', { exact: true }).fill('A user-authored resize workflow with preserved alpha.');
  await page.getByLabel('Inspect node', { exact: true }).selectOption('1');
  await page.getByLabel('Expose #1 image', { exact: true }).check();
  await page.getByLabel('Control label for #1 image', { exact: true }).fill('Source image');
  await page.getByLabel('Control ID for #1 image', { exact: true }).fill('source');
  await page.getByLabel('Control type for #1 image', { exact: true }).selectOption('asset');
  await page.getByLabel('Inspect node', { exact: true }).selectOption('2');
  await expect(page.getByLabel('Expose #2 image', { exact: true })).toBeDisabled();
  for (const name of ['width', 'height']) {
    await page.getByLabel(`Expose #2 ${name}`, { exact: true }).check();
    await page.getByLabel(`Control ID for #2 ${name}`, { exact: true }).fill(name);
    await page.getByLabel(`Control label for #2 ${name}`, { exact: true }).fill(name === 'width' ? 'Width' : 'Height');
    await page.getByLabel(`min for #2 ${name}`, { exact: true }).fill('64');
    await page.getByLabel(`max for #2 ${name}`, { exact: true }).fill('4096');
  }
  await page.getByLabel('Expose #2 upscale_method', { exact: true }).check();
  await page.getByLabel('Control ID for #2 upscale_method', { exact: true }).fill('method');
  await page.getByLabel('Control label for #2 upscale_method', { exact: true }).fill('Resize method');
  await page.getByLabel('Control type for #2 upscale_method', { exact: true }).selectOption('enum');
  await page.getByLabel('Choices for #2 upscale_method', { exact: true }).fill('lanczos\nnearest-exact');
  await page.getByLabel('Output node', { exact: true }).selectOption('3');
  await page.getByLabel('Output array', { exact: true }).selectOption('images');
  await page.getByLabel('Media kind', { exact: true }).selectOption('image');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Output node', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/graph-builder-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const build = page.getByRole('button', { name: 'Build recipe for review', exact: true });
  await page.getByLabel('Output node', { exact: true }).scrollIntoViewIfNeeded();
  const modal = await page.getByRole('dialog').boundingBox();
  for (const action of [build, page.getByRole('button', { name: 'Close', exact: true })]) {
    const box = await action.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(modal!.y); expect(box!.y + box!.height).toBeLessThanOrEqual(modal!.y + modal!.height + 1);
  }
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/graph-builder-mobile.png' });
  expect(await projectsRuns()).toHaveLength(0);
  await build.click();
  const review = page.getByRole('region', { name: 'Recipe inspection', exact: true });
  await expect(review).toContainText('3 steps · 4 inputs');
  await expect(review).toContainText('Viral Hit · Apache-2.0');
  const converted = JSON.parse(await page.getByLabel('Recipe JSON', { exact: true }).inputValue());
  expect(converted.nodes.find((node: { operation: string }) => node.operation === 'comfy.workflow').input.workflow).toEqual(graph);
  expect(converted.parameters.find((parameter: { id: string }) => parameter.id === 'source').default).toBeUndefined();
  expect((await (await request.get('/api/app/recipes')).json()).recipes.some((r: { id: string }) => r.id === converted.id)).toBe(false);
  await page.screenshot({ path: 'test-results/graph-builder-review-mobile.png' });
  await page.getByRole('button', { name: 'Install recipe', exact: true }).click();
  await expect(page.getByLabel('Creative recipe')).toHaveValue(converted.id);
  await expect(page.getByLabel('Source image', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Resize method', { exact: true })).toHaveValue('lanczos');
  expect(await projectsRuns()).toHaveLength(0);
  // MCP invokes the same converter; it does not silently install the second ID.
  const inspected = await mcp(request, 'viral_hit_recipe_library', { request: { action: 'inspect_graph', graph } });
  const definition = JSON.parse(await readFile('../../examples/comfy-resize-definition.json', 'utf8')); definition.id = 'mcp-built-not-installed';
  const built = await mcp(request, 'viral_hit_recipe_library', { request: { action: 'convert_graph', graph, definition, expectedGraphDigest: inspected.structuredContent.result.graphDigest } });
  expect(built.structuredContent.result.recipe.id).toBe(definition.id);
  expect((await (await request.get('/api/app/recipes')).json()).recipes.some((r: { id: string }) => r.id === definition.id)).toBe(false);
});


test('workspace ComfyUI connections persist across UI and MCP, reject stale saves and start no jobs', async ({ page, request }) => {
  const seen: string[] = [];
  const native = createServer((req, res) => { seen.push(`${req.method} ${req.url}`); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ system: { comfyui_version: 'test-server' }, devices: [{ type: 'cpu' }] })); });
  await new Promise<void>(resolve => native.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(native.address() as { port: number }).port}/`;
  const endpoint = '/api/app/comfy-connection';
  try {
    const initial = await (await request.get(endpoint)).json();
    expect(initial.source).toBe('none');
    expect((await request.post(endpoint, { data: { action: 'save', url, expectedRevision: initial.revision } })).status()).toBe(403);
    expect((await request.post(endpoint, { headers: { ...headers, origin: 'https://untrusted.example' }, data: { action: 'save', url, expectedRevision: initial.revision } })).status()).toBe(403);
    expect((await request.post(endpoint, { headers, data: { action: 'check', url: 'file:///tmp/private' } })).status()).toBe(400);
    expect((await request.post(endpoint, { headers, data: { action: 'save', url: 'x'.repeat(5000), expectedRevision: 0 } })).status()).toBe(413);
    const id = await project(request, 'Workspace connection QA');
    await page.goto(`/editor/${id}`);
    await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
    await page.getByLabel('Creative recipe').selectOption('local-canvas');
    await expect(page.getByRole('button', { name: 'Queue generation', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    const field = page.getByLabel('ComfyUI server URL', { exact: true });
    await expect(field).toBeEnabled(); await field.fill(url);
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect(page.getByText('Server responded', { exact: true })).toBeVisible();
    expect((await (await request.get(endpoint)).json()).source).toBe('none');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'test-results/connections-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const modal = page.getByRole('dialog'), save = page.getByRole('button', { name: 'Save connection', exact: true });
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect(page.getByText('Server responded', { exact: true })).toBeVisible();
    await expect(save).toBeEnabled();
    const feedback = await page.getByRole('region', { name: 'Connection feedback' }).boundingBox();
    const action = await save.boundingBox();
    expect(feedback!.y + feedback!.height).toBeLessThanOrEqual(action!.y);
    const m = await modal.boundingBox(), b = await save.boundingBox(), close = await page.getByRole('button', { name: 'Close', exact: true }).boundingBox();
    expect(b!.y + b!.height).toBeLessThanOrEqual(m!.y + m!.height); expect(b!.x).toBeGreaterThanOrEqual(m!.x);
    expect(close!.y).toBeGreaterThanOrEqual(m!.y); expect(close!.x + close!.width).toBeLessThanOrEqual(m!.x + m!.width);
    expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/connections-mobile.png' });
    await save.click(); await expect(page.getByText('Connection saved for this workspace. No jobs started.', { exact: true })).toBeVisible();
    const remote = await mcp(request, 'viral_hit_comfy_connection', { request: { action: 'read' } });
    expect(remote.structuredContent.result.url).toBe(url);
    const changed = await mcp(request, 'viral_hit_comfy_connection', { request: { action: 'save', url: `${url}other/`, expectedRevision: remote.structuredContent.result.revision } });
    await field.fill(`${url}stale/`); await save.click();
    await expect(page.getByRole('alert')).toContainText('Connection settings changed');
    expect((await (await request.get(endpoint)).json()).url).toBe(changed.structuredContent.result.url);
    await page.getByRole('button', { name: 'Reload settings', exact: true }).click(); await expect(field).toHaveValue(`${url}other/`);
    await field.fill(url); await save.click(); await expect(page.getByText('Connection saved for this workspace. No jobs started.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to runs', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Queue generation', exact: true })).toBeEnabled();
    expect((await (await request.get(`/api/app/projects/${id}/runs`)).json()).runs).toEqual([]);
    await page.getByRole('button', { name: 'Connections', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect server', exact: true }).click();
    await expect(page.getByText('Workspace connection disconnected. Existing jobs and assets are retained.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to runs', exact: true }).click(); await expect(page.getByRole('button', { name: 'Queue generation', exact: true })).toBeDisabled();
    expect(seen).toEqual(['GET /system_stats', 'GET /system_stats']);
  } finally {
    const current = await (await request.get(endpoint)).json();
    if (current.editable && current.url) await request.post(endpoint, { headers, data: { action: 'save', url: null, expectedRevision: current.revision } });
    native.closeAllConnections(); await new Promise<void>(resolve => native.close(() => resolve()));
  }
});

test('an interrupted conflict rebase recovers its local draft after reopening and preserves disjoint server edits', async ({ page, request, context }) => {
  const id = await project(request, 'Draft recovery QA');
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'upsert_caption', clipId: 'draft-caption', text: 'Before interruption', startTime: 0, duration: 3 }] });
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Before interruption 3.00s', exact: true }).click();
  // Freeze network observation while a concurrent editor advances the saved revision.
  await page.route(`**/api/app/projects/${id}/timeline`, route => route.request().method() === 'GET' ? route.abort('failed') : route.continue());
  const conflict = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/commands') && response.status() === 409);
  await page.locator('textarea').first().fill('Recovered local caption');
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'upsert_caption', clipId: 'remote-caption', text: 'Concurrent remote caption', startTime: 3, duration: 2 }] });
  await conflict;
  const draftKey = `viral-hit:timeline-draft:v1:${id}:`;
  await expect.poll(() => page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)).length, draftKey)).toBe(1);
  await page.close(); // No beforeunload promise can finish a rebase after a tab/process is gone.
  const reopened = await context.newPage();
  await reopened.goto(`/editor/${id}`);
  await expect(reopened.getByRole('heading', { name: 'Local timeline drafts', exact: true })).toBeVisible();
  const before = (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline;
  expect(before.document.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === 'draft-caption').text).toBe('Before interruption');
  await reopened.setViewportSize({ width: 1440, height: 1000 }); await reopened.screenshot({ path: 'test-results/recovery-desktop.png' });
  await reopened.setViewportSize({ width: 390, height: 844 });
  const modal = await reopened.getByRole('dialog').boundingBox(), restore = await reopened.getByRole('button', { name: 'Restore draft', exact: true }).boundingBox();
  expect(restore!.y + restore!.height).toBeLessThanOrEqual(modal!.y + modal!.height);
  expect(await reopened.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
  await reopened.screenshot({ path: 'test-results/recovery-mobile.png' });
  await reopened.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect.poll(async () => {
    const timeline = (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline;
    return timeline.document.tracks.flatMap((t: any) => t.clips).map((c: any) => c.text);
  }).toEqual(['Recovered local caption', 'Concurrent remote caption']);
  await expect.poll(() => reopened.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)).length, draftKey)).toBe(0);
  await reopened.setViewportSize({ width: 1440, height: 1000 });
  await reopened.getByRole('button', { name: 'Undo edit', exact: true }).first().click();
  await expect.poll(async () => (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline.document.tracks.flatMap((t: any) => t.clips).map((c: any) => c.text)).toEqual(['Before interruption', 'Concurrent remote caption']);
  await reopened.getByRole('button', { name: 'Redo edit', exact: true }).first().click();
  await expect.poll(async () => (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline.document.tracks.flatMap((t: any) => t.clips).map((c: any) => c.text)).toEqual(['Recovered local caption', 'Concurrent remote caption']);
  await expect.poll(() => reopened.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)).length, draftKey)).toBe(0);
  await reopened.reload(); await expect(reopened.getByRole('dialog')).toHaveCount(0);
  await expect(reopened.getByText('Recovered local caption', { exact: true }).first()).toBeVisible(); await reopened.close();
});

test('conflicting draft recovery preserves both versions and exports the exact pending snapshot', async ({ page, request, context }) => {
  const id = await project(request, 'Draft conflict QA');
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'upsert_caption', clipId: 'conflict-caption', text: 'Shared base', startTime: 0, duration: 3 }] });
  await page.goto(`/editor/${id}`); await page.getByRole('button', { name: 'Shared base 3.00s', exact: true }).click();
  await page.route('**/commands', route => route.abort('failed'));
  await page.locator('textarea').first().fill('My unsaved version');
  const draftKey = `viral-hit:timeline-draft:v1:${id}:`;
  await expect.poll(() => page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)).length, draftKey)).toBe(1);
  const raw = await page.evaluate(prefix => localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith(prefix))!)!, draftKey);
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'upsert_caption', clipId: 'conflict-caption', text: 'Saved remote version', startTime: 0, duration: 3 }] });
  await page.close(); const reopened = await context.newPage();
  await reopened.goto(`/editor/${id}`); await reopened.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(reopened.getByRole('alert')).toContainText('Nothing was overwritten');
  const timeline = (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline;
  expect(timeline.document.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === 'conflict-caption').text).toBe('Saved remote version');
  const pending = reopened.waitForEvent('download'); await reopened.getByRole('button', { name: 'Download draft JSON', exact: true }).click();
  const downloaded = await pending; await downloaded.saveAs('test-results/conflicting-draft.json');
  expect(await readFile('test-results/conflicting-draft.json', 'utf8')).toBe(raw);
  await reopened.setViewportSize({ width: 390, height: 844 }); await reopened.getByRole('alert').scrollIntoViewIfNeeded();
  await reopened.screenshot({ path: 'test-results/recovery-conflict-mobile.png' });
  await reopened.getByRole('button', { name: 'Delete this draft', exact: true }).click();
  await expect(reopened.getByText('No recoverable drafts in this browser.', { exact: true })).toBeVisible();
  await reopened.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(reopened.getByText('Saved remote version', { exact: true }).first()).toBeVisible(); await reopened.close();
});

test('a newer edit is saved after a slow acknowledgement without another user action', async ({ page, request }) => {
  const id = await project(request, 'Save drain QA');
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'upsert_caption', clipId: 'slow-caption', text: 'Original', startTime: 0, duration: 3 }] });
  await page.goto(`/editor/${id}`); await page.getByRole('button', { name: 'Original 3.00s', exact: true }).click();
  let release: (() => void) | undefined, captured = false;
  await page.route('**/commands', async route => {
    if (captured) { await route.continue(); return; } captured = true;
    const response = await route.fetch();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ response });
  });
  await page.locator('textarea').first().fill('First saved snapshot');
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.locator('textarea').first().fill('Newer edit while saving');
  await page.waitForTimeout(850); release!();
  await expect.poll(async () => (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline.document.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === 'slow-caption').text).toBe('Newer edit while saving');
  await expect.poll(() => page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)).length, `viral-hit:timeline-draft:v1:${id}:`)).toBe(0);
});

test('edits made during conflict recovery do not silently overwrite a concurrent saved field', async ({ page, request }) => {
  const id = await project(request, 'In-flight merge QA');
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [
    { type: 'upsert_caption', clipId: 'caption-a', text: 'Base A', startTime: 0, duration: 3 },
    { type: 'upsert_caption', clipId: 'caption-b', text: 'Base B', startTime: 3, duration: 3 },
  ] });
  await page.goto(`/editor/${id}`); await page.getByRole('button', { name: 'Base A 3.00s', exact: true }).click();
  let calls = 0, release: (() => void) | undefined;
  await page.route('**/commands', async route => {
    calls++;
    if (calls === 1) {
      await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'upsert_caption', clipId: 'caption-b', text: 'Remote B', startTime: 3, duration: 3 }] });
      await route.continue(); return;
    }
    if (calls === 2) {
      const response = await route.fetch();
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ response }); return;
    }
    await route.continue();
  });
  await page.locator('textarea').first().fill('Local A');
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('button', { name: 'Base B 3.00s', exact: true }).click();
  await page.locator('textarea').first().fill('New local B');
  await page.waitForTimeout(850); release!();
  await expect(page.getByText(/Concurrent edits overlap/)).toBeVisible();
  const timeline = (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline;
  expect(timeline.document.tracks.flatMap((t: any) => t.clips).map((c: any) => c.text)).toEqual(['Local A', 'Remote B']);
  expect(calls).toBe(2);
  await expect(page.locator('textarea').first()).toHaveValue('New local B');
  const draft = await page.evaluate(prefix => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith(prefix))!)!), `viral-hit:timeline-draft:v1:${id}:`);
  expect(draft.document.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === 'caption-b').text).toBe('New local B');
});

test('installed external adapter is discovered through UI and MCP and queues a pinned plan', async ({ page, request }) => {
  const id = await project(request, 'External adapter UI QA');
  const catalog = await (await request.get('/api/app/recipes')).json();
  const capability = catalog.capabilities.find((c: any) => c.operation === 'ext.example-tone');
  expect(capability).toMatchObject({ configured: true, external: true, version: '1', generation: false, author: 'Viral Hit contributors', license: 'Apache-2.0' });
  const discovered = await mcp(request, 'viral_hit_recipes_list', {});
  expect(discovered.structuredContent.result.capabilities).toContainEqual(capability);
  const unknown = await request.post(`/api/app/projects/${id}/runs`, { headers, data: { action: 'enqueue', requestKey: 'unknown-external', nodes: [{ id: 'unknown', operation: 'ext.not-installed', version: '1', input: {} }] } });
  expect(unknown.status()).toBe(503);
  const invalid = await request.post(`/api/app/projects/${id}/runs`, { headers, data: { action: 'enqueue', requestKey: 'invalid-external', nodes: [{ id: 'tone', operation: 'ext.example-tone', version: '1', input: { frequency: 440, duration: 100 } }] } });
  expect(invalid.ok()).toBe(false); expect((await invalid.json()).error).toContain('Invalid ext.example-tone input');
  await page.goto(`/editor/${id}`); await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await page.getByLabel('Creative recipe').selectOption('procedural-tone');
  await page.getByLabel('Frequency (Hz)', { exact: true }).fill('660');
  await page.getByLabel('Duration (seconds)', { exact: true }).fill('1.5');
  await expect(page.getByText('Uses installed adapters:', { exact: false })).toContainText('Procedural tone example v1');
  await expect(page.getByText('Uses your Comfy credits.', { exact: false })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: 'test-results/external-adapter-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const queue = page.getByRole('button', { name: 'Queue workflow', exact: true });
  await queue.scrollIntoViewIfNeeded();
  const modal = await page.getByRole('dialog').boundingBox(), action = await queue.boundingBox();
  expect(action!.y + action!.height).toBeLessThanOrEqual(modal!.y + modal!.height);
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/external-adapter-mobile.png' });
  await queue.click();
  await expect.poll(async () => (await (await request.get(`/api/app/projects/${id}/runs`)).json()).runs.length).toBe(1);
  const run = (await (await request.get(`/api/app/projects/${id}/runs`)).json()).runs[0];
  const input = JSON.parse(run.jobs.find((job: any) => job.operation === 'ext.example-tone').input_json);
  expect(input.payload).toEqual({ frequency: 660, duration: 1.5 }); expect(input.adapter.digest).toMatch(/^[a-f0-9]{64}$/);
  const same = await mcp(request, 'viral_hit_runs_list', { projectId: id });
  expect(same.structuredContent.result.runs[0].id).toBe(run.id);
});

test('external media recipes preview only eligible project audio and pin UI and MCP requests', async ({ page, request }) => {
  const id = await project(request, 'Audio processor inputs'), foreign = await project(request, 'Other audio inputs');
  const buffer = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'wav', 'pipe:1']);
  const upload = async (target: string, name: string) => {
    const response = await request.post(`/api/app/projects/${target}/assets`, { headers, multipart: { file: { name, mimeType: 'audio/wav', buffer } } });
    expect(response.ok()).toBe(true); return (await response.json()).asset;
  };
  const mine = await upload(id, 'my-audio.wav'), other = await upload(foreign, 'foreign-audio.wav');
  await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name: 'image.png', mimeType: 'image/png', buffer: await readFile('public/logo.png') } } });
  const denied = await request.post(`/api/app/projects/${id}/runs`, { headers, data: { action: 'recipe', recipeId: 'audio-gain', values: { source: other.id }, requestKey: 'foreign-input' } });
  expect(denied.ok()).toBe(false);
  await page.goto(`/editor/${id}`); await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await page.getByLabel('Creative recipe').selectOption('audio-gain');
  const selection = page.getByLabel('Source audio', { exact: true }), queue = page.getByRole('button', { name: 'Queue workflow', exact: true });
  await expect(queue).toBeDisabled();
  await expect(selection.locator('option')).toHaveCount(2);
  await expect(selection).not.toContainText('foreign-audio.wav'); await expect(selection).not.toContainText('image.png');
  await selection.selectOption(mine.id);
  const preview = page.locator('audio[aria-label="Selected Source audio"]');
  await expect(preview).toBeVisible(); await expect.poll(() => preview.evaluate((e: HTMLAudioElement) => e.readyState)).toBeGreaterThanOrEqual(1);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height }); await selection.scrollIntoViewIfNeeded();
    await expect(preview).toBeVisible(); expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/audio-input-${name}.png` });
    await queue.scrollIntoViewIfNeeded(); const modal = await page.getByRole('dialog').boundingBox(), box = await queue.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(modal!.y + modal!.height);
  }
  await queue.click();
  await expect.poll(async () => (await (await request.get(`/api/app/projects/${id}/runs`)).json()).runs.length).toBe(1);
  const result = await mcp(request, 'viral_hit_runs_list', { projectId: id });
  const run = result.structuredContent.result.runs[0], input = JSON.parse(run.jobs.find((job: any) => job.operation === 'ext.audio-gain').input_json);
  expect(input.assetPins.source).toMatchObject({ projectId: id, assetId: mine.id, kind: 'audio', sizeBytes: buffer.length });
  expect(input.assetPins.source.sha256).toMatch(/^[a-f0-9]{64}$/);
});

test('portable video asset parameters render a playable preview without enabling an absent runtime', async ({ page, request }) => {
  const id = await project(request, 'Video input preview');
  createDemoMedia('test-results/video-selection.mp4');
  const uploaded = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name: 'source-video.mp4', mimeType: 'video/mp4', buffer: await readFile('test-results/video-selection.mp4') } } });
  expect(uploaded.ok()).toBe(true); const asset = (await uploaded.json()).asset;
  const manifest = JSON.parse(await readFile('../../examples/adapter-recipes/audio-gain.json', 'utf8'));
  manifest.id = 'video-preview'; manifest.title = 'Video input preview'; manifest.parameters[0].kind = 'video'; manifest.parameters[0].label = 'Source video'; manifest.nodes[0].operation = 'ext.uninstalled-video';
  const inspect = await request.post('/api/app/recipes', { headers, data: { action: 'inspect', manifest } });
  expect(inspect.ok()).toBe(true); const report = await inspect.json();
  const install = await request.post('/api/app/recipes', { headers, data: { action: 'install', manifest, expectedDigest: report.digest } }); expect(install.ok()).toBe(true);
  await page.goto(`/editor/${id}`); await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await page.getByLabel('Creative recipe').selectOption('video-preview'); await page.getByLabel('Source video', { exact: true }).selectOption(asset.id);
  const video = page.locator('video[aria-label="Selected Source video"]'); await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Queue generation', exact: true })).toBeDisabled();
});
