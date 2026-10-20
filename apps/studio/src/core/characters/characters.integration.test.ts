import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'vh-characters-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(() => rm(directory, { recursive: true, force: true }));
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { changeCharacters, readCharacterReference } = await import('./library.server');
const { characterBrief, characterRequest } = await import('./contract');

const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const image = (name: string, color: string, size = '320x480') => { const file = join(directory, name); execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=' + color + ':s=' + size, '-frames:v', '1', file]); return file; };
const front = image('front.png', 'orange'), side = image('side.png', 'teal'), smile = image('smile.jpg', 'pink'), gif = image('loop.gif', 'red');
const profile = { name: 'Mori the fox', kind: 'mascot' as const, description: 'A round orange fox mascot with a white chest.', invariants: ['two pointed ears with dark tips', 'white chest patch', 'orange fur'], forbidden: ['extra tails', 'human hands'], providerIdentities: [] };

test('a character keeps one canonical anchor, deduplicated references and its written contract', async () => {
  const created = await changeCharacters({ action: 'create', profile, references: [{ path: side, role: 'angle' }, { path: front, role: 'canonical' }, { path: front, role: 'angle' }] }) as { id: string; version: number; references: { sha256: string; role: string; mimeType: string; width: number }[] };
  assert.equal(created.id, 'mori-the-fox'); assert.equal(created.version, 1);
  assert.deepEqual(created.references.map(item => item.role), ['angle', 'canonical']);
  assert.equal(created.references[1].sha256, createHash('sha256').update(await readFile(front)).digest('hex'));
  assert.equal(created.references[1].width, 320);
  const again = await changeCharacters({ action: 'create', profile, references: [{ path: front, role: 'canonical' }] }) as { id: string };
  assert.equal(again.id, 'mori-the-fox-2');
  assert.match(characterBrief(created as never), /Keep exactly: two pointed ears with dark tips; white chest patch; orange fur\. Never: extra tails; human hands\./);
  const added = await changeCharacters({ action: 'add_references', id: created.id, expectedVersion: 1, references: [{ path: smile, role: 'expression', note: 'smiling' }] }) as { version: number; references: unknown[] };
  assert.equal(added.version, 2); assert.equal(added.references.length, 3);
  await assert.rejects(changeCharacters({ action: 'update', id: created.id, expectedVersion: 1, profile: { description: 'stale edit' } }), /changed since you opened it/);
  await assert.rejects(changeCharacters({ action: 'remove_reference', id: created.id, expectedVersion: 2, sha256: created.references[1].sha256 }), /another canonical/);
  const moved = await changeCharacters({ action: 'set_canonical', id: created.id, expectedVersion: 2, sha256: created.references[0].sha256 }) as { references: { sha256: string; role: string }[] };
  assert.deepEqual(moved.references.map(item => item.role), ['canonical', 'angle', 'expression']);
  const read = await readCharacterReference(created.id, created.references[0].sha256);
  assert.equal(createHash('sha256').update(read.bytes).digest('hex'), created.references[0].sha256);
  await assert.rejects(readCharacterReference(again.id, created.references[0].sha256), /not found/);
});

test('using a character in a project imports its references once and returns the brief', async () => {
  const project = await createProject({ name: 'Character use' });
  const first = await changeCharacters({ action: 'use', id: 'mori-the-fox', projectId: project.id }) as { brief: string; assets: { assetId: string; role: string }[] };
  const second = await changeCharacters({ action: 'use', id: 'mori-the-fox', projectId: project.id }) as typeof first;
  assert.deepEqual(second.assets, first.assets);
  assert.equal(first.assets.length, 3); assert.match(first.brief, /^Mori the fox \(mascot\)/);
  for (const asset of first.assets) {
    const row = (await getProjectAssetById({ projectId: project.id, assetId: asset.assetId }))!;
    const bytes = await readFile(resolveLocalProjectAssetPath({ objectKey: row.objectKey }));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
  }
  const other = await createProject({ name: 'Other project' });
  const elsewhere = await changeCharacters({ action: 'use', id: 'mori-the-fox', projectId: other.id }) as typeof first;
  assert.notDeepEqual(elsewhere.assets.map(item => item.assetId), first.assets.map(item => item.assetId));
  await assert.rejects(changeCharacters({ action: 'use', id: 'mori-the-fox', projectId: 'missing-project' }), /Project not found/);
});

test('characters accept project images and reject unsupported or unsafe inputs', async () => {
  const project = await createProject({ name: 'Character source' });
  const asset = await importLocalProjectAsset({ projectId: project.id, filePath: side });
  const fromProject = await changeCharacters({ action: 'create', id: 'teal-card', profile: { ...profile, name: 'Teal card', kind: 'product' }, references: [{ projectId: project.id, assetId: asset.id, role: 'canonical' }] }) as { references: { sha256: string }[] };
  assert.equal(fromProject.references.length, 1);
  await assert.rejects(changeCharacters({ action: 'create', profile, references: [{ projectId: 'other', assetId: asset.id, role: 'canonical' }] }), /local image from this project/);
  await assert.rejects(changeCharacters({ action: 'create', profile, references: [{ path: 'front.png', role: 'canonical' }] }), /absolute file path/);
  await assert.rejects(changeCharacters({ action: 'create', profile, references: [{ path: gif, role: 'canonical' }] }), /PNG, JPEG or WebP/);
  const text = join(directory, 'note.png'); await writeFile(text, 'not an image');
  await assert.rejects(changeCharacters({ action: 'create', profile, references: [{ path: text, role: 'canonical' }] }), /Reference note\.png/);
  const archived = await changeCharacters({ action: 'archive', id: 'teal-card', expectedVersion: 1 }) as { status: string };
  assert.equal(archived.status, 'archived');
  await assert.rejects(changeCharacters({ action: 'use', id: 'teal-card', projectId: project.id }), /Restore this character/);
  const listed = await changeCharacters({ action: 'list' }) as { characters: { id: string }[] };
  assert.deepEqual(listed.characters.map(item => item.id).sort(), ['mori-the-fox', 'mori-the-fox-2']);
});

test('a partial update changes only the fields it names and voice null removes the voice note', async () => {
  type Saved = { id: string; version: number; invariants: string[]; forbidden: string[]; voice?: { direction: string } };
  const run = async (request: unknown) => await changeCharacters(characterRequest.parse(request)) as Saved;
  const created = await run({ action: 'create', profile: { ...profile, name: 'Patch fox', voice: { direction: 'calm' } }, references: [{ path: front, role: 'canonical' }] });
  const voiced = await run({ action: 'update', id: created.id, expectedVersion: 1, profile: { voice: { direction: 'bright and quick' } } });
  assert.deepEqual([voiced.invariants, voiced.forbidden, voiced.voice?.direction], [profile.invariants, profile.forbidden, 'bright and quick']);
  const cleared = await run({ action: 'update', id: created.id, expectedVersion: 2, profile: { voice: null } });
  assert.equal(cleared.voice, undefined); assert.deepEqual(cleared.invariants, profile.invariants);
  const ruled = await run({ action: 'update', id: created.id, expectedVersion: 3, profile: { invariants: ['green scarf'] } });
  assert.deepEqual([ruled.invariants, ruled.forbidden, ruled.voice], [['green scarf'], profile.forbidden, undefined]);
});
