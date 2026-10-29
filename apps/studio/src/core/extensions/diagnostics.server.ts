import { managedRuntimeSnapshot, runtimeRestartRequired } from '@/core/runtime-packages/snapshot.server';
import { readRuntimeCatalog, runtimeEntryId } from '@/core/runtime-packages/storage.server';
import { generationProviderDiagnostics } from '@/core/generation-providers/installed/install.server';
import { externalCatalog, externalConfigured } from '@/core/harness/external-catalog';
import { installedConnectorCatalog } from '@/core/publishing/installed/catalog.server';
import { getSkillRegistry } from '@/core/skills/library.server';
import type { ExtensionDiagnostics, ExtensionGroup, ExtensionKind } from './contract';

const presence = (names: string[]) => names.map(name => ({ name, present: Boolean(process.env[name]?.trim()) }));
const failure = (kind: ExtensionKind, refresh: 'restart' | 'live', message: string): ExtensionGroup => ({ kind, refresh, items: [], problems: [{ location: kind, message }] });

/** Read-only aggregation. Partial catalog failures never hide the other extension layers. No module import or network request. */
export async function extensionDiagnostics(): Promise<ExtensionDiagnostics> {
  const groups: ExtensionGroup[] = [];
  const loaded = managedRuntimeSnapshot(), desired = readRuntimeCatalog();
  const managed = new Set(loaded.packages.flatMap(pkg => pkg.entries.map(entry => entry.kind + ':' + runtimeEntryId(entry))));
  const changed = runtimeRestartRequired(desired);
  try {
    const catalog = generationProviderDiagnostics();
    groups.push({ kind: 'providers', refresh: 'restart', sourceChanged: catalog.sourceChanged, problems: catalog.problems,
      items: catalog.providers.map(provider => ({ id: provider.id, label: provider.label, description: provider.description, scope: provider.scope, source: managed.has('provider:' + provider.id) ? 'installed' : 'operator',
        state: provider.missingEnvironment.length ? 'needs-setup' : 'loaded', configuration: provider.environment.map(name => ({ name, present: !provider.missingEnvironment.includes(name) })),
        capabilities: provider.models.map(model => ({ id: model.id, label: model.name + ' · ' + model.kind })), issues: [] })) });
  } catch { groups.push(failure('providers', 'restart', 'Provider discovery failed. Check provider files on the server.')); }
  try {
    groups.push({ kind: 'adapters', refresh: 'restart', problems: [], items: externalCatalog().map(entry => ({
      id: entry.descriptor.operation, label: entry.descriptor.label, version: entry.descriptor.version, source: managed.has('adapter:' + entry.descriptor.operation) ? 'installed' : 'operator',
      state: externalConfigured(entry) ? 'loaded' : 'needs-setup', configuration: presence(entry.descriptor.configuration.filter(setting => setting.required).map(setting => setting.name)),
      capabilities: [{ id: entry.descriptor.operation, label: entry.descriptor.generation ? 'Generation workflow step' : 'Processing workflow step' }], issues: [],
    })) });
  } catch { groups.push(failure('adapters', 'restart', 'Execution adapter catalog could not load. Check manifests, module checksums and input schemas with the adapter CLI.')); }
  try {
    const catalog = installedConnectorCatalog();
    groups.push({ kind: 'publishing', refresh: 'live', problems: catalog.problems, items: catalog.connectors.map(connector => ({
      id: connector.id, label: connector.label, description: connector.description, scope: connector.scope, version: connector.version, source: managed.has('publishing:' + connector.id) ? 'installed' : 'operator',
      state: connector.configured ? 'loaded' : 'needs-setup', configuration: connector.missingEnvironment.map(name => ({ name, present: false })),
      capabilities: connector.destinations.map(destination => ({ id: destination.id, label: destination.label })), issues: [],
    })) });
  } catch { groups.push(failure('publishing', 'live', 'Publishing connector discovery failed. Check connector files on the server.')); }
  try {
    const catalog = (await getSkillRegistry()).catalog();
    groups.push({ kind: 'skills', refresh: 'live', problems: catalog.problems.map(problem => ({ location: problem.location, message: 'This ' + problem.source + ' skill could not load. Check its manifest, instructions and ID with the skill CLI.' })),
      items: catalog.skills.map(skill => ({ id: skill.manifest.id, label: skill.manifest.title, description: skill.manifest.summary, scope: skill.manifest.scope, version: skill.manifest.version,
        source: skill.source === 'local' ? 'operator' : skill.source, state: skill.compatible ? 'loaded' : 'needs-setup', configuration: [],
        capabilities: skill.manifest.compatibility.requiredMcpTools.map(name => ({ id: name, label: name })), issues: skill.incompatibilities })) });
  } catch { groups.push(failure('skills', 'live', 'Skill catalog could not load. Check the bundled and operator skill folders.')); }
  return { checkedAt: new Date().toISOString(), restartRequired: changed, groups };
}
