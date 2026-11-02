import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { providerBalances } from '@/core/generation-providers/installed/balance.server';
import { providerConnections } from '@/core/generation-providers/installed/connections.server';
import { withToolErrors } from './tool-results';

export function registerCreditTools(server: McpServer) {
  server.registerTool('viral_hit_service_credits', {
    description: 'Report remaining credit for each connected generation service: the balance the service itself reports (fal, Runway, ElevenLabs) or an out-of-credit state inferred from its last failed run. refresh re-checks services that have a balance API with read-only requests; nothing is generated. Cinema auto routing skips services that are out of credit, and any generation is refused before submission when the service reports zero. Keys and settings are never returned.',
    inputSchema: z.object({ refresh: z.boolean().optional() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, withToolErrors(async ({ refresh }) => {
    if (refresh) await providerBalances({ wait: true, maxAgeMs: 0 });
    return { services: (await providerConnections()).map(({ id, label, canCheckBalance, balance, credit, fields }) => ({
      id, label, connected: fields.every(field => field.source !== 'missing'), canCheckBalance,
      ...(balance ? { balance } : {}), ...(credit ? { credit } : {}),
    })) };
  }));
}
