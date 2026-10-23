const labels: Record<string, string> = {
  views: 'Views', reach: 'Reach', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', replies: 'Replies',
  total_interactions: 'Interactions', watch_time_seconds: 'Watch time (s)', average_view_seconds: 'Avg. view (s)',
};
/** Known names get a short label; contributed names are shown in sentence case. */
export const metricLabel = (name: string) => labels[name] ?? name.charAt(0).toUpperCase() + name.slice(1).replaceAll('_', ' ');
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const formatMetric = (value: number) => value >= 10_000 ? compact.format(value) : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
export const formatChange = (value: number) => (value > 0 ? '+' : value < 0 ? '−' : '±') + formatMetric(Math.abs(value));
