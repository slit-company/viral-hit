import { z } from 'zod';
import { routerInput } from './comfy-router';

export const runRequest = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('enqueue'), requestKey: z.string().trim().min(1).max(200),
    nodes: z.array(z.object({
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
      operation: z.literal('comfy.router'), version: z.literal('1'),
      input: routerInput, dependsOn: z.array(z.string()).max(256).optional(),
      // Native receipts may contain expiring URLs. They are never media cache entries.
      cache: z.literal(false).optional(),
    }).strict()).min(1).max(256),
  }).strict(),
  z.object({ action: z.enum(['cancel', 'retry']), runId: z.string().uuid() }).strict(),
]);
