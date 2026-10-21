import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { changeSkillLibrary, getSkillRegistry, inspectSkillFile, validateSkillFile } from './library.server';
import { changeCreativePacks } from '@/core/creative-packs/service.server';
import { writeManagedSkill } from './storage.server';

async function fixture(run: (root: string, file: ReturnType<typeof validateSkillFile>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'vh-skill-lifecycle-')), previous = process.env.VIRAL_HIT_DATA_DIR;
  process.env.VIRAL_HIT_DATA_DIR = root;
  try {
    const file = validateSkillFile({ schemaVersion: 1, kind: 'viral-hit-skill',
      manifest: JSON.parse(await readFile('../../examples/skills/product-ad-shots/skill.json', 'utf8')),
      instructions: await readFile('../../examples/skills/product-ad-shots/SKILL.md', 'utf8') });
    await run(root, file);
  } finally {
    if (previous === undefined) delete process.env.VIRAL_HIT_DATA_DIR; else process.env.VIRAL_HIT_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}
async function install(file: unknown) {
  const review = await inspectSkillFile(file);
  await changeSkillLibrary({ action: 'install', file, expectedDigest: review.digest }); return review;
}

test('reviewed replacement and removal pin both revisions, preserve packs and converge on retry', () => fixture(async (root, file) => {
  const initial = await install(file), id = file.manifest.id;
  const packPath = join(root, 'original.tar');
  await changeCreativePacks({ action: 'build', path: packPath, pack: { id: 'skill-kit', version: '1.0.0', title: 'Skill kit', description: 'A reusable skill kit', scope: 'specialized', author: 'Example', license: 'MIT', useCases: ['story-planning'], recipeIds: [], skillIds: [id], characterIds: [] } });
  const packReview = await changeCreativePacks({ action: 'inspect', path: packPath });
  assert.ok('pack' in packReview);
  await changeCreativePacks({ action: 'install', path: packPath, expectedDigest: packReview.pack.digest });
  const next = { ...file, manifest: { ...file.manifest, version: '2.0.0', scope: 'general' }, instructions: 'Plan any project. Review before execution.' };
  const review = await inspectSkillFile(next);
  assert.deepEqual(review.update!.current, file); assert.equal(review.update!.digest, initial.digest);
  assert.equal((await getSkillRegistry()).get(id)!.instructions, file.instructions);
  const update = { action: 'update' as const, file: next, expectedDigest: review.digest, expectedInstalledDigest: review.update!.digest };
  await assert.rejects(changeSkillLibrary({ ...update, file: { ...next, instructions: 'Unreviewed' } }), /changed after review/);
  await assert.rejects(changeSkillLibrary({ ...update, expectedInstalledDigest: '0'.repeat(64) }), /changed after review/);
  const incompatible = { ...next, manifest: { ...next.manifest, compatibility: { minimumViralHitVersion: '99.0.0', requiredMcpTools: [] } } };
  const badReview = await inspectSkillFile(incompatible);
  assert.deepEqual(badReview.update!.currentIncompatibilities, []);
  assert.equal(badReview.update!.blocking.length, 1);
  await assert.rejects(changeSkillLibrary({ ...update, file: incompatible, expectedDigest: badReview.digest }), /Requires/);
  assert.deepEqual(await changeSkillLibrary(update), { updated: true, skill: review.skill });
  assert.equal((await changeSkillLibrary(update) as { updated: boolean }).updated, false);
  const current = (await getSkillRegistry()).get(id)!;
  assert.equal(current.manifest.scope, 'general'); assert.equal(current.instructions, next.instructions);
  await assert.rejects(changeSkillLibrary({ action: 'remove', skillId: id, expectedDigest: initial.digest }), /changed after review/);
  const removal = await changeSkillLibrary({ action: 'review-remove', skillId: id });
  assert.ok('digest' in removal); assert.equal(removal.digest, review.digest);
  const request = { action: 'remove' as const, skillId: id, expectedDigest: removal.digest };
  assert.equal((await changeSkillLibrary(request) as { removed: boolean }).removed, true);
  assert.equal((await changeSkillLibrary(request) as { removed: boolean }).removed, false);
  assert.equal((await getSkillRegistry()).get(id), null);
  const exported = join(root, 'exported.tar');
  await changeCreativePacks({ action: 'export', id: 'skill-kit', path: exported });
  assert.deepEqual(await readFile(exported), await readFile(packPath));
  await changeCreativePacks({ action: 'install', path: exported, expectedDigest: packReview.pack.digest });
  assert.equal((await getSkillRegistry()).get(id)!.instructions, file.instructions);
  await assert.rejects(changeSkillLibrary(request), /changed after review/);
}));

test('legacy skill updates are atomic overlays; removing and reinstalling never edits the operator folder', () => fixture(async (root, file) => {
  const folder = join(root, 'installed-skills', file.manifest.id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'skill.json'), JSON.stringify(file.manifest));
  await writeFile(join(folder, 'SKILL.md'), file.instructions);
  const next = { ...file, instructions: 'New complete instructions', manifest: { ...file.manifest, version: '1.1.0' } };
  const review = await inspectSkillFile(next);
  await changeSkillLibrary({ action: 'update', file: next, expectedDigest: review.digest, expectedInstalledDigest: review.update!.digest });
  assert.equal((await getSkillRegistry()).get(file.manifest.id)!.instructions, next.instructions);
  assert.equal(await readFile(join(folder, 'SKILL.md'), 'utf8'), file.instructions);
  await changeSkillLibrary({ action: 'remove', skillId: file.manifest.id, expectedDigest: review.digest });
  assert.equal((await getSkillRegistry()).get(file.manifest.id), null);
  await install(file); assert.equal((await getSkillRegistry()).get(file.manifest.id)!.instructions, file.instructions);
  for (const skillId of ['consistent-characters', 'recipe-packs']) {
    await assert.rejects(changeSkillLibrary({ action: 'review-remove', skillId }), /Only installed/);
    await assert.rejects(changeSkillLibrary({ action: 'remove', skillId, expectedDigest: review.digest }), /Only installed/);
    const reserved = { ...next, manifest: { ...next.manifest, id: skillId } }, reservedReview = await inspectSkillFile(reserved);
    await assert.rejects(changeSkillLibrary({ action: 'update', file: reserved, expectedDigest: reservedReview.digest, expectedInstalledDigest: review.digest }), /Only installed/);
  }
}));

test('separate CLI writers cannot both replace the same reviewed revision', () => fixture(async (root, file) => {
  const initial = await install(file), exec = promisify(execFile);
  const changes = await Promise.all(['A', 'B'].map(async name => {
    const next = { ...file, instructions: 'Whole definition ' + name }, review = await inspectSkillFile(next), path = join(root, name + '.json');
    await writeFile(path, JSON.stringify(next));
    return { path, review };
  }));
  const results = await Promise.allSettled(changes.map(({ path, review }) => exec(process.execPath, ['--import', 'tsx', 'scripts/skill.ts', 'update', path, review.digest, initial.digest], { env: { ...process.env }, timeout: 30_000 })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.match(failed.reason.stderr, /changed after review/);
  assert.match((await getSkillRegistry()).get(file.manifest.id)!.instructions, /^Whole definition [AB]$/);
  assert.throws(() => writeManagedSkill('../escape', null, null));
}));

test('operator-owned definitions remain read-only during managed lifecycle operations', () => fixture(async (root, file) => {
  const previous = process.env.VIRAL_HIT_SKILLS_DIR, folder = join(root, 'operator', file.manifest.id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'skill.json'), JSON.stringify(file.manifest));
  await writeFile(join(folder, 'SKILL.md'), file.instructions);
  process.env.VIRAL_HIT_SKILLS_DIR = join(root, 'operator');
  try {
    const next = { ...file, instructions: 'Replacement' }, review = await inspectSkillFile(next);
    assert.equal(review.collision, 'reserved'); assert.equal(review.update, undefined);
    await assert.rejects(changeSkillLibrary({ action: 'update', file: next, expectedDigest: review.digest, expectedInstalledDigest: '0'.repeat(64) }), /Only installed/);
    await assert.rejects(changeSkillLibrary({ action: 'remove', skillId: file.manifest.id, expectedDigest: review.digest }), /Only installed/);
    assert.equal((await getSkillRegistry()).get(file.manifest.id)!.source, 'local');
    assert.equal(await readFile(join(folder, 'SKILL.md'), 'utf8'), file.instructions);
  } finally { if (previous === undefined) delete process.env.VIRAL_HIT_SKILLS_DIR; else process.env.VIRAL_HIT_SKILLS_DIR = previous; }
}));
