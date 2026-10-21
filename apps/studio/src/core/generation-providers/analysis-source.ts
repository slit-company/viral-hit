import { z } from 'zod';

/** Zero-based position in the exact media-kind array supplied to the provider. */
export const analysisSourceIdentity = z.object({ kind: z.enum(['image', 'video', 'audio']), index: z.number().int().min(0).max(19) }).strict();
export type AnalysisSourceIdentity = z.infer<typeof analysisSourceIdentity>;
export const analysisSourceKey = (source: AnalysisSourceIdentity) => `${source.kind}:${source.index}`;
export const observationSource = (observation: { id: string; source?: AnalysisSourceIdentity }): AnalysisSourceIdentity => observation.source ?? { kind: 'video', index: 0 };
