import { youtubeEngineIdentity } from '../references/engine-identity.server';
import { externalCatalog, externalConfigured } from './external-catalog';
import type { NodeSpec } from './durable';
import { isComfyConfigured } from './comfy-router';
import { comfyWorkflowUrl } from './comfy-workflow';

export const supportedOperations = () => new Set(['editor.sequence', 'reference.youtube', 'reference.sample', 'comfy.router', 'comfy.workflow', 'comfy.upload', 'asset.materialize', ...externalCatalog().map(entry => entry.descriptor.operation)]);
export const reconciliableOperations = () => ['comfy.workflow', ...externalCatalog().filter(entry => entry.descriptor.recovery === 'reconcile').map(entry => entry.descriptor.operation)];
export function runtimeCapabilities() {
  let workflow = false;
  try { workflow = Boolean(comfyWorkflowUrl()); } catch { /* Invalid server configuration stays unavailable. */ }
  return [
    { operation: 'editor.sequence', configured: true, label: 'Editable sequence', configuration: null, generation: false, reconciliation: false },
    { operation: 'reference.youtube', configured: Boolean(youtubeEngineIdentity()), label: 'YouTube reference intake', configuration: 'VIRAL_HIT_YOUTUBE_ENGINE', generation: false, reconciliation: false },
    { operation: 'reference.sample', configured: true, label: 'Project video references', configuration: null, generation: false, reconciliation: false, assetInputs: [{ id: 'source', pointer: '/assetId', kind: 'video' as const, maxBytes: 256 * 1024 * 1024 }] },
    ...externalCatalog().map(entry => ({ operation: entry.descriptor.operation, configured: externalConfigured(entry), label: entry.descriptor.label, configuration: entry.descriptor.configuration.filter(item => item.required).map(item => item.name).join(', ') || null, generation: entry.descriptor.generation, reconciliation: entry.descriptor.recovery === 'reconcile', external: true, version: entry.descriptor.version, author: entry.descriptor.author, license: entry.descriptor.license, recovery: entry.descriptor.recovery, inputSchema: entry.descriptor.inputSchema, assetInputs: entry.descriptor.assetInputs ?? [] })),
    { operation: 'comfy.upload', configured: workflow, label: 'ComfyUI image inputs', configuration: 'VIRAL_HIT_COMFYUI_URL', generation: false, reconciliation: false },
    { operation: 'comfy.router', configured: isComfyConfigured(), label: 'Comfy Router', configuration: 'COMFY_API_KEY', generation: true, reconciliation: false },
    { operation: 'comfy.workflow', configured: workflow, label: 'Your ComfyUI server', configuration: 'VIRAL_HIT_COMFYUI_URL', generation: true, reconciliation: true },
    { operation: 'asset.materialize', configured: true, label: 'Local media import', configuration: null, generation: false, reconciliation: false },
  ];
}
export function unavailableOperations() { return runtimeCapabilities().filter(capability => !capability.configured).map(capability => capability.operation); }
export function assertRuntimeConfigured(nodes: Pick<NodeSpec, 'operation'>[]) {
  const capabilities = runtimeCapabilities();
  for (const node of nodes) {
    const capability = capabilities.find(capability => capability.operation === node.operation);
    if (!capability) throw new Error(`Unsupported operation: ${node.operation}`);
    if (!capability.configured) throw new Error(node.operation === 'comfy.workflow' || node.operation === 'comfy.upload' ? 'Choose a ComfyUI server in Runs → Connections, or set VIRAL_HIT_COMFYUI_URL, before queueing.' : `Configure ${capability.configuration} on the server before queuing ${capability.label}`);
  }
}
