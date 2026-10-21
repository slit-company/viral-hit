import { z } from 'zod';
import { recipeSchema, type Recipe } from './recipes';
import type { ReferenceInputs } from '../generation-providers/reference-inputs';

const count = z.number().int().min(0).max(20);
export const modelRecipeDefinition = recipeSchema.omit({ nodes: true, parameters: true }).extend({
  modelId: z.string().min(1).max(200),
  referenceCounts: z.object({ image: count, video: count, audio: count }).strict(),
  outputIndex: z.number().int().min(0).max(7).default(0),
});
export type ModelRecipeDefinition = z.infer<typeof modelRecipeDefinition>;
export type ModelRecipeModel = {
  id: string; name: string; providerId: string; kind: 'image' | 'video' | 'audio' | 'analysis';
  available: boolean; references: ReferenceInputs; digest: string;
  parameters: Recipe['parameters'];
};
