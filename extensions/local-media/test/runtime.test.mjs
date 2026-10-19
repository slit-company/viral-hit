import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectRuntime, childEnvironment } from '../src/runtime.mjs';
import { createAdapter } from '../src/adapter.mjs';

test('runtime refuses absent/different lockfiles and a different installed engine version', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vh-runtime-test-')), lock = '{}';
  const digest = createHash('sha256').update(lock).digest('hex');
  try {
    await assert.rejects(inspectRuntime('.', 'video', digest), /absolute/);
    await assert.rejects(inspectRuntime(dir, 'video', digest));
    await writeFile(join(dir, 'package-lock.json'), lock);
    await assert.rejects(inspectRuntime(dir, 'video', 'wrong'), /lockfile/);
    await mkdir(join(dir, 'node_modules/vid2-gen'), { recursive: true });
    await writeFile(join(dir, 'node_modules/vid2-gen/package.json'), JSON.stringify({ name: 'vid2-gen', version: '9.0.0' }));
    await assert.rejects(inspectRuntime(dir, 'video', digest), /Expected vid2-gen/);
    await writeFile(join(dir, 'node_modules/vid2-gen/package.json'), JSON.stringify({ name: 'vid2-gen', version: '0.6.0' }));
    assert.equal((await inspectRuntime(dir, 'video', digest)).model, 'vid2-gen@0.6.0');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('child environment does not inherit provider credentials or executable overrides', () => {
  process.env.VH_TEST_SECRET = 'secret'; process.env.MUSIC2_BUN_PATH = '/wrong/bun';
  try {
    const env = childEnvironment('/tmp/test-work', 'music');
    assert.equal(env.VH_TEST_SECRET, undefined); assert.equal(env.MUSIC2_BUN_PATH, undefined);
    assert.equal(env.HOME, '/tmp/test-work');
  } finally { delete process.env.VH_TEST_SECRET; delete process.env.MUSIC2_BUN_PATH; }
});
test('published media recovers without rereading inputs or starting an engine', async () => {
  const output = { binaryReceipt: 'saved' };
  const recovered = await createAdapter('music').poll('same-job', { document: 'invalid' }, AbortSignal.timeout(500), { readBinary: async () => output, publishBinary: async () => { throw new Error('must not republish'); } });
  assert.deepEqual(recovered, { state: 'succeeded', output });
});
