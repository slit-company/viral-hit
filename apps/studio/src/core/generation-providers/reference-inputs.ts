import { z } from 'zod';

export const REFERENCE_MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export type ReferenceMediaKind = typeof REFERENCE_MEDIA_KINDS[number];
const countRange = z.object({ min: z.number().int().min(0).max(20), max: z.number().int().min(0).max(20) }).strict()
  .refine(range => range.min <= range.max, 'Minimum cannot exceed maximum');
/** Optional metadata: omission must not change an existing manifest fingerprint. */
export const referenceInputsSchema = z.object({ image: countRange, video: countRange, audio: countRange }).strict().superRefine((inputs, ctx) => {
  const maximum = REFERENCE_MEDIA_KINDS.reduce((sum, kind) => sum + inputs[kind].max, 0);
  if (maximum < 1 || maximum > 20) ctx.addIssue({ code: 'custom', message: 'Reference inputs must allow between 1 and 20 total references' });
});
export type ReferenceInputs = z.infer<typeof referenceInputsSchema>;
export function resolveAudioReferenceInputs(declared?: ReferenceInputs): ReferenceInputs {
  return declared ?? { image: { min: 0, max: 0 }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 } };
}
export function validateReferenceCounts(counts: Record<ReferenceMediaKind, number>, inputs: ReferenceInputs, label: string) {
  for (const kind of REFERENCE_MEDIA_KINDS) {
    const { min, max } = inputs[kind];
    if (counts[kind] < min || counts[kind] > max) throw Error(`${label} requires ${min}–${max} ${kind} references; received ${counts[kind]}`);
  }
}
