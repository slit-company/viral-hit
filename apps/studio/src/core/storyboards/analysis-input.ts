import { z } from 'zod';
export const analysisIdentity = z.object({ generationId: z.string().uuid(), outputSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const analysisEvidence = z.object({ ...analysisIdentity.shape, kind: z.literal('provider-analysis'), engine: z.string().min(1).max(200) }).strict();
export const prepareAnalysis = z.object({
  action: z.literal('prepare-analysis'), analysis: analysisIdentity,
  observationIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)).min(1).max(16).refine(ids => new Set(ids).size === ids.length, 'Choose distinct observations'),
  title: z.string().trim().min(1).max(120), intent: z.string().trim().min(1).max(4000), scope: z.enum(['general', 'specialized']),
}).strict();
export type PrepareAnalysis = z.infer<typeof prepareAnalysis>;
export type AnalysisSource = z.infer<typeof analysisIdentity> & { assetId: string; model: string; summary: string; observations: { id: string; start: number; end: number; title: string }[] };
export type AnalysisSources = { sources: AnalysisSource[]; hasOlder: boolean };
