import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { constants } from 'node:fs';
import { probeMedia } from '@/core/harness/probe-media';
import { getProject } from '@/core/projects/projects';
import { getProjectAssetById, linkProjectAsset, recordUserAsset } from '@/core/workspace-lib/assets/user-assets';
import { LOCAL_PROJECT_ASSET_BUCKET, LOCAL_PROJECT_ASSET_PROVIDER, persistLocalProjectAsset, resolveLocalProjectAssetPath, sanitizeLocalProjectAssetFilename } from '@/core/projects/local-project-assets';
import { characterBrief, characterProfileSchema, MAX_CHARACTER_REFERENCES, MAX_REFERENCE_BYTES, slugCharacterId, type Character, type CharacterProfile, type CharacterReference, type CharacterRequest, type ReferenceSource } from './contract';
import { CharacterConflictError, readCharacter, readCharacters, referencePath, storeReferenceBytes, writeCharacter } from './storage.server';

/** Bytes received over HTTP; MCP and CLI use ReferenceSource paths or project assets instead. */
export type UploadedReference = { bytes: Uint8Array; filename: string; role: CharacterReference['role']; note?: string };
type Source = ReferenceSource | UploadedReference;
const now = () => new Date().toISOString();

async function readBounded(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size === 0 || info.size > MAX_REFERENCE_BYTES) throw new Error('Reference images must be regular files up to 20 MB');
    return new Uint8Array(await file.readFile());
  } finally { await file.close(); }
}

async function loadSource(source: Source) {
  let bytes: Uint8Array, filename: string;
  if ('bytes' in source) { bytes = source.bytes; filename = source.filename; }
  else if ('path' in source) {
    if (!isAbsolute(source.path)) throw new Error('Use an absolute file path for local reference images');
    bytes = await readBounded(source.path); filename = basename(source.path);
  } else {
    const asset = await getProjectAssetById({ projectId: source.projectId, assetId: source.assetId });
    if (!asset || asset.type !== 'image' || asset.bucket !== LOCAL_PROJECT_ASSET_BUCKET) throw new Error('Choose a local image from this project');
    bytes = await readBounded(resolveLocalProjectAssetPath({ objectKey: asset.objectKey })); filename = asset.filename ?? asset.id;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_BYTES) throw new Error('Reference images must be up to 20 MB');
  const directory = await mkdtemp(join(tmpdir(), 'vh-character-'));
  try {
    const probePath = join(directory, 'reference');
    await writeFile(probePath, bytes);
    const info = await probeMedia(probePath, 'image', AbortSignal.timeout(15_000));
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(info.mimeType)) throw new Error('Reference images must be PNG, JPEG or WebP');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await storeReferenceBytes(sha256, bytes);
    return { sha256, role: source.role, filename: filename.slice(0, 160), mimeType: info.mimeType as CharacterReference['mimeType'], width: info.width!, height: info.height!, ...(source.note ? { note: source.note } : {}) } satisfies CharacterReference;
  } catch (error) {
    throw new Error('Reference ' + filename.slice(0, 60) + ': ' + (error instanceof Error ? error.message : 'unreadable image'));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

function mergeReferences(existing: CharacterReference[], incoming: CharacterReference[]) {
  const result = [...existing];
  for (const reference of incoming) if (!result.some(item => item.sha256 === reference.sha256)) result.push(reference);
  if (result.length > MAX_CHARACTER_REFERENCES) throw new Error('A character can have up to 20 reference images');
  // Without an explicit canonical image the first one anchors the identity.
  if (!result.some(item => item.role === 'canonical')) result[0] = { ...result[0], role: 'canonical' };
  return result;
}

function required(id: string) {
  const character = readCharacter(id);
  if (!character) throw new CharacterConflictError('Character not found');
  return character;
}
function next(character: Character, changes: Partial<Character>): Character {
  return { ...character, ...changes, version: character.version + 1, updatedAt: now() };
}

export async function createCharacter(input: { id?: string; profile: CharacterProfile }, sources: Source[]) {
  const profile = characterProfileSchema.parse(input.profile);
  if (!sources.length) throw new Error('Add at least one reference image');
  if (sources.filter(source => source.role === 'canonical').length > 1) throw new Error('Choose one canonical reference');
  const references = mergeReferences([], await Promise.all(sources.map(loadSource)));
  let id = input.id ?? slugCharacterId(profile.name);
  if (!input.id) for (let n = 2; readCharacter(id); n++) id = slugCharacterId(profile.name).slice(0, 56) + '-' + n;
  const stamp = now();
  return writeCharacter({ ...profile, id, version: 1, status: 'active', references, createdAt: stamp, updatedAt: stamp }, 0);
}

/** Copies the references into a project as reference images, once per image, and returns the written brief. */
export async function useCharacterInProject(id: string, projectId: string) {
  const character = required(id);
  if (character.status !== 'active') throw new Error('Restore this character before using it');
  const project = await getProject({ projectId });
  if (!project || project.status !== 'active') throw new Error('Project not found');
  const assets = [];
  for (const reference of character.references) {
    const assetId = 'chr-' + createHash('sha256').update(projectId + ':' + character.id + ':' + reference.sha256).digest('hex').slice(0, 40);
    let asset = await getProjectAssetById({ projectId, assetId });
    if (!asset) {
      const bytes = await readBounded(referencePath(reference.sha256));
      if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new Error('A stored reference image is damaged');
      const filename = sanitizeLocalProjectAssetFilename({ filename: character.name + '-' + reference.role + '-' + reference.filename, mimeType: reference.mimeType });
      const persisted = await persistLocalProjectAsset({ projectId, assetId, filename, mimeType: reference.mimeType, bytes });
      await recordUserAsset({ id: assetId, type: 'image', source: 'upload', assetClass: 'original', storageProvider: LOCAL_PROJECT_ASSET_PROVIDER, bucket: LOCAL_PROJECT_ASSET_BUCKET,
        objectKey: persisted.objectKey, publicUrl: persisted.publicUrl, mimeType: reference.mimeType, sizeBytes: persisted.sizeBytes, sha256: persisted.sha256,
        filename: persisted.filename, width: reference.width, height: reference.height, originProjectId: projectId, metadata: { characterId: character.id, role: reference.role } });
      await linkProjectAsset({ projectId, assetId, role: 'reference', assetRole: 'character', metadata: { characterId: character.id, role: reference.role } });
      asset = await getProjectAssetById({ projectId, assetId });
    }
    assets.push({ assetId, role: reference.role, publicUrl: asset!.publicUrl });
  }
  return { character: { id: character.id, name: character.name, version: character.version }, brief: characterBrief(character), providerIdentities: character.providerIdentities, voice: character.voice ?? null, assets };
}

/** Shared by HTTP, MCP and CLI. Uploaded bytes are only accepted from the HTTP transport. */
export async function changeCharacters(request: CharacterRequest, uploads: UploadedReference[] = []) {
  switch (request.action) {
    case 'list': return { characters: readCharacters(request.includeArchived) };
    case 'get': return required(request.id);
    case 'create': return createCharacter(request, [...request.references, ...uploads]);
    case 'update': {
      const character = required(request.id);
      const profile = characterProfileSchema.parse({ ...pickProfile(character), ...request.profile });
      return writeCharacter(next(character, profile), request.expectedVersion);
    }
    case 'add_references': {
      const character = required(request.id);
      const sources = [...request.references, ...uploads];
      if (!sources.length) throw new Error('Add at least one reference image');
      const incoming = await Promise.all(sources.map(loadSource));
      if (incoming.some(item => item.role === 'canonical')) throw new Error('Use set_canonical to change the canonical image');
      return writeCharacter(next(character, { references: mergeReferences(character.references, incoming) }), request.expectedVersion);
    }
    case 'remove_reference': {
      const character = required(request.id);
      const target = character.references.find(item => item.sha256 === request.sha256);
      if (!target) throw new Error('Reference not found');
      if (target.role === 'canonical') throw new Error('Choose another canonical image before removing this one');
      return writeCharacter(next(character, { references: character.references.filter(item => item !== target) }), request.expectedVersion);
    }
    case 'set_canonical': {
      const character = required(request.id);
      if (!character.references.some(item => item.sha256 === request.sha256)) throw new Error('Reference not found');
      const references = character.references.map(item => item.sha256 === request.sha256 ? { ...item, role: 'canonical' as const } : item.role === 'canonical' ? { ...item, role: 'angle' as const } : item);
      return writeCharacter(next(character, { references }), request.expectedVersion);
    }
    case 'archive': {
      const character = required(request.id);
      return writeCharacter(next(character, { status: 'archived' }), request.expectedVersion);
    }
    case 'use': return useCharacterInProject(request.id, request.projectId);
  }
}

function pickProfile(character: Character): CharacterProfile {
  const { name, kind, description, invariants, forbidden, voice, providerIdentities } = character;
  return { name, kind, description, invariants, forbidden, ...(voice ? { voice } : {}), providerIdentities };
}

/** Bytes of a stored reference, verified against the character that lists it. */
export async function readCharacterReference(id: string, sha256: string) {
  const character = required(id);
  const reference = character.references.find(item => item.sha256 === sha256);
  if (!reference) throw new Error('Reference not found');
  return { reference, bytes: await readFile(referencePath(sha256)) };
}

