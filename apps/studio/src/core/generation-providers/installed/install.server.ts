import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import type { WorkspaceDuration } from '@/core/effects/effect-registry';
import { getWorkspaceEffectRegistryEntry, registerInstalledWorkspaceEffectEntry } from '@/core/effects/effect-registry';
import { registerInstalledWorkspaceMediaSchema } from '@/core/effects/workspace-media';
import { findGenerationModelBinding, getGenerationProviderMetadata, registerInstalledGenerationProviderMetadata } from '../catalog';
import type { GenerationProviderMetadata } from '../contracts';
import { registerGenerationProvider } from '../registry';
import { installedEffectId, providerManifestSchema, type ProviderManifest } from './manifest';
import { InstalledProviderAdapter, InstalledProviderRuntime } from './runtime.server';

export type InstalledProviderSummary = Pick<ProviderManifest, 'id' | 'label' | 'scope' | 'author' | 'license' | 'description'> & { models: { id: string; name: string; kind: 'image' | 'video' }[] };
export type InstalledProviderProblem = { location: string; message: string };

const problemMessage = (error: unknown) => (error instanceof z.ZodError
  ? error.issues.slice(0, 4).map(issue => (issue.path.length ? issue.path.join('.') + ': ' : '') + issue.message).join('; ')
  : error instanceof Error ? error.message : 'Unreadable provider').slice(0, 500);

/** Reads and checks one provider folder without registering anything. */
export function readProviderFolder(path: string) {
  const manifest = providerManifestSchema.parse(JSON.parse(readFileSync(join(path, 'provider.json'), 'utf8')));
  if (manifest.id !== basename(path)) throw new Error('Folder ' + basename(path) + ' must match provider id ' + manifest.id);
  const entryPath = join(path, manifest.entry);
  const entry = lstatSync(entryPath, { throwIfNoEntry: false });
  if (!entry?.isFile()) throw new Error('Missing provider module ' + manifest.entry);
  if (entry.size > 5 * 1024 * 1024) throw new Error('Provider module is larger than 5 MB');
  // One self-contained file: node: built-ins work, other dependencies must be bundled into it.
  return { manifest, source: readFileSync(entryPath, 'utf8') };
}

function install(path: string): InstalledProviderSummary {
  const { manifest, source } = readProviderFolder(path);
  if (getGenerationProviderMetadata(manifest.id)) throw new Error('Provider id ' + manifest.id + ' is already used');
  const modelBindings = manifest.models.map(model => ({ modelId: model.id, effectId: installedEffectId(manifest.id, model.id), upstreamModelId: model.upstreamModelId ?? model.id, uploadPath: '', imageBucketName: '' }));
  // Check every model before registering anything, so a rejected provider leaves no partial state.
  for (const binding of modelBindings) {
    if (getWorkspaceEffectRegistryEntry(binding.modelId)) throw new Error('Model id ' + binding.modelId + ' is already used');
    if (findGenerationModelBinding({ effectId: binding.effectId })) throw new Error('Model ' + binding.modelId + ' collides with another installed model; rename it');
  }
  const metadata: GenerationProviderMetadata = { id: manifest.id, label: manifest.label, supports: [...new Set(manifest.models.map(model => model.kind))], modelBindings };
  registerInstalledGenerationProviderMetadata(metadata);
  for (const model of manifest.models) {
    registerInstalledWorkspaceEffectEntry({
      id: model.id, name: model.name, workspaceType: model.kind === 'image' ? 'ai-image' : 'ai-video', routeSlug: null,
      supportedAspectRatios: [...model.aspectRatios], defaultAspectRatio: model.defaultAspectRatio ?? model.aspectRatios[0],
      ...(model.durations ? { supportedDurations: model.durations as WorkspaceDuration[], defaultDuration: (model.defaultDuration ?? model.durations[0]) as WorkspaceDuration } : {}),
      requiresImageInput: model.requiresImageInput,
    });
    const slots = Array.from({ length: model.maxReferenceImages }, () => ({ kind: 'reference-image' as const }));
    registerInstalledWorkspaceMediaSchema(model.id, { image: { max: slots.length, slots }, video: { max: 0, slots: [] }, audio: { max: 0, slots: [] } });
  }
  const runtime = new InstalledProviderRuntime(manifest, source);
  registerGenerationProvider({ ...metadata, createAdapter: effect => new InstalledProviderAdapter(effect, runtime), readOutputMedia: runtime.readOutputMedia });
  const { id, label, scope, author, license, description } = manifest;
  return { id, label, scope, author, license, description, models: manifest.models.map(model => ({ id: model.id, name: model.name, kind: model.kind })) };
}

let installed: { providers: InstalledProviderSummary[]; problems: InstalledProviderProblem[] } | null = null;

/**
 * Registers the generation providers in VIRAL_HIT_PROVIDERS_DIR once per server process, next to the
 * built-in provider. Their models join the Canvas and MCP model lists; a broken provider is reported and skipped.
 */
export function installGenerationProviders(directory = process.env.VIRAL_HIT_PROVIDERS_DIR?.trim()) {
  if (installed) return installed;
  const state: { providers: InstalledProviderSummary[]; problems: InstalledProviderProblem[] } = { providers: [], problems: [] };
  installed = state;
  if (!directory) return state;
  let folders: string[];
  try {
    folders = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch {
    state.problems.push({ location: basename(directory), message: 'Providers folder not found.' });
    return state;
  }
  for (const folder of folders) {
    try { state.providers.push(install(resolve(directory, folder))); }
    catch (error) { state.problems.push({ location: folder, message: problemMessage(error) }); }
  }
  return state;
}
