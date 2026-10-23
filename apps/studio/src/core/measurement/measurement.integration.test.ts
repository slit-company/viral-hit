import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, mock, test } from 'node:test';

const root = await mkdtemp(join(tmpdir(), 'vh-measurement-'));
process.env.VIRAL_HIT_DATA_DIR = root;
process.env.VIRAL_HIT_PUBLISHING_CONNECTORS_DIR = join(root, 'connectors');
process.env.VIRAL_HIT_ARCHIVE_DIR = join(root, 'archive');
await cp('../../examples/publishing-connectors', process.env.VIRAL_HIT_PUBLISHING_CONNECTORS_DIR, { recursive: true });
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
const image = join(root, 'source.png');
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-frames:v', '1', image]);
after(async () => { mock.restoreAll(); await rm(root, { recursive: true, force: true }); });
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { changePublication } = await import('../publishing/application.server');
const { PublicationStore } = await import('../publishing/store.server');
const { openPublicationRuntime } = await import('../publishing/runtime.server');
const { runPublicationStep } = await import('../publishing/worker.server');
const { readPerformance, readPublicationPerformance, changePerformance, COLLECTION_INTERVAL_MS } = await import('./application.server');
const { createPerformanceHttp } = await import('../../routes/api/app/projects/-performance-http.server');

let clock = Date.now();
mock.method(Date, 'now', () => clock);
async function delivered(title: string) {
  const project = await createProject({ name: 'Performance ' + title });
  const asset = await importLocalProjectAsset({ projectId: project.id, filePath: image });
  const draft = await changePublication(project.id, { action: 'create', requestKey: randomUUID(), connector: 'ext.local-archive', accountId: 'archive', assetIds: [asset.id], metadata: { title, collection: 'campaign' } }, 'mcp');
  await changePublication(project.id, { action: 'approve', publicationId: draft.id, expectedRevision: 1, expectedDigest: draft.digest, confirmed: true }, 'ui');
  const store = new PublicationStore(join(root, 'publications/publications.sqlite'), () => clock), runtime = openPublicationRuntime();
  try {
    for (let index = 0; index < 10; index++) { clock += 120_000; const step = await runPublicationStep(store, runtime); if (!step || step.state === 'published') break; }
    const record = store.get(project.id, draft.id)!;
    assert.equal(record.state, 'published');
    return { project, draft, record, folder: join(root, 'archive', (record.receipt as { session: string }).session) };
  } finally { store.close(); runtime.close(); }
}

test('an installed connector reports versioned readings; missing numbers stay missing and repeats are throttled', async () => {
  const f = await delivered('Spring teaser');
  let view = await readPerformance(f.project.id);
  assert.deepEqual(view.metrics, ['views', 'downloads']);
  assert.deepEqual(view.items.map(item => [item.title, item.canCollect, item.latest]), [['Spring teaser', true, null]]);
  const collect = () => changePerformance(f.project.id, { action: 'collect', publicationId: f.draft.id }, 'mcp');

  const none = await collect();
  assert.equal(none.snapshot.state, 'unavailable'); assert.equal(none.snapshot.issue, 'not-found');
  assert.equal((await collect()).reused, true);
  clock += COLLECTION_INTERVAL_MS;
  await writeFile(join(f.folder, 'metrics.json'), JSON.stringify({ views: 10 }));
  const partial = await collect();
  assert.equal(partial.reused, false); assert.equal(partial.snapshot.state, 'partial');
  assert.deepEqual(partial.snapshot.metrics, { views: 10 }); assert.deepEqual(partial.snapshot.missing, ['downloads']);
  clock += COLLECTION_INTERVAL_MS;
  await writeFile(join(f.folder, 'metrics.json'), JSON.stringify({ views: 25, downloads: 4, private_value: 9 }));
  const complete = await collect();
  assert.equal(complete.snapshot.state, 'complete'); assert.deepEqual(complete.snapshot.metrics, { views: 25, downloads: 4 });
  assert.deepEqual([none, partial, complete].map(item => item.snapshot.sequence), [1, 2, 3]);

  view = await readPerformance(f.project.id);
  assert.deepEqual(view.items[0].change, { views: 15 });
  const history = await readPublicationPerformance(f.project.id, { publicationId: f.draft.id });
  assert.deepEqual(history.history.map(item => item.state), ['complete', 'partial', 'unavailable']);
  // A reading never changes the reviewed publication.
  const store = new PublicationStore(join(root, 'publications/publications.sqlite'));
  try { assert.equal(store.get(f.project.id, f.draft.id)?.digest, f.record.digest); } finally { store.close(); }
});

test('manual numbers are idempotent, bounded in time and rejected for undelivered drafts', async () => {
  const f = await delivered('Manual entry');
  const request = { action: 'record', publicationId: f.draft.id, requestKey: 'dashboard-1', metrics: { views: 120, watch_time_seconds: 900 }, observedAt: new Date(clock).toISOString(), note: 'From the platform dashboard' };
  const first = await changePerformance(f.project.id, request, 'ui');
  assert.equal(first.snapshot.source, 'manual');
  assert.equal((await changePerformance(f.project.id, request, 'cli')).snapshot.id, first.snapshot.id);
  await assert.rejects(changePerformance(f.project.id, { ...request, metrics: { views: 121 } }, 'ui'), /already used/);
  await assert.rejects(changePerformance(f.project.id, { ...request, requestKey: 'future', observedAt: new Date(clock + 3_600_000).toISOString() }, 'ui'), /not in the future/);
  await assert.rejects(changePerformance(f.project.id, { ...request, requestKey: 'bad', metrics: { Views: 1 } }, 'ui'));
  const view = await readPerformance(f.project.id);
  assert.deepEqual(view.metrics, ['views', 'watch_time_seconds', 'downloads']);

  const asset = await importLocalProjectAsset({ projectId: f.project.id, filePath: image });
  const draft = await changePublication(f.project.id, { action: 'create', requestKey: randomUUID(), connector: 'ext.local-archive', accountId: 'archive', assetIds: [asset.id], metadata: { title: 'Draft', collection: 'campaign' } }, 'mcp');
  await assert.rejects(changePerformance(f.project.id, { action: 'collect', publicationId: draft.id }, 'mcp'), /delivered/);
  await assert.rejects(changePerformance(f.project.id, { action: 'collect', publicationId: randomUUID() }, 'mcp'), /not found/);
});

test('HTTP shares the same operations and requires a trusted local request', async () => {
  const f = await delivered('Over HTTP');
  const http = createPerformanceHttp();
  const headers = { 'x-viral-hit-workspace-request': '1', origin: 'http://localhost', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const read = await http.read(f.project.id, new Request('http://localhost/api/app/projects/' + f.project.id + '/performance', { headers }));
  assert.equal(read.status, 200); assert.equal((await read.json()).items.length, 1);
  const untrusted = await http.change(f.project.id, new Request('http://localhost/x', { method: 'POST', headers: { ...headers, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: '{}' }));
  assert.equal(untrusted.status, 403);
  const bad = await http.change(f.project.id, new Request('http://localhost/x', { method: 'POST', headers, body: JSON.stringify({ action: 'collect', publicationId: 'x' }) }));
  assert.equal(bad.status, 400);
  const missing = await http.change(f.project.id, new Request('http://localhost/x', { method: 'POST', headers, body: JSON.stringify({ action: 'collect', publicationId: randomUUID() }) }));
  assert.equal(missing.status, 404);
});
