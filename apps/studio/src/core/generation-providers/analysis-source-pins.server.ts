import type { ProjectMediaPin } from '../harness/project-media-input-schema';
import type { AnalysisReport } from './analysis-report';
import { ANALYSIS_MEDIA_KINDS, singleAnalysisVideo } from './analysis-inputs';
import { analysisSourceKey, observationSource, type AnalysisSourceIdentity } from './analysis-source';
import { MAX_PROVIDER_TOTAL_MEDIA_BYTES, parseLocalReference } from './local-reference';

export type AnalysisSourcePin = AnalysisSourceIdentity & { pin: ProjectMediaPin };

/** Resolve only server-retained input pins; providers cannot supply asset IDs or substitute URLs. */
export function analysisSourcePins(projectId: string | null, input: Record<string, unknown>, report: AnalysisReport): AnalysisSourcePin[] | null {
  if (!projectId) return null;
  if (report.schemaVersion === 1) {
    const url = singleAnalysisVideo(input), pin = url ? parseLocalReference(url) : null;
    return pin?.kind === 'video' && pin.projectId === projectId ? [{ kind: 'video', index: 0, pin }] : null;
  }
  const sources: AnalysisSourcePin[] = [];
  for (const kind of ANALYSIS_MEDIA_KINDS) {
    const value = input[`${kind}_urls`];
    if (value !== undefined && (!Array.isArray(value) || value.length > 20)) return null;
    let urls = (value ?? []) as unknown[];
    const singular = input[`${kind}_url`];
    if (singular !== undefined) {
      if (kind !== 'video' || typeof singular !== 'string' || (urls.length && (urls.length !== 1 || urls[0] !== singular))) return null;
      if (!urls.length) urls = [singular];
    }
    for (const [index, url] of urls.entries()) {
      const pin = typeof url === 'string' ? parseLocalReference(url) : null;
      if (!pin || pin.projectId !== projectId || pin.kind !== kind) return null;
      sources.push({ kind, index, pin });
    }
  }
  if (!sources.length || sources.length > 20 || new Set(sources.map(source => source.pin.assetId)).size !== sources.length || sources.reduce((sum, source) => sum + source.pin.sizeBytes, 0) > MAX_PROVIDER_TOTAL_MEDIA_BYTES) return null;
  const keys = new Set(sources.map(analysisSourceKey));
  if (report.observations.some(item => !keys.has(analysisSourceKey(observationSource(item))))) return null;
  return sources;
}
