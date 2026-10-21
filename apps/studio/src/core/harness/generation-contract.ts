import { z } from 'zod';
import { generationReferenceRoleSchema } from '../commands/generation-contract';
import { projectMediaPin } from './project-media-input-schema';

const pendingMedia = z.object({ projectId: z.null(), assetId: z.null(), kind: z.null(), sha256: z.null(), sizeBytes: z.null() }).strict();
export const generationRuntimePin = z.object({
  projectId: z.string().min(1).max(160), providerId: z.string().min(1).max(200),
  effectId: z.number().int(), digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const generationModelInput = z.object({
  schemaVersion: z.literal(1), mode: z.enum(['image', 'video', 'audio', 'analysis']),
  modelId: z.string().min(1).max(200), prompt: z.string().max(20_000),
  references: z.array(z.object({
    assetId: z.string().min(1).max(128), kind: z.enum(['image', 'video', 'audio']),
    role: generationReferenceRoleSchema.default('reference'),
  }).strict()).max(20).default([]),
  parameters: z.record(z.string(), z.json()).default({}),
  outputIndex: z.number().int().min(0).max(7).default(0),
  runtime: generationRuntimePin.optional(),
  pins: z.array(z.union([projectMediaPin, pendingMedia])).max(20).optional(),
}).strict().refine(input => input.mode !== 'analysis' || input.outputIndex === 0, 'Analysis has a single report output');
export type GenerationModelInput = z.infer<typeof generationModelInput>;
export function generationRequest(input: GenerationModelInput) {
  if (!input.runtime) throw Error('Generation model was not pinned before queueing');
  return { version: 2 as const, projectId: input.runtime.projectId, mode: input.mode, modelId: input.modelId,
    prompt: input.prompt, references: input.references.map(({ assetId, role }) => ({ assetId, role })), parameters: input.parameters };
}
