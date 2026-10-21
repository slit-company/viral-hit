import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { extensionDiagnostics } from '@/core/extensions/diagnostics.server';
import { withToolErrors } from './tool-results';
export function registerExtensionTools(server: McpServer) {
  server.registerTool('viral_hit_extension_status', {
    description: 'Inspect installed generation providers, execution adapters, publishing connectors and skills. Reports declared configuration presence, compatibility and partial load failures without executing modules, contacting providers, or returning setting values. loaded means metadata loaded, not tested execution. Restart processes for provider/adapter file changes; refresh does not hot-reload them. Built-in integrations and account health are outside this report.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withToolErrors(async () => extensionDiagnostics()));
}
