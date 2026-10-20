import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { readExactly, scanTar, writeTar } from '@/core/projects/bundles/tar.server';
import { CHARACTER_FILE_KIND, MAX_CHARACTER_FILE_BYTES, MAX_REFERENCE_BYTES, characterFileManifestSchema, type Character, type CharacterFileManifest } from './contract';
import { createCharacter, pickProfile, type UploadedReference } from './library.server';
import { readCharacter, referencePath } from './storage.server';

const MAX_FILE_MANIFEST_BYTES = 256 * 1024;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Writes one character and its reference images to a new file; an existing file is never replaced. */
export async function writeCharacterFile(id: string, path: string, signal = AbortSignal.timeout(5 * 60_000)) {
  if (!isAbsolute(path)) throw new Error('Use an absolute path for the character file');
  const character = readCharacter(id);
  if (!character) throw new Error('Character not found');
  const manifest: CharacterFileManifest = { schemaVersion: 1, kind: CHARACTER_FILE_KIND, id: character.id, profile: pickProfile(character), references: character.references };
  const sources = await Promise.all(character.references.map(async reference => {
    const source = referencePath(reference.sha256);
    return { hash: reference.sha256, path: source, size: (await stat(source)).size };
  }));
  const file = await open(path, 'wx', 0o600);
  try {
    await writeTar(file, Buffer.from(JSON.stringify(manifest)), sources, signal);
  } catch (error) {
    await file.close().catch(() => undefined); await rm(path, { force: true });
    throw error;
  }
  await file.close();
  return { id: character.id, name: character.name, path, sizeBytes: (await stat(path)).size, references: character.references.length };
}

/** Reads a character file completely and verifies every image against the hash its manifest declares. */
export async function readCharacterFile(path: string) {
  if (!isAbsolute(path)) throw new Error('Use an absolute path for the character file');
  if ((await stat(path)).size > MAX_CHARACTER_FILE_BYTES) throw new Error('Character files are limited to 20 images of up to 20 MB');
  const members = await scanTar(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const entry = members.get('manifest.json')!;
    if (entry.size > MAX_FILE_MANIFEST_BYTES) throw new Error('Character file manifest is too large');
    const manifest = characterFileManifestSchema.parse(JSON.parse((await readExactly(file, entry.offset, entry.size)).toString('utf8')));
    const expected = new Set(['manifest.json', ...manifest.references.map(reference => 'media/' + reference.sha256)]);
    if (members.size !== expected.size || [...members.keys()].some(name => !expected.has(name))) throw new Error('The character file has missing or extra images');
    const uploads: UploadedReference[] = [];
    for (const reference of manifest.references) {
      const member = members.get('media/' + reference.sha256)!;
      if (member.size === 0 || member.size > MAX_REFERENCE_BYTES) throw new Error('Reference images must be up to 20 MB');
      const bytes = await readExactly(file, member.offset, member.size);
      if (sha256(bytes) !== reference.sha256) throw new Error('Image ' + reference.filename.slice(0, 60) + ' does not match its checksum');
      uploads.push({ bytes, filename: reference.filename, role: reference.role, ...(reference.note ? { note: reference.note } : {}) });
    }
    return { manifest, uploads };
  } finally { await file.close(); }
}

const sameCharacter = (character: Character, manifest: CharacterFileManifest) =>
  JSON.stringify([pickProfile(character), character.references.map(item => [item.sha256, item.role])]) === JSON.stringify([manifest.profile, manifest.references.map(item => [item.sha256, item.role])]);

/**
 * Adds the character from a file. Importing the same file again returns the active character it created;
 * when the id is taken by a different character the import gets a new id.
 */
export async function importCharacterFile(path: string) {
  const { manifest, uploads } = await readCharacterFile(path);
  const existing = readCharacter(manifest.id);
  if (existing?.status === 'active' && sameCharacter(existing, manifest)) return { ...existing, replayed: true };
  const created = await createCharacter({ ...(existing ? {} : { id: manifest.id }), profile: manifest.profile }, uploads);
  return { ...created, replayed: false };
}
