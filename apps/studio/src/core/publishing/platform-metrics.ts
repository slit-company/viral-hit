import { z } from 'zod';
import { MeasurementUnavailable, type MeasurementResult } from '../measurement/contract';

const count = z.string().regex(/^\d{1,15}$/).transform(Number);
export const youtubeStatisticsSchema = z.object({ items: z.array(z.object({ id: z.string(),
  statistics: z.object({ viewCount: count.optional(), likeCount: count.optional(), commentCount: count.optional() }) })).max(1) });
export type YouTubeStatistics = z.infer<typeof youtubeStatisticsSchema>['items'][number]['statistics'];
const youtubeNames = [['viewCount', 'views'], ['likeCount', 'likes'], ['commentCount', 'comments']] as const;
export const YOUTUBE_METRICS = youtubeNames.map(([, name]) => name);

/** Hidden like counts are reported as missing, not zero. */
export function youtubeMeasurement(statistics: YouTubeStatistics): MeasurementResult {
  const metrics: Record<string, number> = {}, missing: string[] = [];
  for (const [remote, name] of youtubeNames) if (statistics[remote] === undefined) missing.push(name); else metrics[name] = statistics[remote]!;
  if (!Object.keys(metrics).length) throw new MeasurementUnavailable('not-found');
  return { metrics, missing };
}

// Graph insight names per media kind; saved is normalized to the shared saves name.
const instagramNames = {
  reel: [['views', 'views'], ['reach', 'reach'], ['likes', 'likes'], ['comments', 'comments'], ['shares', 'shares'], ['saved', 'saves'], ['total_interactions', 'total_interactions']],
  story: [['views', 'views'], ['reach', 'reach'], ['replies', 'replies'], ['shares', 'shares'], ['total_interactions', 'total_interactions']],
} as const;
export const instagramMetricNames = (kind: 'reel' | 'story') => instagramNames[kind].map(([, name]) => name);
export const instagramInsightRequest = (kind: 'reel' | 'story') => instagramNames[kind].map(([remote]) => remote);
export const instagramInsightsSchema = z.object({ data: z.array(z.object({ name: z.string().max(80),
  values: z.array(z.object({ value: z.number().finite().nonnegative() }).passthrough()).max(4).optional(),
  total_value: z.object({ value: z.number().finite().nonnegative() }).passthrough().optional() }).passthrough()).max(40) }).passthrough();

export function instagramMeasurement(kind: 'reel' | 'story', raw: unknown): MeasurementResult {
  const data = instagramInsightsSchema.parse(raw).data, metrics: Record<string, number> = {}, missing: string[] = [];
  for (const [remote, name] of instagramNames[kind]) {
    const item = data.find(entry => entry.name === remote), value = item?.total_value?.value ?? item?.values?.[0]?.value;
    if (value === undefined) missing.push(name); else metrics[name] = value;
  }
  if (!Object.keys(metrics).length) throw new MeasurementUnavailable('not-found');
  return { metrics, missing };
}
