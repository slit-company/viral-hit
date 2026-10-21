import { runtimePackageRequest } from '@/core/runtime-packages/contract';
import { requestRuntimePackages } from '@/core/runtime-packages/requests.server';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { extensionDiagnostics } from '@/core/extensions/diagnostics.server';
import { withToolErrors } from './tool-results';
export function registerExtensionTools(server: McpServer) {
  server.registerTool('viral_hit_runtime_package', {
    description: 'Fetch a public HTTPS/GitHub runtime JSON (up to 12 MB, optionally pinned by expectedSha256) for inspection without installing or executing it; returns raw-byte download receipt alongside canonical review digests. Inspect, install/update, remove and export retained executable runtime packages for general or specialized providers, workflow adapters and publishing connectors. Review full source, manifests, diffs and blocking conflicts. Apply only with explicit trustCode:true and both reviewed digests. Install executes no code and fetches no dependencies. Modules are trusted host code, not sandboxed. Restart studio/MCP/workers together to activate changes; old pinned jobs may require restoring their original release/configuration. List distinguishes desired and this process loaded state. Removing retains releases, projects and jobs.',
    inputSchema: z.object({ request: runtimePackageRequest }).strict(),
    annotations: { readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true },
  }, withToolErrors(({request}) => requestRuntimePackages(request)));

  server.registerTool('viral_hit_extension_status', {
    description: 'Inspect installed generation providers, execution adapters, publishing connectors and skills. Reports declared configuration presence, compatibility and partial load failures without executing modules, contacting providers, or returning setting values. loaded means metadata loaded, not tested execution. Restart processes for provider/adapter file changes; refresh does not hot-reload them. Built-in integrations and account health are outside this report.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withToolErrors(async () => extensionDiagnostics()));
}
