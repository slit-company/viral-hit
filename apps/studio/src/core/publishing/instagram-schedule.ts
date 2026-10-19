/** Keep pending containers well inside Meta's 24-hour expiry. This is local orchestration, not a Meta schedule API. */
export const INSTAGRAM_PREPARATION_LEAD_MS = 10 * 60 * 1000;
export function instagramNotBefore(metadata: { publishAt?: string }, phase: 'start' | 'publish') {
  if (!metadata.publishAt) return null;
  const timestamp = Date.parse(metadata.publishAt);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid Instagram publication time');
  return phase === 'start' ? Math.max(0, timestamp - INSTAGRAM_PREPARATION_LEAD_MS) : timestamp;
}
export function validateInstagramSchedule(metadata: { publishAt?: string }, now = Date.now()) {
  const at = instagramNotBefore(metadata, 'publish');
  if (at !== null && at <= now) throw new Error('Choose a future Instagram publication time');
}
