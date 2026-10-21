import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const root = await mkdtemp(join(tmpdir(), 'vh-publication-extensions-'));
process.env.VIRAL_HIT_DATA_DIR = root;
process.env.VIRAL_HIT_PUBLISHING_CONNECTORS_DIR = join(root, 'connectors');
process.env.VIRAL_HIT_ARCHIVE_DIR = join(root, 'archive');
await cp('../../examples/publishing-connectors', process.env.VIRAL_HIT_PUBLISHING_CONNECTORS_DIR, { recursive: true });
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
const image = join(root, 'source.png'), audio = join(root, 'source.wav');
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=64x64:d=1', '-frames:v', '1', image]);
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.1', audio]);
after(async () => { await rm(root, { recursive: true, force: true }); });
const { createProject } = await import('../../projects/projects');
const { importLocalProjectAsset } = await import('../../projects/import-local-asset');
const { changePublication, listPublications } = await import('../application.server');
const { openPublications } = await import('../publication-files.server');
const { PublicationStore } = await import('../store.server');
const { openPublicationRuntime } = await import('../runtime.server');
const { runPublicationStep } = await import('../worker.server');
const { installedConnectorCatalog, readConnectorFolder } = await import('./catalog.server');
const { publicationPreview } = await import('../../../routes/api/app/publishing/-preview-http.server');
const modulePath = join(root, 'connectors/local-archive/connector.mjs');
const source = await readFile(modulePath, 'utf8');

async function fixture() {
  const project = await createProject({ name: 'Independent publishing connector' });
  const assets = await Promise.all([image, audio].map(filePath => importLocalProjectAsset({ projectId: project.id, filePath })));
  const request = { action: 'create', requestKey: randomUUID(), connector: 'ext.local-archive', accountId: 'archive', assetIds: assets.map(asset => asset.id), metadata: { title: 'Release set', collection: 'portfolio' } };
  const draft = await changePublication(project.id, request, 'mcp');
  return { project, assets, request, draft };
}
const approve = (f: Awaited<ReturnType<typeof fixture>>) => changePublication(f.project.id, { action: 'approve', publicationId: f.draft.id, expectedRevision: 1, expectedDigest: f.draft.digest, confirmed: true }, 'ui');
function worker() {
  let now = Date.now();
  const store = new PublicationStore(join(root, 'publications/publications.sqlite'), () => now), runtime = openPublicationRuntime();
  return { store, runtime, step: () => { now += 120_000; return runPublicationStep(store, runtime); }, close: () => { store.close(); runtime.close(); } };
}

test('installed connectors expose safe general/specialized metadata without executing modules', async () => {
  const folder = join(root, 'connectors/brand-archive'); await mkdir(folder);
  const manifest = JSON.parse(await readFile(join(root, 'connectors/local-archive/connector.json'), 'utf8'));
  await writeFile(join(folder, 'connector.json'), JSON.stringify({ ...manifest, id: 'ext.brand-archive', scope: 'specialized', destinations: [{ id: 'team', destinationId: 'team-releases', label: 'Team', configuration: { privateValue: 'never-in-catalog' } }] }));
  await writeFile(join(folder, 'connector.mjs'), 'throw new Error("Discovery must never execute this module");');
  const catalog = installedConnectorCatalog();
  assert.deepEqual(catalog.connectors.map(item => [item.id, item.scope]), [['ext.brand-archive', 'specialized'], ['ext.local-archive', 'general']]);
  assert.equal(JSON.stringify(catalog).includes('never-in-catalog'), false); assert.equal(JSON.stringify(catalog).includes(process.env.VIRAL_HIT_ARCHIVE_DIR!), false);
  assert.equal(catalog.connectors[0].configured, true);
  await rm(folder, { recursive: true });
  await mkdir(join(root, 'connectors/broken')); await writeFile(join(root, 'connectors/broken/connector.json'), '{}');
  assert.deepEqual(installedConnectorCatalog().problems.map(item => item.location), ['broken']);
  await rm(join(root, 'connectors/broken'), { recursive: true });
});

test('shared application admits ordered image/audio assets, keeps exact previews, requires review and delivers once through the real worker', async () => {
  const f = await fixture(), w = worker();
  try {
    assert.equal(f.draft.state, 'draft'); assert.equal(f.draft.external?.available, true); assert.equal(f.draft.external?.assets.length, 2);
    assert.equal(await w.step(), null);
    await assert.rejects(changePublication(f.project.id, { ...f.request, requestKey: randomUUID(), metadata: { title: 'Wrong', collection: 'invalid' } }, 'ui'), /metadata required/);
    const foreign = await createProject({ name: 'Other project' });
    await assert.rejects(changePublication(foreign.id, f.request, 'mcp'), /local media/);
    for (const [index, path] of [image, audio].entries()) {
      const response = await publicationPreview(f.project.id, f.draft.id, new Request('http://localhost/api/media?digest=' + f.draft.digest + '&asset=' + index));
      assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path));
    }
    const invalid = await publicationPreview(f.project.id, f.draft.id, new Request('http://localhost/api/media?digest=' + f.draft.digest + '&asset=2'));
    assert.equal(invalid.status, 400);
    await assert.rejects(changePublication(f.project.id, { action: 'approve', publicationId: f.draft.id, expectedRevision: 1, expectedDigest: '0'.repeat(64), confirmed: true }, 'ui'));
    await approve(f);
    const states = [];
    for (let index = 0; index < 10; index++) {
      const result = await w.step(); if (!result) break; states.push(result.state); if (result.state === 'published') break;
    }
    assert.deepEqual(states, ['uploading', 'uploading', 'accepted', 'staged', 'published']);
    assert.equal(await w.step(), null);
    const record = w.store.get(f.project.id, f.draft.id)!;
    const session = (record.receipt as { session: string }).session;
    assert.deepEqual(await readFile(join(root, 'archive', session, '0.media')), await readFile(image));
    assert.deepEqual(await readFile(join(root, 'archive', session, '1.media')), await readFile(audio));
    assert.deepEqual(JSON.parse(await readFile(join(root, 'archive', session, 'release.json'), 'utf8')), record.spec);
    assert.deepEqual((await readdir(join(root, 'archive', session))).sort(), ['0.media', '1.media', 'release.json']);
    assert.equal((await listPublications(f.project.id)).publications[0].state, 'published');
    assert.equal(JSON.stringify((await listPublications(f.project.id)).publications).includes(session), false);
  } finally { w.close(); }
});

test('changed connector code or configuration cannot execute an earlier approved publication', async () => {
  const f = await fixture(); await approve(f); const w = worker();
  try {
    const before = readConnectorFolder(join(root, 'connectors/local-archive')).runtimeVersion;
    await writeFile(modulePath, source + '\n// updated deployment\n');
    assert.notEqual(readConnectorFolder(join(root, 'connectors/local-archive')).runtimeVersion, before);
    const changed = await w.step(); assert.equal(changed?.state, 'approved'); assert.equal(changed?.issue, 'runtime-unavailable');
    assert.equal((await listPublications(f.project.id)).publications[0].external?.available, false);
    await writeFile(modulePath, source);
    const environment = process.env.VIRAL_HIT_ARCHIVE_DIR!;
    process.env.VIRAL_HIT_ARCHIVE_DIR = join(root, 'other-destination');
    assert.equal((await w.step())?.issue, 'runtime-unavailable');
    process.env.VIRAL_HIT_ARCHIVE_DIR = environment;
    assert.equal((await w.step())?.state, 'uploading');
    assert.equal(w.store.get(f.project.id, f.draft.id)?.spec.connectorVersion, before);
    w.store.stop(f.project.id, f.draft.id, 1);
  } finally { await writeFile(modulePath, source); w.close(); }
});

test('an installed connector with a lost publish response is reconciled without another publish', async () => {
  // Use the real module but simulate the network/process boundary losing the final acknowledgement.
  const f = await fixture(); await approve(f); const w = worker();
  try {
    for (let index = 0; index < 4; index++) await w.step();
    let writes = 0;
    const original = w.runtime.connector;
    w.runtime.connector = async (spec, signal) => {
      const connector = await original(spec, signal), publish = connector.publish!;
      return { ...connector, publish: async (...args) => { writes++; await publish(...args); throw new Error('Acknowledgement lost'); } };
    };
    assert.equal((await w.step())?.issue, 'publish-unknown');
    assert.equal(await w.step(), null); assert.equal(writes, 1);
    w.store.reconcile(f.project.id, f.draft.id, 1);
    assert.equal((await w.step())?.state, 'published'); assert.equal(writes, 1);
  } finally { w.close(); }
});
