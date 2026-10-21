import assert from 'node:assert/strict';
import { copyFile, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, test } from 'node:test';
import { fetchCreativePack } from './source.server';
import { MAX_CREATIVE_PACK_BYTES } from './contract';

const root = await mkdtemp(join(tmpdir(), 'vh-pack-fetch-test-'));
after(() => rm(root, { recursive: true, force: true }));
const timeout = () => AbortSignal.timeout(10_000);
test('GitHub file pages normalize to public raw downloads without carrying query values into receipts', async () => {
  const path = join(root, 'raw.tar');
  const result = await fetchCreativePack('https://github.com/creator/toolkit/blob/v1.0.0/general.viralhit-pack.tar?token=private-query', path, timeout(), async (url, destination, signal, limit) => {
    assert.equal(url, 'https://raw.githubusercontent.com/creator/toolkit/v1.0.0/general.viralhit-pack.tar');
    assert.equal(limit, MAX_CREATIVE_PACK_BYTES); assert.equal(signal.aborted, false);
    await writeFile(destination, 'downloaded bytes');
  });
  assert.equal(await readFile(path, 'utf8'), 'downloaded bytes');
  assert.equal(result.inspected, false);
  assert.equal(JSON.stringify(result).includes('private-query'), false);
  assert.equal(result.sizeBytes, 16);
});
test('insecure, credential-bearing and private-IP URLs are refused before normalization or any download', async () => {
  let calls = 0;
  for (const url of ['http://github.com/team/kit/blob/main/pack.tar', 'https://user:secret@github.com/team/kit/blob/main/pack.tar', 'https://127.0.0.1/pack.tar', 'https://[::1]/pack.tar', 'https://example.org:444/pack.tar']) {
    await assert.rejects(fetchCreativePack(url, join(root, 'bad.tar'), timeout(), async () => { calls++; }), /HTTPS|public network/);
  }
  assert.equal(calls, 0);
  await assert.rejects(fetchCreativePack('https://example.org/pack.tar', 'relative.tar', timeout()), /absolute/);
});
test('a failed, oversized or canceled transfer leaves no target or temporary download folder', async () => {
  const path = join(root, 'failed.tar');
  await assert.rejects(fetchCreativePack('https://example.org/pack.tar', path, timeout(), async (_url, temporary) => {
    await writeFile(temporary, 'partial'); throw new Error('Transfer interrupted');
  }), /interrupted/);
  await assert.rejects(fetchCreativePack('https://example.org/pack.tar', path, timeout(), async (_url, temporary) => {
    const file = await open(temporary, 'wx'); try { await file.truncate(MAX_CREATIVE_PACK_BYTES + 1); } finally { await file.close(); }
  }), /512 MB/);
  const controller = new AbortController();
  await assert.rejects(fetchCreativePack('https://example.org/pack.tar', path, controller.signal, async (_url, temporary) => {
    await writeFile(temporary, 'complete'); controller.abort();
  }), /aborted/);
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.vh-pack-fetch-') || name === 'failed.tar'), []);
});
test('fetch never replaces an occupied destination and preserves exact downloaded bytes', async () => {
  const path = join(root, 'occupied.tar'), incoming = join(root, 'incoming.tar');
  await writeFile(path, 'user data'); await writeFile(incoming, 'new data');
  await assert.rejects(fetchCreativePack('https://example.org/release.tar', path, timeout(), async (_url, destination) => { await copyFile(incoming, destination); }), /EEXIST/);
  assert.equal(await readFile(path, 'utf8'), 'user data');
  assert.equal((await readdir(root)).some(name => name.startsWith('.vh-pack-fetch-')), false);
});
