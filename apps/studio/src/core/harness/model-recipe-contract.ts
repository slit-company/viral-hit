import { z } from 'zod';
import { recipeSchema, type Recipe } from './recipes';
import type { ReferenceInputs } from '../generation-providers/reference-inputs';

const count = z.number().int().min(0).max(20);
export const modelRecipeDefinition = recipeSchema.omit({ nodes: true, parameters: true }).extend({
  modelId: z.string().min(1).max(200),
  referenceCounts: z.object({ image: count, video: count, audio: count }).strict(),
  outputIndex: z.number().int().min(0).max(7).default(0),
  /** Adds a mask input for models with optional maskInput; models that require a mask always get one. */
  mask: z.boolean().optional(),
});
export type ModelRecipeDefinition = z.infer<typeof modelRecipeDefinition>;
export type ModelRecipeModel = {
  id: string; name: string; providerId: string; kind: 'image' | 'video' | 'audio' | 'analysis';
  available: boolean; references: ReferenceInputs; digest: string;
  /** Present when the model edits a marked area. */
  mask?: { required: boolean };
  parameters: Recipe['parameters'];
};
