import { validateInstalledVisualInput } from './visual-input';
import { providerRuntimeDigest } from './task-pin.server';
import { validateInstalledAudioInput } from './audio-input';
import { resolveModelOptions } from '../model-controls';
import { managedRuntimeEntries } from '@/core/runtime-packages/snapshot.server';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import { providerSourceStamp } from './source-state.server';
import { VIDEO_ANALYSIS_MODEL_ID } from '@/core/effects/video-analysis';
import type { WorkspaceDuration } from '@/core/effects/effect-registry';
import { getWorkspaceEffectRegistryEntry, registerInstalledWorkspaceEffectEntry } from '@/core/effects/effect-registry';
import { registerInstalledWorkspaceMediaSchema } from '@/core/effects/workspace-media';
import { findGenerationModelBinding, getGenerationProviderMetadata, registerInstalledGenerationProviderMetadata } from '../catalog';
import type { GenerationProviderMetadata } from '../contracts';
import { registerGenerationProvider } from '../registry';
import { installedEffectId, providerManifestSchema, type ProviderManifest } from './manifest';
import { validateInstalledAnalysisInput } from './analysis-input';
import { InstalledProviderAdapter, InstalledProviderRuntime } from './runtime.server';

export type InstalledProviderSummary = Pick<ProviderManifest, 'id' | 'label' | 'scope' | 'author' | 'license' | 'description' | 'environment' | 'referenceDelivery'> & { models: { id: string; name: string; kind: 'image' | 'video' | 'audio' | 'analysis' }[] };
export type InstalledProviderProblem = { location: string; message: string };

class ProviderLoadError extends Error {}
const problemMessage = (error: unknown) => error instanceof z.ZodError
  ? error.issues.slice(0, 4).map(issue => (issue.path.join('.') || 'manifest') + ': ' + issue.code).join('; ')
  : error instanceof ProviderLoadError ? error.message : 'Provider files are unreadable or invalid. Run provider check on the server for details.';

export function missingProviderEnvironment(manifest: Pick<ProviderManifest, 'environment'>) {
  return manifest.environment.filter(name => !process.env[name]?.trim());
}
function assertProviderConfigured(manifest: ProviderManifest) {
  const missing = missingProviderEnvironment(manifest);
  if (missing.length) throw new Error('Configure ' + missing.join(', ') + ' on the server before using ' + manifest.label);
}

/** Reads and checks one provider folder without registering anything. */
export function readProviderFolder(path: string) {
  const manifestPath = join(path, 'provider.json'), info = lstatSync(manifestPath);
  if (!info.isFile() || info.size < 1 || info.size > 64_000) throw new ProviderLoadError('provider.json must be a regular file of at most 64 KB');
  const manifest = providerManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (manifest.id !== basename(path)) throw new ProviderLoadError('Folder ' + basename(path) + ' must match provider id ' + manifest.id);
  const entryPath = join(path, manifest.entry);
  const entry = lstatSync(entryPath, { throwIfNoEntry: false });
  if (!entry?.isFile()) throw new ProviderLoadError('Missing provider module ' + manifest.entry);
  if (entry.size < 1 || entry.size > 5 * 1024 * 1024) throw new ProviderLoadError('Provider module must contain 1 byte to 5 MB');
  // One self-contained file: node: built-ins work, other dependencies must be bundled into it.
  return { manifest, source: readFileSync(entryPath, 'utf8') };
}

function install({ manifest, source }: ReturnType<typeof readProviderFolder>, managed = false): InstalledProviderSummary {
  if (getGenerationProviderMetadata(manifest.id)) throw new ProviderLoadError('Provider id ' + manifest.id + ' is already used');
  const modelBindings = manifest.models.map(model => ({ modelId: model.id, ...(model.controls ? { controls: model.controls } : {}), ...(model.analysisInputs ? { analysisInputs: model.analysisInputs } : {}), ...(model.referenceInputs ? { referenceInputs: model.referenceInputs } : {}), ...(model.maskInput ? { maskInput: model.maskInput } : {}), kind: model.kind, name: model.name, effectId: installedEffectId(manifest.id, model.id), upstreamModelId: model.upstreamModelId ?? model.id, uploadPath: '', imageBucketName: '' }));
  // Check every model before registering anything, so a rejected provider leaves no partial state.
  for (const binding of modelBindings) {
    if (binding.modelId === VIDEO_ANALYSIS_MODEL_ID || getWorkspaceEffectRegistryEntry(binding.modelId) || findGenerationModelBinding({ modelId: binding.modelId })) throw new ProviderLoadError('Model id ' + binding.modelId + ' is already used');
    if (findGenerationModelBinding({ effectId: binding.effectId })) throw new ProviderLoadError('Model ' + binding.modelId + ' collides with another installed model; rename it');
  }
  const metadata: GenerationProviderMetadata = { id: manifest.id, label: manifest.label, ...(manifest.referenceDelivery ? { referenceDelivery: manifest.referenceDelivery } : {}), supports: [...new Set(manifest.models.map(model => model.kind))], modelBindings };
  registerInstalledGenerationProviderMetadata(metadata);
  for (const model of manifest.models) {
    if (model.kind === 'analysis') continue;
    registerInstalledWorkspaceEffectEntry({
      id: model.id, name: model.name, workspaceType: model.kind === 'image' ? 'ai-image' : model.kind === 'audio' ? 'ai-audio' : 'ai-video', routeSlug: null,
      supportedAspectRatios: [...model.aspectRatios], defaultAspectRatio: model.defaultAspectRatio ?? model.aspectRatios[0],
      ...(model.durations ? { supportedDurations: model.durations as WorkspaceDuration[], defaultDuration: (model.defaultDuration ?? model.durations[0]) as WorkspaceDuration } : {}),
      requiresImageInput: model.referenceInputs ? model.referenceInputs.image.min > 0 : model.requiresImageInput,
    });
    const section = (kind: 'image' | 'video' | 'audio') => {
      const max = model.referenceInputs?.[kind].max ?? (kind === 'image' ? model.maxReferenceImages : 0);
      return { max, slots: Array.from({ length: max }, () => ({ kind: `reference-${kind}` as const })) };
    };
    registerInstalledWorkspaceMediaSchema(model.id, { image: section('image'), video: section('video'), audio: section('audio') });
  }
  const runtime = new InstalledProviderRuntime(manifest, source, managed);
  registerGenerationProvider({ ...metadata, executionIdentity: () => providerRuntimeDigest(manifest, source), assertConfigured: async () => assertProviderConfigured(manifest), isConfigured: () => !missingProviderEnvironment(manifest).length, createAdapter: effect => new InstalledProviderAdapter(effect, runtime), readOutputMedia: runtime.readOutputMedia, validateInput: (effect, input) => { const model = manifest.models.find(model => model.id === effect.linkName); if (effect.type === 3) validateInstalledAnalysisInput(input, model?.analysisInputs); if (effect.type === 4) validateInstalledAudioInput(input, model?.referenceInputs); if (model && (effect.type === 1 || effect.type === 2)) validateInstalledVisualInput(input, model); resolveModelOptions(model?.controls, input.provider_options); } });
  const { id, label, scope, author, license, description, environment, referenceDelivery } = manifest;
  return { id, label, scope, author, license, description, environment, ...(referenceDelivery ? { referenceDelivery } : {}), models: manifest.models.map(model => ({ id: model.id, name: model.name, kind: model.kind })) };
}

let loadedDirectory: string | undefined, sourceStamp = '';
let installed: { providers: InstalledProviderSummary[]; problems: InstalledProviderProblem[] } | null = null;

/**
 * Registers the generation providers in VIRAL_HIT_PROVIDERS_DIR once per server process, next to the
 * built-in provider. Their models join the Canvas and MCP model lists; a broken provider is reported and skipped.
 */
export function installGenerationProviders(directory = process.env.VIRAL_HIT_PROVIDERS_DIR?.trim() || undefined) {
  if (installed) return installed;
  const state: { providers: InstalledProviderSummary[]; problems: InstalledProviderProblem[] } = { providers: [], problems: [] };
  installed = state; loadedDirectory = directory; sourceStamp = providerSourceStamp(directory);
  const managed = managedRuntimeEntries('provider');
  if (!directory && !managed.length) return state;
  let folders: string[];
  try {
    folders = directory ? readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name).sort() : [];
  } catch {
    state.problems.push({ location: basename(directory ?? 'managed'), message: 'Providers folder not found.' });
    return state;
  }
  if (folders.length + managed.length > 32) { state.problems.push({ location: basename(directory ?? 'managed'), message: 'At most 32 generation providers may be installed' }); return state; }
  let bytes = 0;
  for (const folder of folders) {
    try {
      const files = readProviderFolder(resolve(directory!, folder));
      bytes += Buffer.byteLength(files.source);
      if (bytes > 8_000_000) { state.problems.push({ location: folder, message: 'Installed provider modules exceed 8 MB; remaining folders were not loaded' }); break; }
      state.providers.push(install(files));
    }
    catch (error) { state.problems.push({ location: folder, message: problemMessage(error) }); }
  }
  for (const entry of managed) {
    try {
      const manifest = providerManifestSchema.parse(entry.manifest);
      bytes += Buffer.byteLength(entry.source);
      if (bytes > 8_000_000) throw new ProviderLoadError('Combined provider modules exceed 8 MB');
      state.providers.push(install({ manifest, source: entry.source }, true));
    } catch(error) { state.problems.push({ location: String(entry.manifest.id), message: problemMessage(error) }); }
  }
  return state;
}

/** Describes the loaded snapshot; refreshing diagnostics does not replace executable registrations. */
export function generationProviderDiagnostics() {
  const state = installGenerationProviders();
  return { ...state, sourceChanged: (process.env.VIRAL_HIT_PROVIDERS_DIR?.trim() || undefined) !== loadedDirectory || providerSourceStamp(loadedDirectory) !== sourceStamp,
    providers: state.providers.map(provider => ({ ...provider, missingEnvironment: missingProviderEnvironment(provider) })) };
}
