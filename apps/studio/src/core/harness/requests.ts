import { z } from 'zod';
import { routerInput } from './comfy-router';

export const runRequest = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('enqueue'), requestKey: z.string().trim().min(1).max(200),
    nodes: z.array(z.object({
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
      operation: z.literal('comfy.router'), version: z.string().min(1).max(200),
      input: routerInput, dependsOn: z.array(z.string()).max(256).optional(),
      bindings: z.array(z.object({ target: z.string().max(1024), node: z.string().max(128), pointer: z.string().max(1024) }).strict()).max(128).optional(),
      // Native receipts may contain expiring URLs. They are never media cache entries.
      cache: z.literal(false).optional(),
    }).strict()).min(1).max(256),
  }).strict(),
  z.object({ action: z.literal('recipe'), recipeId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), requestKey: z.string().trim().min(1).max(200), values: z.record(z.string(), z.json()) }).strict(),
  z.object({ action: z.enum(['cancel', 'retry']), runId: z.string().uuid() }).strict(),
]);
