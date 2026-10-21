import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { z } from 'zod';
import {
  changeCommunity,
  fetchCatalog,
  inspectCatalog,
  validateCatalog,
} from './service.server';
import { readCatalogs } from './storage.server';
import { catalogEntryHref, communityCatalogSchema } from './contract';
import { getSkillRegistry } from '@/core/skills/library.server';

function example() {
  return {
    schemaVersion: 1,
    kind: 'viral-hit-catalog',
    id: 'community-studio',
    title: 'Community studio',
    author: 'Independent creator',
    description: 'General and particular-job workflows',
    entries: [
      {
        id: 'planning',
        title: 'Story planning',
        summary: 'Plan an editable story.',
        kind: 'skill',
        scope: 'general',
        version: '1.0.0',
        tags: ['story'],
        url: 'https://example.com/planning.json',
        sha256: 'a'.repeat(64),
      },
      {
        id: 'product-kit',
        title: 'Product stories',
        summary: 'Build a product story.',
        kind: 'creative-pack',
        scope: 'specialized',
        version: '1.0.0',
        tags: ['product'],
        url: 'https://example.com/products.tar',
        sha256: 'b'.repeat(64),
      },
      {
        id: 'editing',
        title: 'Editing basics',
        summary: 'Prepare editable clips.',
        kind: 'recipe-pack',
        scope: 'general',
        version: '1.0.0',
        tags: [],
        url: 'https://example.com/editing.json',
        sha256: 'c'.repeat(64),
      },
    ],
  };
}
async function isolated(run: (root: string) => Promise<void>) {
  const previous = process.env.VIRAL_HIT_DATA_DIR,
    root = await mkdtemp(join(tmpdir(), 'vh-community-test-'));
  process.env.VIRAL_HIT_DATA_DIR = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.VIRAL_HIT_DATA_DIR;
    else process.env.VIRAL_HIT_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test('catalog metadata is reviewed, saved across processes, revised with conflicts and removed without installing entries', () =>
  isolated(async () => {
    const catalog = example(),
      before = (await getSkillRegistry()).catalog();
    const review = inspectCatalog(
      catalog,
      'https://github.com/team/tools/blob/main/catalog.json',
    );
    assert.equal(
      review.source,
      'https://raw.githubusercontent.com/team/tools/main/catalog.json',
    );
    assert.equal(readCatalogs().length, 0);
    assert.deepEqual(review.changes.added, [
      'planning',
      'product-kit',
      'editing',
    ]);
    const request = {
      action: 'save' as const,
      catalog,
      source: review.source,
      expectedDigest: review.digest,
      expectedPreviousDigest: null,
    };
    await assert.rejects(
      changeCommunity({
        ...request,
        source: 'https://example.com/another.json',
      }),
      /contents changed/,
    );
    const saved = await Promise.all([
      changeCommunity(request),
      changeCommunity(request),
    ]);
    assert.equal(
      saved.filter((result) => 'changed' in result && result.changed).length,
      1,
    );
    const cli = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'scripts/community.ts', 'list'],
      { env: { ...process.env } },
    );
    assert.deepEqual(
      JSON.parse(cli.stdout).catalogs[0].catalog,
      validateCatalog(catalog),
    );
    assert.deepEqual(
      inspectCatalog(
        { ...catalog, description: 'New description' },
        'https://example.com/catalog.json',
      ).changes.details,
      ['description', 'source'],
    );
    const next = {
      ...catalog,
      entries: [
        { ...catalog.entries[0], version: '2.0.0', sha256: 'd'.repeat(64) },
        { ...catalog.entries[1], id: 'new-kit' },
      ],
    };
    const update = inspectCatalog(next, review.source);
    assert.deepEqual(update.changes, {
      added: ['new-kit'],
      removed: ['product-kit', 'editing'],
      changed: ['planning'],
      details: [],
    });
    await changeCommunity({
      action: 'save',
      catalog: next,
      source: review.source,
      expectedDigest: update.digest,
      expectedPreviousDigest: update.previousDigest,
    });
    await assert.rejects(
      changeCommunity({
        action: 'remove',
        id: catalog.id,
        expectedDigest: review.digest,
      }),
      /changed after review/,
    );
    await assert.rejects(changeCommunity(request), /changed after review/);
    assert.deepEqual(
      await changeCommunity({
        action: 'remove',
        id: catalog.id,
        expectedDigest: update.digest,
      }),
      { removed: true },
    );
    assert.equal(readCatalogs().length, 0);
    assert.deepEqual((await getSkillRegistry()).catalog(), before);
  }));

test('catalog fetch uses bounded public transfer, removes temporary bytes and leaves saved snapshots unchanged on failure', () =>
  isolated(async () => {
    let path = '',
      calls = 0;
    const review = await fetchCatalog(
      'https://example.com/catalog.json',
      undefined,
      async (_url, destination, _signal, limit) => {
        path = destination;
        calls++;
        assert.equal(limit, 512_000);
        await writeFile(destination, JSON.stringify(example()));
      },
    );
    assert.equal(calls, 1);
    assert.equal(readCatalogs().length, 0);
    await assert.rejects(readFile(path), /ENOENT/);
    await changeCommunity({
      action: 'save',
      catalog: review.catalog,
      source: review.source,
      expectedDigest: review.digest,
      expectedPreviousDigest: null,
    });
    await assert.rejects(
      fetchCatalog(
        'https://example.com/catalog.json',
        undefined,
        async (_url, destination) => {
          path = destination;
          await writeFile(destination, 'partial');
          throw new Error('Transfer interrupted');
        },
      ),
      /interrupted/,
    );
    await assert.rejects(readFile(path), /ENOENT/);
    assert.equal(readCatalogs()[0].digest, review.digest);
    for (const url of [
      'http://github.com/team/repo/blob/main/file.json',
      'https://user:secret@github.com/team/repo/blob/main/file.json',
      'https://127.0.0.1/catalog.json',
      'https://example.com/catalog.json?token=secret',
    ]) {
      await assert.rejects(
        fetchCatalog(url, undefined, async () => {
          throw new Error('must not download');
        }),
        (error) => !String(error).includes('must not download'),
      );
    }
  }));

test('catalog schema and capacity bound author data, and handoffs keep exact artifact checksums', () =>
  isolated(async () => {
    const catalog = example(),
      parsed = validateCatalog(catalog);
    assert.throws(
      () =>
        validateCatalog({
          ...catalog,
          entries: [...catalog.entries, catalog.entries[0]],
        }),
      /Duplicate/,
    );
    assert.throws(() => validateCatalog({ ...catalog, executable: 'run.sh' }));
    assert.throws(
      () =>
        validateCatalog({
          ...catalog,
          entries: [{ ...catalog.entries[0], url: 'https://10.0.0.1/file' }],
        }),
      /public network/,
    );
    assert.throws(
      () => validateCatalog({ ...catalog, description: 'x'.repeat(513_000) }),
      /512 KB/,
    );
    assert.throws(() =>
      communityCatalogSchema.parse({
        ...catalog,
        entries: [{ ...catalog.entries[0], sha256: undefined }],
      }),
    );
    for (const entry of parsed.entries) {
      const href = new URL(catalogEntryHref(entry), 'http://localhost');
      assert.equal(href.searchParams.get('sha256'), entry.sha256);
      assert.equal(href.searchParams.get('source'), entry.url);
      assert.equal(
        href.pathname,
        entry.kind === 'skill'
          ? '/skills'
          : entry.kind === 'creative-pack'
            ? '/packs'
            : '/recipe-packs',
      );
    }
    for (let index = 0; index < 20; index++) {
      const item = { ...catalog, id: 'catalog-' + index, entries: [] },
        review = inspectCatalog(item);
      await changeCommunity({
        action: 'save',
        catalog: item,
        expectedDigest: review.digest,
        expectedPreviousDigest: null,
      });
    }
    const extra = { ...catalog, id: 'extra', entries: [] },
      review = inspectCatalog(extra);
    await assert.rejects(
      changeCommunity({
        action: 'save',
        catalog: extra,
        expectedDigest: review.digest,
        expectedPreviousDigest: null,
      }),
      /limit reached/,
    );
    assert.equal(readCatalogs().length, 20);
  }));

test('published catalog schema matches the runtime and accepts the independent author template', async () => {
  const schema = JSON.parse(
    await readFile('../../docs/schemas/community-catalog.schema.json', 'utf8'),
  );
  assert.deepEqual(
    schema,
    z.toJSONSchema(communityCatalogSchema, { io: 'input' }),
  );
  const template = JSON.parse(
    await readFile('../../examples/community/catalog.json', 'utf8'),
  );
  assert.equal(validateCatalog(template).entries.length, 0);
});
