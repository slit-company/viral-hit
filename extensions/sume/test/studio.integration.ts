import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'vh-sume-studio-'));
process.env.VIRAL_HIT_DATA_DIR = root;
for (const key of ['SUME_API_KEY', 'VIRAL_HIT_PROVIDERS_DIR', 'VIRAL_HIT_RUNTIME_PACKAGES_DIR', 'VIRAL_HIT_HARNESS_DB']) delete process.env[key];
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); });
const { installGenerationProviders } = await import('../../../apps/studio/src/core/generation-providers/installed/install.server');
assert.deepEqual(installGenerationProviders(resolve('../../extensions/sume/dist/providers')).problems, []);
const { changeProviderConnection, providerConnections } = await import('../../../apps/studio/src/core/generation-providers/installed/connections.server');
const { createProject } = await import('../../../apps/studio/src/core/projects/projects');
const { importLocalProjectAsset } = await import('../../../apps/studio/src/core/projects/import-local-asset');
const { submitAssetFirstGeneration } = await import('../../../apps/studio/src/core/generation-providers/submit');
const { listProjectGenerations } = await import('../../../apps/studio/src/core/effects/project-generations');
const { getProjectAssetById } = await import('../../../apps/studio/src/core/workspace-lib/assets/user-assets');
const { persistViralHitCommand } = await import('../../../apps/studio/src/core/commands/persist');
const { loadProjectTimeline } = await import('../../../apps/studio/src/core/editor/timeline-state');
const { renderProjectTimelineToAsset } = await import('../../../apps/studio/src/core/editor/render-project-timeline');
const { resolveLocalProjectAssetPath } = await import('../../../apps/studio/src/core/projects/local-project-assets');

test('Sume transport fixture: owned upload → durable async generation → local asset → editable timeline → actual MP4', { timeout: 90000 }, async () => {
  const image = join(root, 'fixture.png');
  execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=180x320', '-frames:v', '1', image]);
  const bytes = await readFile(image), job = 'job_studio_fixture'; let submissions = 0, uploads = 0;
  globalThis.fetch = async (url, options) => {
    const target = String(url), headers = new Headers(options?.headers);
    if (target.startsWith('https://api.sume.com/')) {
      assert.equal(headers.get('authorization'), 'Bearer fixture-only-key');
      const json = (data: unknown, status = 200) => Response.json({ data }, { status });
      if (target.endsWith('/open/balance')) return json({ balance: 0 });
      if (target.endsWith('/models/gpt-image-2')) return json({ model: { id: 'gpt-image-2', capabilities: { image_edit: true, aspect_ratios: ['9:16'], qualities: ['medium'] } } });
      if (target.endsWith('/generate-upload-url')) return json({ public_url: 'https://media.sume.com/source.png', upload_url: 'https://fixture.r2.cloudflarestorage.com/input', upload_method: 'PUT', upload_headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
      if (target.endsWith('/image-router/generate')) { submissions++; assert.match(headers.get('idempotency-key')!, /^vh-[a-f0-9]{64}$/); assert.deepEqual(JSON.parse(String(options?.body)).image_urls, ['https://media.sume.com/source.png']); return json({ job: { id: job }, usage: { credits: 12, usd: '0.10' } }, 202); }
      if (target.endsWith('/status')) return json({ status: 'COMPLETED', result_ready: true });
      if (target.endsWith('/result')) return json({ job: { usage_summary: { status: 'captured', final: true, reserved_credits: 12, captured_credits: 12, refunded_credits: 0 } }, result: { artifacts: [{ type: 'image', content_type: 'image/png', url: 'https://media.sume.com/output.png' }] } });
      throw Error('Unexpected fixture API path');
    }
    if (target.includes('fixture.r2.cloudflarestorage.com')) { uploads++; assert.equal(headers.has('authorization'), false); assert.deepEqual(Buffer.from(options?.body as Uint8Array), bytes); return new Response(null); }
    if (target === 'https://media.sume.com/output.png') { assert.equal(headers.has('authorization'), false); return new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } }); }
    return originalFetch(url, options);
  };
  const connection = providerConnections().find(item => item.id === 'sume')!;
  await changeProviderConnection({ action: 'save', providerId: 'sume', revision: connection.revision, values: { SUME_API_KEY: 'fixture-only-key' } });
  assert.equal((await changeProviderConnection({ action: 'test', providerId: 'sume', revision: providerConnections()[0].revision }) as { ok: boolean }).ok, true);
  const project = await createProject({ name: 'Sume protocol fixture, not AI quality evidence' });
  const source = await importLocalProjectAsset({ projectId: project.id, filePath: image });
  const submitted = await submitAssetFirstGeneration({ origin: 'ui', generation: { version: 2, projectId: project.id, modelId: 'sume-gpt-image-2', mode: 'image', prompt: 'Transport fixture', references: [{ assetId: source.id, role: 'reference' }], parameters: { aspect_ratio: '9:16' } } });
  assert.equal(submitted.body.status, 'processing', JSON.stringify(submitted.body));
  let generation;
  for (let i = 0; i < 60; i++) { [generation] = await listProjectGenerations(project.id); if (['succeeded', 'failed'].includes(generation.status)) break; await new Promise(done => setTimeout(done, 1000)); }
  assert.equal(generation?.status, 'succeeded', JSON.stringify(generation));
  assert.equal(submissions, 1); assert.equal(uploads, 1);
  const { getGenerationById } = await import('../../../apps/studio/src/core/effects/record-generation');
  const receipt = await getGenerationById({ id: generation!.id });
  assert.deepEqual((receipt!.output as Record<string, unknown>).providerCost, { state: 'captured', final: true, unit: 'credits', reserved: 12, captured: 12, refunded: 0 });
  const output = await getProjectAssetById({ projectId: project.id, assetId: generation!.resultUrl!.split('/').at(-1)! }); assert.ok(output);
  assert.deepEqual(await readFile(resolveLocalProjectAssetPath({ objectKey: output.objectKey })), bytes);
  await persistViralHitCommand({ projectId: project.id, origin: 'ui', commandId: 'sume-fixture-edit', expectedRevision: 0, command: { type: 'editor.apply', operations: [{ type: 'add_clip', clipId: 'sume-result', sourceType: 'image', sourceUrl: '', assetId: output.id, sourceDuration: 1, name: 'Generated fixture' }] } });
  const timeline = (await loadProjectTimeline(project.id))!;
  const rendered = await renderProjectTimelineToAsset({ projectId: project.id, document: timeline.document, timelineRevision: timeline.version });
  const file = rendered.localPath;
  const probe = JSON.parse(execFileSync(process.env.VIRAL_HIT_FFPROBE || 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }));
  assert.equal(probe.streams[0].codec_type, 'video'); assert.ok(Number(probe.streams[0].duration) >= 1);
});
