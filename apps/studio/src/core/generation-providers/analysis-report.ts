import { z } from 'zod';
import { analysisSourceIdentity } from './analysis-source';

const text = z.string().trim().min(1).max(4000);
const time = z.number().finite().min(0).max(3600).multipleOf(.001);
const decisions = z.array(text).max(20).default([]);
/** Provider-independent observations and optional creative proposals, never executable instructions. */
const observationFields = {
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    description: text,
    proposal: z.object({
      title: z.string().trim().min(1).max(120), direction: text,
      duration: z.number().finite().min(.01).max(3600).optional(),
      preserve: decisions, change: decisions, avoid: decisions,
      caption: z.string().max(4000).default(''),
    }).strict().optional(),
};
// Keep v1's parsed key order stable: existing persisted report fingerprints include it.
const legacyObservation = z.object({ id: observationFields.id, start: time, end: time, description: text, proposal: observationFields.proposal }).strict().refine(item => Math.round(item.end * 1000) - Math.round(item.start * 1000) >= 10, 'Observation range must span at least 0.01 seconds');
const sourceObservation = z.object({ ...observationFields, source: analysisSourceIdentity, start: time.optional(), end: time.optional() }).strict().superRefine((item, ctx) => {
  if (item.source.kind === 'image') {
    if (item.start !== undefined || item.end !== undefined) ctx.addIssue({ code: 'custom', message: 'Still image observations have no time range' });
  } else if (item.start === undefined || item.end === undefined || Math.round(item.end * 1000) - Math.round(item.start * 1000) < 10) ctx.addIssue({ code: 'custom', message: 'Video/audio observation range must span at least 0.01 seconds' });
});
export const analysisReport = z.discriminatedUnion('schemaVersion', [
  z.object({ schemaVersion: z.literal(1), summary: text, observations: z.array(legacyObservation).min(1).max(64) }).strict(),
  z.object({ schemaVersion: z.literal(2), summary: text, observations: z.array(sourceObservation).min(1).max(64) }).strict(),
]).superRefine((report, ctx) => {
  if (new Set(report.observations.map(item => item.id)).size !== report.observations.length) ctx.addIssue({ code: 'custom', message: 'Observation IDs must be unique' });
  if (new TextEncoder().encode(JSON.stringify(report)).byteLength > 256_000) ctx.addIssue({ code: 'custom', message: 'Analysis report exceeds 256 KB' });
});
export type AnalysisReport = z.infer<typeof analysisReport>;
