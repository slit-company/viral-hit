import { readFile } from 'node:fs/promises';
import { installGenerationProviders, installedConnectionRuntime, missingProviderEnvironment } from '../generation-providers/installed/install.server';
import type { ProviderIdentity } from './contract';
import { readCharacter, referencePath, writeCharacter } from './storage.server';

type Runtime = Pick<NonNullable<ReturnType<typeof installedConnectionRuntime>>, 'manifest' | 'createIdentity' | 'checkIdentity'>;
const now = () => new Date().toISOString();

/** Installed services that train character identities, such as Higgsfield's Soul ID, and whether their settings are saved. */
export function identityServices() {
  return installGenerationProviders().providers.filter(provider => provider.identityTraining).map(provider => ({
    providerId: provider.id, label: provider.label, family: provider.identityTraining!.family, name: provider.identityTraining!.label,
    versions: provider.identityTraining!.versions, maxImages: provider.identityTraining!.maxImages, connected: !missingProviderEnvironment(provider).length,
  }));
}

function current(id: string, expectedVersion?: number) {
  const character = readCharacter(id);
  if (!character || character.status !== 'active') throw Error('Character not found');
  if (expectedVersion !== undefined && character.version !== expectedVersion) throw Error('This character changed since you opened it. Reload and try again.');
  return character;
}

/** Sends the character's reference images, main image first, to train one identity per service version; a retrain replaces it. */
export async function trainCharacterIdentity(request: { id: string; expectedVersion: number; providerId: string; version: string }, runtimeFor: (id: string) => Runtime | undefined = installedConnectionRuntime) {
  const character = current(request.id, request.expectedVersion), runtime = runtimeFor(request.providerId), training = runtime?.manifest.identityTraining;
  if (!runtime || !training) throw Error('This service does not train character identities');
  const ordered = [...character.references].sort((left, right) => Number(right.role === 'canonical') - Number(left.role === 'canonical')).slice(0, training.maxImages);
  const images = await Promise.all(ordered.map(async reference => ({ bytes: new Uint8Array(await readFile(referencePath(reference.sha256))), mimeType: reference.mimeType })));
  const result = await runtime.createIdentity({ name: character.name, version: request.version, images });
  const versionLabel = training.versions.find(item => item.value === request.version)?.label ?? request.version;
  const identity: ProviderIdentity = { provider: training.family, referenceId: result.referenceId, label: (training.label + ' · ' + versionLabel).slice(0, 80), providerId: request.providerId, version: request.version, status: result.status, ...(result.error ? { error: result.error } : {}) };
  const kept = character.providerIdentities.filter(item => !(item.provider === training.family && (item.version ?? '') === request.version));
  const saved = writeCharacter({ ...character, providerIdentities: [...kept, identity].slice(-8), version: character.version + 1, updatedAt: now() }, character.version);
  return { character: saved, identity };
}

/** Asks the service that trained an identity how it is going and records a change. */
export async function checkCharacterIdentity(request: { id: string; referenceId: string }, runtimeFor: (id: string) => Runtime | undefined = installedConnectionRuntime) {
  const character = current(request.id), identity = character.providerIdentities.find(item => item.referenceId === request.referenceId);
  if (!identity) throw Error('This character has no such identity');
  if (!identity.providerId) return { character, identity };
  const runtime = runtimeFor(identity.providerId);
  if (!runtime) throw Error('Connect the service that trained this identity to check it');
  const result = await runtime.checkIdentity(identity.referenceId);
  const next: ProviderIdentity = { ...identity, status: result.status, ...(result.error ? { error: result.error } : {}) };
  if (!result.error) delete next.error;
  if (JSON.stringify(next) === JSON.stringify(identity)) return { character, identity };
  const saved = writeCharacter({ ...character, providerIdentities: character.providerIdentities.map(item => item.referenceId === identity.referenceId ? next : item), version: character.version + 1, updatedAt: now() }, character.version);
  return { character: saved, identity: next };
}
