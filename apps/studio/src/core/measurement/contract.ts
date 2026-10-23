import { z } from 'zod';

/** Lowercase snake_case so general and specialized sources can add their own measures. */
export const metricName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
/** Shared names come first in views; any other declared name is still accepted. */
export const STANDARD_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saves', 'replies', 'total_interactions', 'watch_time_seconds', 'average_view_seconds'] as const;
export const metricValues = z.record(metricName, z.number().finite().nonnegative().max(1e15))
  .refine(values => Object.keys(values).length <= 40, 'At most 40 metrics per observation');
export const metricDeclaration = z.object({ metrics: z.array(metricName).min(1).max(40).refine(names => new Set(names).size === names.length, 'Declare each metric once') }).strict();
export type MetricDeclaration = z.infer<typeof metricDeclaration>;

/** What a connector returns. Missing lists declared measures the source could not report this time. */
export const measurementResultSchema = z.object({
  metrics: metricValues, missing: z.array(metricName).max(40).default([]),
  observedAt: z.number().int().positive().optional(),
}).strict();
export type MeasurementResult = z.infer<typeof measurementResultSchema>;
export type MeasurementIssue = 'permission-missing' | 'not-found' | 'unavailable';
export const measurementIssue = z.enum(['permission-missing', 'not-found', 'unavailable']);
/** Throw from a connector when no measure could be read; the attempt is kept as an unavailable observation. */
export class MeasurementUnavailable extends Error {
  constructor(readonly issue: MeasurementIssue = 'unavailable') { super('Metrics are unavailable'); }
}

export type MeasurementState = 'complete' | 'partial' | 'unavailable';
export type MeasurementSnapshot = {
  id: string; projectId: string; publicationId: string; sequence: number;
  source: 'connector' | 'manual'; connector: string; connectorVersion: string; actor: string;
  state: MeasurementState; issue: MeasurementIssue | null; metrics: Record<string, number>; missing: string[];
  note: string | null; observedAt: number; collectedAt: number;
};

const publicationId = z.uuid();
export const measurementQuery = z.object({ publicationId: publicationId.optional() }).strict();
export const measurementRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('collect'), publicationId }).strict(),
  z.object({
    action: z.literal('record'), publicationId, requestKey: z.string().regex(/^[a-zA-Z0-9_.:-]{1,200}$/),
    metrics: metricValues.refine(values => Object.keys(values).length > 0, 'Enter at least one number'),
    observedAt: z.iso.datetime({ offset: true }), note: z.string().trim().max(500).optional(),
  }).strict(),
]);
export type MeasurementRequest = z.infer<typeof measurementRequest>;
export class MeasurementRequestError extends Error {
  constructor(readonly code: 'not-found' | 'invalid-input' | 'not-measurable' | 'runtime-unavailable' | 'conflict', message: string) { super(message); }
}

/** Standard measures first, then any others alphabetically. */
export function orderMetrics(names: Iterable<string>) {
  const unique = [...new Set(names)];
  const standard: readonly string[] = STANDARD_METRICS;
  return [...STANDARD_METRICS.filter(name => unique.includes(name)), ...unique.filter(name => !standard.includes(name)).sort()];
}
/** Difference for measures present in both observations. */
export function metricChange(latest: MeasurementSnapshot | null, previous: MeasurementSnapshot | null): Record<string, number> {
  if (!latest || !previous) return {};
  return Object.fromEntries(Object.entries(latest.metrics).filter(([name]) => name in previous.metrics).map(([name, value]) => [name, value - previous.metrics[name]]));
}
