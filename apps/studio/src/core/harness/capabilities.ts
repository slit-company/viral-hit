import type { NodeSpec } from './durable';
import { isComfyConfigured } from './comfy-router';
import { comfyWorkflowUrl } from './comfy-workflow';

export const supportedOperations = new Set(['comfy.router', 'comfy.workflow', 'comfy.upload', 'asset.materialize']);
export const reconciliableOperations = ['comfy.workflow'] as const;
export function runtimeCapabilities() {
  let workflow = false;
  try { workflow = Boolean(comfyWorkflowUrl()); } catch { /* Invalid server configuration stays unavailable. */ }
  return [
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
