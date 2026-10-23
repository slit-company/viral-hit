import { z } from 'zod';

/**
 * A model that edits part of an image or video declares maskInput. The mask is one project image
 * sent separately from references: white marks the area to change, black the area to keep.
 * Omission keeps the existing reference-only contract and runtime fingerprints.
 */
export const maskInputSchema = z.object({ required: z.boolean().default(false) }).strict();
export type MaskInput = z.infer<typeof maskInputSchema>;

type MaskReference = { assetId: string; role: string };

/** Shared admission rule for UI, HTTP, MCP, CLI and recipes, checked before any intent or upload. */
export function validateMaskReferences(references: readonly MaskReference[], maskInput: MaskInput | undefined, modelName: string) {
  const masks = references.filter(reference => reference.role === 'mask');
  if (masks.length && !maskInput) throw Error(modelName + ' does not accept a mask. Choose a model that edits a marked area.');
  if (masks.length > 1) throw Error('Use one mask per generation');
  if (maskInput?.required && !masks.length) throw Error(modelName + ' needs a mask marking the area to change');
  if (masks.length && !references.some(reference => reference.role !== 'mask')) throw Error('A mask needs the image or video it applies to');
  if (masks.length && references.some(reference => reference.role !== 'mask' && reference.assetId === masks[0].assetId)) throw Error('The mask must be a separate image from the media it edits');
}
