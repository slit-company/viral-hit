import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchRuntimePackage } from './source.server';
import { MAX_RUNTIME_PACKAGE_BYTES } from './limits';
import { catalogEntryHref } from '../community/contract';
import { validateCatalog } from '../community/service.server';

const url = 'https://example.com/runtime.json';
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

test('runtime source preserves raw-byte identity, normalizes GitHub links and cleans temporary downloads', async () => {
  const bytes = JSON.stringify({ source: 'throw Error("NEVER_EXECUTE")' }, null, 2) + '\n';
  let path = '';
  const result = await fetchRuntimePackage({ action: 'fetch', url: 'https://github.com/team/repo/blob/main/runtime.json', expectedSha256: hash(bytes) }, undefined, async (source, destination, signal, max, validate) => {
    assert.equal(source, 'https://raw.githubusercontent.com/team/repo/main/runtime.json');
    assert.equal(max, MAX_RUNTIME_PACKAGE_BYTES);
    assert.equal(signal.aborted, false);
    assert.throws(() => validate!('https://example.com/file?token=private'));
    path = destination; await writeFile(path, bytes);
  });
  assert.deepEqual(result.package, JSON.parse(bytes));
  assert.equal(result.download.sha256, hash(bytes));
  assert.equal(result.download.catalogPinned, true);
  await assert.rejects(readFile(path), /ENOENT/);
  const unpinned = await fetchRuntimePackage({ action: 'fetch', url }, undefined, async (_source, destination) => { await writeFile(destination, bytes); });
  assert.equal(unpinned.download.sha256, hash(bytes));
  assert.equal(unpinned.download.catalogPinned, false);
});

test('runtime fetch rejects drift before parsing and preserves cleanup on transfer, JSON and size failures', async () => {
  for (const scenario of [
    { bytes: 'not JSON', expectedSha256: '0'.repeat(64), error: /differs from the catalog/ },
    { bytes: 'not JSON', error: /raw package file/ },
    { bytes: '', error: /12 MB/ },
    { bytes: 'x'.repeat(MAX_RUNTIME_PACKAGE_BYTES + 1), error: /12 MB/ },
    { bytes: '{}', fail: true, error: /interrupted/ },
  ]) {
    let path = '';
    await assert.rejects(fetchRuntimePackage({ action: 'fetch', url, expectedSha256: scenario.expectedSha256 }, undefined, async (_source, destination) => {
      path = destination; await writeFile(path, scenario.bytes);
      if (scenario.fail) throw Error('interrupted');
    }), scenario.error);
    await assert.rejects(readFile(path), /ENOENT/);
  }
});

test('runtime fetch validates URLs and digest before acquisition and honors cancellation before and after transfer', async () => {
  let calls = 0;
  const never = async () => { calls++; throw Error('unexpected acquisition'); };
  for (const bad of ['http://example.com/file', 'https://127.0.0.1/file', 'https://[::1]/file', 'https://10.0.0.1/file', 'https://user:pass@example.com/file', url + '?token=secret', url + '#fragment'])
    await assert.rejects(fetchRuntimePackage({ action: 'fetch', url: bad }, undefined, never));
  await assert.rejects(fetchRuntimePackage({ action: 'fetch', url, expectedSha256: 'bad' }, undefined, never));
  await assert.rejects(fetchRuntimePackage({ action: 'fetch', url }, AbortSignal.abort(), never));
  assert.equal(calls, 0);
  const controller = new AbortController(); let path = '';
  await assert.rejects(fetchRuntimePackage({ action: 'fetch', url }, controller.signal, async (_url, destination) => {
    path = destination; await writeFile(path, '{}'); controller.abort();
  }), /abort/i);
  await assert.rejects(readFile(path), /ENOENT/);
});

test('an independently authored runtime catalog handoff keeps exact file checksums for both scopes', () => {
  for (const scope of ['general', 'specialized']) {
    const catalog = validateCatalog({ schemaVersion: 1, kind: 'viral-hit-catalog', id: 'independent', title: 'Independent tools', description: 'Bring an engine', author: 'An author', entries: [{ id: 'engine', kind: 'runtime-package', title: 'Engine', summary: 'An independently authored engine', scope, version: '1.0.0', url, sha256: 'a'.repeat(64) }] });
    const href = new URL(catalogEntryHref(catalog.entries[0]), 'http://localhost');
    assert.equal(href.pathname, '/runtime-packages');
    assert.equal(href.searchParams.get('source'), url);
    assert.equal(href.searchParams.get('sha256'), 'a'.repeat(64));
  }
});

test('CLI link and JSON request fetch use the same source review without installing or executing downloaded code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'viral-hit-e2e-runtime-cli-'));
  try {
    const manifest = JSON.parse(await readFile('../../examples/adapters/tone/tone.json', 'utf8'));
    manifest.operation = 'ext.catalog-cli-proof';
    const source = 'throw Error("FETCH_MUST_NOT_EXECUTE");';
    manifest.sha256 = hash(source);
    const pkg = { schemaVersion: 1, kind: 'viral-hit-runtime-package', id: 'catalog-cli', version: '1.0.0', title: 'Independent engine', description: 'Shared engine', author: 'Independent', license: 'MIT', scope: 'general', entries: [{ kind: 'adapter', manifest, source }] };
    const bytes = JSON.stringify(pkg, null, 2);
    await writeFile(join(root, 'catalog-runtime.json'), bytes);
    const env = { ...process.env, VIRAL_HIT_DATA_DIR: root };
    const args = ['--import', './scripts/e2e-pack-download.mjs', '--import', 'tsx', 'scripts/runtime-package.ts'];
    const link = 'https://public-packs.viralhit.test/runtime.json';
    const fetched = await promisify(execFile)(process.execPath, [...args, 'fetch', link, hash(bytes)], { env });
    const review = JSON.parse(fetched.stdout);
    assert.equal(review.download.sha256, hash(bytes));
    assert.notEqual(review.digest, hash(bytes));
    assert.equal(review.package.entries[0].source, source);
    assert.equal(review.current, null);
    const fromJson = await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, [...args, 'change'], { env }, (error, stdout) => error ? reject(error) : resolve(stdout));
      child.stdin!.end(JSON.stringify({ action: 'fetch', url: link, expectedSha256: hash(bytes) }));
    });
    assert.deepEqual(JSON.parse(fromJson), review);
    const listed = await promisify(execFile)(process.execPath, [...args, 'list'], { env });
    assert.deepEqual(JSON.parse(listed.stdout).installed, []);
    await assert.rejects(promisify(execFile)(process.execPath, [...args, 'fetch', link, '0'.repeat(64)], { env }), /differs from the catalog/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
