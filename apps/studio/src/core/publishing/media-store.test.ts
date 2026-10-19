import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, rm, readdir, chmod, open, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PublicationMediaStore } from './media-store.server';
import { PUBLICATION_BLOCK_BYTES as block } from './media-files.server';
import type { PublicationAsset } from './contracts';

const signal = () => AbortSignal.timeout(20000);
async function fixture(size = 137) {
  const directory = await mkdtemp(join(tmpdir(), 'publication-media-')), root = join(directory, 'retained'), source = join(directory, 'source');
  const bytes = Buffer.alloc(size); for (let index = 0; index < size; index++) bytes[index] = index % 251;
  await writeFile(source, bytes);
  const asset: PublicationAsset = { assetId: 'asset', sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: size, contentType: 'video/mp4' };
  const store = new PublicationMediaStore(root), retained = join(root, 'project', 'asset', `${asset.sha256}.media`);
  return { directory, root, source, bytes, asset, store, retained, cleanup: async () => { store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('retains approved bytes across source replacement/deletion, store reopen and unaligned resume ranges', async () => {
  const f = await fixture(block * 2 + 137);
  try {
    assert.deepEqual(await f.store.prepare('project', f.asset, f.source, signal()), f.asset);
    await writeFile(f.source, Buffer.from('replaced')); await rm(f.source);
    const reopened = new PublicationMediaStore(f.root);
    try {
      await reopened.check('project', f.asset, signal());
      for (const [offset, length] of [[0, block], [block - 3, block], [2 * block, 137], [1, 1]]) {
        const bytes = await reopened.read('project', f.asset, offset, length, signal());
        assert.deepEqual(Buffer.from(bytes), f.bytes.subarray(offset, offset + length));
      }
      assert.equal((await stat(f.retained)).mode & 0o777, 0o400);
      assert.equal((await stat(join(f.root, 'index.sqlite'))).mode & 0o777, 0o600);
    } finally { reopened.close(); }
  } finally { await f.cleanup(); }
});

test('changed size/hash, symlink sources and cancellation cannot leave a ready manifest or temporary copy', async () => {
  const f = await fixture(block + 10);
  try {
    await assert.rejects(f.store.prepare('project', { ...f.asset, sizeBytes: f.asset.sizeBytes - 1 }, f.source, signal()), /size/);
    await assert.rejects(f.store.prepare('project', { ...f.asset, sha256: '0'.repeat(64) }, f.source, signal()), /changed/);
    const link = join(f.directory, 'symlink'); await symlink(f.source, link);
    await assert.rejects(f.store.prepare('project', f.asset, link, signal()));
    await assert.rejects(f.store.prepare('project', f.asset, f.source, AbortSignal.abort()));
    const controller = new AbortController(), pending = f.store.prepare('project', f.asset, f.source, controller.signal);
    controller.abort(); await assert.rejects(pending);
    await assert.rejects(f.store.check('project', f.asset, signal()), /not been retained/);
    assert.deepEqual((await readdir(f.root, { recursive: true })).filter(name => /\.(media|pending)$/.test(name)), []);
  } finally { await f.cleanup(); }
});

test('checks every touched block before returning bytes, and never overwrites a corrupt retained file', async () => {
  const f = await fixture(block + 137);
  try {
    await f.store.prepare('project', f.asset, f.source, signal());
    await chmod(f.retained, 0o600); const file = await open(f.retained, 'r+');
    try { await file.write(Buffer.from([255]), 0, 1, block + 1); } finally { await file.close(); }
    assert.deepEqual(Buffer.from(await f.store.read('project', f.asset, 0, 5, signal())), f.bytes.subarray(0, 5));
    await assert.rejects(f.store.read('project', f.asset, block - 3, 8, signal()), /corrupt/);
    await assert.rejects(f.store.prepare('project', f.asset, f.source, signal()), /corrupt/);
    assert.equal((await readFile(f.retained))[block + 1], 255);
  } finally { await f.cleanup(); }
});

test('project identity, content identity, traversal and range limits are enforced before returning data', async () => {
  const f = await fixture();
  try {
    await f.store.prepare('project', f.asset, f.source, signal());
    await assert.rejects(f.store.read('foreign', f.asset, 0, 1, signal()), /not been retained/);
    await assert.rejects(f.store.check('project', { ...f.asset, contentType: 'audio/wav' }, signal()), /identity/);
    for (const project of ['..', '.', '../project', '/absolute']) await assert.rejects(f.store.prepare(project, f.asset, f.source, signal()), /identity/);
    for (const [offset, length] of [[-1, 1], [0, 0], [0, block + 1], [136, 2], [1.5, 1], [0, NaN]]) await assert.rejects(f.store.read('project', f.asset, offset, length, signal()), /range/);
    await assert.rejects(f.store.read('project', f.asset, 0, 1, AbortSignal.abort()));
  } finally { await f.cleanup(); }
});

test('retained files, parents and index may not be substituted by symlinks', async () => {
  const f = await fixture();
  try {
    await f.store.prepare('project', f.asset, f.source, signal());
    await rm(f.retained); await symlink(f.source, f.retained);
    await assert.rejects(f.store.read('project', f.asset, 0, 1, signal()), /path/);
    await rm(join(f.root, 'project'), { recursive: true }); await symlink(f.directory, join(f.root, 'project'));
    await assert.rejects(f.store.prepare('project', f.asset, f.source, signal()), /path/);
    const badRoot = join(f.directory, 'bad-root'); await symlink(f.root, badRoot);
    assert.throws(() => new PublicationMediaStore(badRoot), /symbolic/);
    for (const filename of ['index.sqlite', 'index.sqlite-wal', 'index.sqlite-shm']) {
      const root = join(f.directory, filename); await mkdir(root);
      await symlink(f.source, join(root, filename));
      assert.throws(() => new PublicationMediaStore(root), /path/);
    }
    assert.deepEqual(await readFile(f.source), f.bytes);
  } finally { await f.cleanup(); }
});

test('concurrent preparation commits one complete immutable file and matching index', async () => {
  const f = await fixture(block + 137), second = new PublicationMediaStore(f.root);
  try {
    const results = await Promise.all([f.store.prepare('project', f.asset, f.source, signal()), second.prepare('project', f.asset, f.source, signal())]);
    assert.deepEqual(results, [f.asset, f.asset]);
    assert.deepEqual((await readdir(join(f.root, 'project', 'asset'))), [`${f.asset.sha256}.media`]);
    await second.check('project', f.asset, signal());
    assert.deepEqual(Buffer.from(await second.read('project', f.asset, block - 1, 2, signal())), f.bytes.subarray(block - 1, block + 1));
  } finally { second.close(); await f.cleanup(); }
});

test('a file orphaned by a failed manifest commit is verified and recovered on the next preparation', async () => {
  const f = await fixture();
  try {
    f.store.close();
    await assert.rejects(f.store.prepare('project', f.asset, f.source, signal()), /database is not open/);
    assert.deepEqual(await readFile(f.retained), f.bytes);
    const recovered = new PublicationMediaStore(f.root);
    try {
      await assert.rejects(recovered.check('project', f.asset, signal()), /not been retained/);
      await recovered.prepare('project', f.asset, f.source, signal());
      assert.deepEqual(Buffer.from(await recovered.read('project', f.asset, 0, f.asset.sizeBytes, signal())), f.bytes);
    } finally { recovered.close(); }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('missing integrity index entries cannot yield unchecked bytes', async () => {
  const f = await fixture();
  try {
    await f.store.prepare('project', f.asset, f.source, signal());
    const db = new DatabaseSync(join(f.root, 'index.sqlite'));
    try { db.exec('DELETE FROM retained_media_blocks'); } finally { db.close(); }
    await assert.rejects(f.store.check('project', f.asset, signal()), /incomplete/);
    await assert.rejects(f.store.read('project', f.asset, 0, 1, signal()), /incomplete/);
  } finally { await f.cleanup(); }
});
