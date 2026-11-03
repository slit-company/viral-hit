import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readSpending } from '@/core/costs/spending.server';
import { withToolErrors } from './tool-results';

export function registerSpendingTools(server: McpServer) {
  server.registerTool('viral_hit_spending', {
    description: 'What generation has cost recently, estimated from each model\'s published price when the request was sent (see viral_hit_generation_model_get pricing). Returns totals per currency (USD, credits, characters) for the workspace and per service, generation and failure counts (failed generations are listed but not counted as spent), and the most recent generations with model, status, estimate and whether an agent asked for them. days is 7, 30 or 90. Read-only.',
    inputSchema: z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withToolErrors(async ({ days }) => readSpending({ days })));
}
