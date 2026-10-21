import { readdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { providerManifestSchema, installedEffectId } from '@/core/generation-providers/installed/manifest';
import { readProviderFolder } from '@/core/generation-providers/installed/install.server';
import { WORKSPACE_EFFECT_REGISTRY } from '@/core/effects/effect-registry';
import { listGenerationProviders, isInstalledGenerationProvider } from '@/core/generation-providers/catalog';
import { readExternalCatalog, validateExternalEntry } from '@/core/harness/external-catalog';
import { readInstalledConnectors, validateConnectorSource } from '@/core/publishing/installed/catalog.server';
import { MAX_RUNTIME_PACKAGE_BYTES, runtimePackageSchema, type RuntimeEntry, type RuntimePackage } from './contract';
import { runtimeEntryId } from './storage.server';

export function validateRuntimePackage(raw: unknown): RuntimePackage {
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_RUNTIME_PACKAGE_BYTES) throw new Error('Runtime package exceeds 12 MB');
  const pkg = runtimePackageSchema.parse(raw);
  pkg.entries = pkg.entries.map(entry => {
    if (Buffer.byteLength(JSON.stringify(entry.manifest)) > 64_000) throw new Error('Runtime manifest exceeds 64 KB');
    let manifest;
    if (entry.kind === 'adapter') manifest = validateExternalEntry(entry.manifest,entry.source).descriptor;
    else if (entry.kind === 'publishing') manifest = validateConnectorSource(entry.manifest,entry.source).manifest;
    else {
      manifest = providerManifestSchema.parse(entry.manifest);
      if (Buffer.byteLength(entry.source) > 5 * 1024 * 1024) throw new Error('Provider module exceeds 5 MB');
    }
    return { ...entry, manifest: manifest as RuntimeEntry['manifest'] };
  });
  if (pkg.entries.reduce((sum,entry) => sum + Buffer.byteLength(entry.source),0) > 8_000_000) throw new Error('Runtime package source exceeds 8 MB');
  const keys = pkg.entries.map(entry => entry.kind + ':' + runtimeEntryId(entry));
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate runtime identity');
  return pkg;
}

/** Reads the current operator files without registering/importing a module or revealing environment values. */
export function operatorRuntimeEntries(): RuntimeEntry[] {
  const entries: RuntimeEntry[] = [];
  for (const entry of readExternalCatalog(process.env.VIRAL_HIT_ADAPTERS_DIR)) entries.push({ kind: 'adapter', manifest: entry.descriptor as RuntimeEntry['manifest'], source: entry.source });
  const directory = process.env.VIRAL_HIT_PROVIDERS_DIR?.trim();
  if (directory) {
    if (!isAbsolute(directory)) throw new Error('Provider directory must be absolute');
    const folders = readdirSync(directory, { withFileTypes:true }).filter(item => item.isDirectory() && !item.name.startsWith('.'));
    if (folders.length > 32) throw new Error('Too many operator provider folders');
    for (const folder of folders) { const entry = readProviderFolder(join(directory,folder.name)); entries.push({ kind:'provider',manifest:entry.manifest as RuntimeEntry['manifest'],source:entry.source }); }
  }
  const connectors = readInstalledConnectors(process.env.VIRAL_HIT_PUBLISHING_CONNECTORS_DIR?.trim(),false);
  if (connectors.problems.length) throw new Error('Operator publishing catalog is invalid; fix it before changing managed runtimes');
  for (const entry of connectors.entries) entries.push({ kind:'publishing',manifest:entry.manifest as RuntimeEntry['manifest'],source:entry.source });
  return entries;
}

export function runtimeConflicts(entries: RuntimeEntry[]) {
  const blocking: string[] = [], models = new Set(WORKSPACE_EFFECT_REGISTRY.map(model=>model.id));
  const effects = new Set<number>();
  const builtins = listGenerationProviders().filter(provider=>!isInstalledGenerationProvider(provider.id));
  for (const provider of builtins) for (const binding of provider.modelBindings) effects.add(binding.effectId);
  for (const kind of ['adapter','provider','publishing']) {
    const group = entries.filter(entry=>entry.kind===kind), ids = group.map(runtimeEntryId);
    if (new Set(ids).size !== ids.length) blocking.push('Duplicate '+kind+' identity across packages or operator files');
    if (group.length > 32 || group.reduce((sum,entry)=>sum+Buffer.byteLength(entry.source),0)>8_000_000) blocking.push(kind+' exceeds 32 entries or 8 MB source');
  }
  for (const entry of entries.filter(entry=>entry.kind==='provider')) {
    const manifest = providerManifestSchema.parse(entry.manifest);
    if (builtins.some(provider=>provider.id===manifest.id)) blocking.push('Provider ID is reserved: '+manifest.id);
    for (const model of manifest.models) {
      const effect = installedEffectId(manifest.id,model.id);
      if (models.has(model.id) || effects.has(effect)) blocking.push('Model identity is already used: '+model.id);
      models.add(model.id); effects.add(effect);
    }
  }
  return blocking;
}
