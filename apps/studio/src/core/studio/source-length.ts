import type { ModelControl, ModelOptionsDraft } from '../generation-providers/model-controls';

/** The shortest listed length that covers the source, or the longest when none does; null without lengths. */
export function coveringDuration(seconds: number, durations?: readonly string[] | null): `${number}s` | null {
  const supported = (durations ?? []).map(value => Number.parseInt(value, 10)).filter(Number.isFinite).sort((left, right) => left - right);
  if (!supported.length) return null;
  return `${supported.find(value => value >= seconds - 0.05) ?? supported[supported.length - 1]}s`;
}

/** The option services use for "how long the source clip is", rounded up. */
const SOURCE_LENGTH_OPTION = 'source_seconds';

/**
 * What a model that follows an attached video should be set to: an output length that covers the clip and
 * its source length option. Returns only what differs, so a person's later choice is not overwritten twice.
 */
export function fitToSourceVideo(seconds: number, model: { id: string; supportedDurations?: readonly string[] | null; controls?: readonly ModelControl[] | null },
  draft: { duration?: string | null; modelOptions?: ModelOptionsDraft | null }) {
  const patch: { duration?: `${number}s`; modelOptions?: ModelOptionsDraft } = {};
  const duration = coveringDuration(seconds, model.supportedDurations);
  if (duration && duration !== draft.duration) patch.duration = duration;
  const control = model.controls?.find(item => item.key === SOURCE_LENGTH_OPTION);
  if (control?.type === 'number') {
    const value = Math.min(control.max, Math.max(control.min, Math.ceil(seconds - 0.001)));
    const values = draft.modelOptions?.modelId === model.id ? draft.modelOptions.values : {};
    if (values[SOURCE_LENGTH_OPTION] !== value) patch.modelOptions = { modelId: model.id, values: { ...values, [SOURCE_LENGTH_OPTION]: value } };
  }
  return Object.keys(patch).length ? patch : null;
}
