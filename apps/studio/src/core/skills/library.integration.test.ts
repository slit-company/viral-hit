import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { changeSkillLibrary, getSkillRegistry, inspectSkillFile, validateSkillFile } from './library.server';
import { fetchSkillFromLink } from './source.server';

async function example() {
  const manifest = JSON.parse(await readFile('../../examples/skills/product-ad-shots/skill.json', 'utf8'));
  const instructions = await readFile('../../examples/skills/product-ad-shots/SKILL.md', 'utf8');
  return { schemaVersion: 1, kind: 'viral-hit-skill', manifest, instructions };
}

test('reviewed skill files install atomically, are immediately discoverable, export unchanged, and never overwrite another skill', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vh-skill-library-')), previous = process.env.VIRAL_HIT_DATA_DIR;
  process.env.VIRAL_HIT_DATA_DIR = root;
  try {
    const file = await example();
    const review = await inspectSkillFile(file);
    assert.equal(review.skill.manifest.scope, 'specialized'); assert.deepEqual(review.blocking, []);
    assert.equal((await getSkillRegistry()).get(file.manifest.id), null);
    await assert.rejects(changeSkillLibrary({ action: 'install', file: { ...file, instructions: 'Changed' }, expectedDigest: review.digest }), /changed after review/);
    const results = await Promise.all(Array.from({ length: 3 }, () => changeSkillLibrary({ action: 'install', file, expectedDigest: review.digest })));
    assert.equal(results.filter(result => 'installed' in result && result.installed).length, 1);
    const current = (await getSkillRegistry()).get(file.manifest.id)!;
    assert.equal(current.source, 'installed'); assert.equal(current.manifest.scope, 'specialized'); assert.equal(current.instructions, file.instructions.trim());
    const exported = await changeSkillLibrary({ action: 'export', skillId: file.manifest.id });
    assert.deepEqual(exported, validateSkillFile(file));
    assert.equal((await inspectSkillFile(exported)).collision, 'same');
    assert.equal((await inspectSkillFile({ ...file, instructions: 'Changed' })).collision, 'different');
    await assert.rejects(changeSkillLibrary({ action: 'install', file: { ...file, instructions: 'Changed' }, expectedDigest: (await inspectSkillFile({ ...file, instructions: 'Changed' })).digest }), /new ID/);
    assert.deepEqual(await readdir(join(root, 'installed-skills')), [file.manifest.id]);
    const reserved = { ...file, manifest: { ...file.manifest, id: 'consistent-characters' } };
    assert.equal((await inspectSkillFile(reserved)).collision, 'reserved');
    await mkdir(join(root, 'installed-skills', '.install-interrupted')); // Incomplete installs are invisible to readers.
    assert.deepEqual((await getSkillRegistry()).catalog().problems, []);
    const incompatible = { ...file, manifest: { ...file.manifest, id: 'future-skill', compatibility: { minimumViralHitVersion: '99.0.0', requiredMcpTools: ['viral_hit_unknown'] } } };
    assert.equal((await inspectSkillFile(incompatible)).blocking.length, 2);
    assert.throws(() => validateSkillFile({ ...file, instructions: '가'.repeat(200_000) }), /too large/);
    assert.throws(() => validateSkillFile({ ...file, entry: 'run.sh' }));
    const registry = await getSkillRegistry();
    assert.deepEqual(registry.catalog().skills.map(skill => skill.source).sort(), ['installed', 'official', 'official']);
  } finally {
    if (previous === undefined) delete process.env.VIRAL_HIT_DATA_DIR; else process.env.VIRAL_HIT_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('skill links use the bounded public downloader, accept GitHub file links and never install', async () => {
  const file = await example(); let downloadedPath = '';
  const result = await fetchSkillFromLink('https://github.com/team/skills/blob/main/example.viralhit-skill.json', undefined, async (url, path, signal, limit) => {
    assert.equal(url, 'https://raw.githubusercontent.com/team/skills/main/example.viralhit-skill.json');
    assert.equal(limit, 700_000); assert.equal(signal.aborted, false); downloadedPath = path;
    await writeFile(path, JSON.stringify(file));
  });
  assert.deepEqual(result.file, file); await assert.rejects(readFile(downloadedPath), /ENOENT/);
  await assert.rejects(fetchSkillFromLink('https://127.0.0.1/skill.json'), /public network address/);
  await assert.rejects(fetchSkillFromLink('http://example.com/skill.json'), /HTTPS/);
  await assert.rejects(fetchSkillFromLink('https://example.com/skill.json', undefined, async (_url, path) => { await writeFile(path, '<html>'); }), /did not return a skill file/);
});
