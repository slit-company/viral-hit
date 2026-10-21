import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fetchSkillFromLink } from '@/core/skills/source.server';
import {
  fetchPackFromLink,
  packSourceUrl,
} from '@/core/harness/recipe-pack-source';
import { fetchCreativePack } from '@/core/creative-packs/source.server';

test('all catalog entry transports verify raw bytes before review or target publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vh-catalog-integrity-'));
  try {
    const bytes = Buffer.from('{"example":"retained bytes"}\n'),
      sha = createHash('sha256').update(bytes).digest('hex');
    let temporary = '';
    const download = async (_url: string, path: string) => {
      temporary = path;
      await writeFile(path, bytes);
    };
    for (const fetcher of [fetchSkillFromLink, fetchPackFromLink]) {
      await fetcher('https://example.com/file.json', undefined, download, sha);
      await assert.rejects(readFile(temporary), /ENOENT/);
      await assert.rejects(
        fetcher(
          'https://example.com/file.json',
          undefined,
          download,
          '0'.repeat(64),
        ),
        /differs from the catalog/,
      );
      await assert.rejects(readFile(temporary), /ENOENT/);
    }
    const target = join(root, 'pack.tar');
    await assert.rejects(
      fetchCreativePack(
        'https://example.com/file.tar',
        target,
        AbortSignal.timeout(5000),
        download,
        '0'.repeat(64),
      ),
      /differs from the catalog/,
    );
    assert.deepEqual(await readdir(root), []);
    const fetched = await fetchCreativePack(
      'https://example.com/file.tar',
      target,
      AbortSignal.timeout(5000),
      download,
      sha,
    );
    assert.equal(fetched.inspected, false);
    assert.deepEqual(await readFile(target), bytes);
    for (const raw of [
      'http://github.com/team/repo/blob/main/file.json',
      'https://user:password@github.com/team/repo/blob/main/file.json',
    ])
      assert.throws(() => packSourceUrl(raw), /HTTPS/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
