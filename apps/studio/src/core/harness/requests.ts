import { externalOperation } from './external-catalog';
import { z } from 'zod';
import { workflowInput } from './comfy-workflow';
import { routerInput } from './comfy-router';
import { materializeInput } from './materialize';
import { uploadInput } from './comfy-upload';

const nodeBase = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), version: z.string().min(1).max(200),
  dependsOn: z.array(z.string()).max(256).optional(),
  bindings: z.array(z.object({ target: z.string().max(1024), node: z.string().max(128), pointer: z.string().max(1024) }).strict()).max(128).optional(),
  // Cache integrity checks across runs are not implemented yet.
  cache: z.literal(false).optional(),
};
const builtinNodeSchema = z.discriminatedUnion('operation', [
  z.object({ ...nodeBase, operation: z.literal('comfy.upload'), input: uploadInput }).strict(),
  z.object({ ...nodeBase, operation: z.literal('comfy.router'), input: routerInput }).strict(),
  z.object({ ...nodeBase, operation: z.literal('comfy.workflow'), input: workflowInput }).strict(),
  z.object({ ...nodeBase, operation: z.literal('asset.materialize'), input: materializeInput }).strict(),
]);
export const runtimeNodeSchema = z.union([builtinNodeSchema, z.object({ ...nodeBase, operation: externalOperation, input: z.json() }).strict()]);
export const runRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enqueue'), requestKey: z.string().trim().min(1).max(200), nodes: z.array(runtimeNodeSchema).min(1).max(256) }).strict(),
  z.object({ action: z.literal('recipe'), recipeId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), requestKey: z.string().trim().min(1).max(200), values: z.record(z.string(), z.json()) }).strict(),
  z.object({ action: z.enum(['cancel', 'retry', 'reconcile']), runId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('take'), runId: z.string().uuid(), jobId: z.string().uuid(), clipId: z.string().min(1).max(160), expectedRevision: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal('attach'), runId: z.string().uuid(), jobId: z.string().uuid(), expectedRevision: z.number().int().min(0) }).strict(),
]);
