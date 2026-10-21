import type { AnalysisReport } from '../generation-providers/analysis-report';
import { MAX_STORYBOARD_BYTES, storyboardPlan } from './contract';
import { prepareAnalysis, type PrepareAnalysis } from './analysis-input';
import { analysisSourceKey, observationSource, type AnalysisSourceIdentity } from '../generation-providers/analysis-source';

export type VerifiedAnalysisSource = AnalysisSourceIdentity & { assetId: string; sha256: string; duration?: number };
export function buildAnalysisPlan(raw: PrepareAnalysis, report: AnalysisReport, sources: VerifiedAnalysisSource[], model: string) {
  const request = prepareAnalysis.parse(raw);
  const bySource = new Map(sources.map(source => [analysisSourceKey(source), source]));
  if (bySource.size !== sources.length) throw Error('Verified analysis sources must be distinct');
  const selected = request.observationIds.map(id => {
    const observation = report.observations.find(item => item.id === id);
    if (!observation) throw Error('Selected observation is absent from this report');
    const source = bySource.get(analysisSourceKey(observationSource(observation)));
    if (!source) throw Error('Observation source is absent from the verified originals');
    if (source.kind !== 'image' && (observation.start === undefined || observation.end === undefined || observation.end > (source.duration ?? 0))) throw Error('Analysis observation exceeds the verified original duration');
    return { observation, source };
  });
  const plan = storyboardPlan.parse({
    schemaVersion: 1, title: request.title, intent: request.intent, scope: request.scope, audio: [],
    references: selected.map(({ observation: item, source }, index) => ({
      id: 'analysis-' + (index + 1), assetId: source.assetId, sha256: source.sha256,
      ...(source.kind === 'image' ? {} : { startTime: item.start, endTime: item.end }), observation: item.description, basis: 'inferred',
      evidence: { ...request.analysis, kind: 'provider-analysis', engine: model, ...(report.schemaVersion === 2 ? { observationId: item.id, source: observationSource(item) } : {}) },
    })),
    shots: selected.map(({ observation: item, source }, index) => ({
      id: 'shot-' + (index + 1), title: item.proposal?.title ?? 'Analysis interval ' + (index + 1),
      direction: item.proposal?.direction ?? 'Review the source observation and describe the shot you want to create.',
      duration: item.proposal?.duration ?? (source.kind === 'image' ? 3 : Math.round((item.end! - item.start!) * 1000) / 1000),
      references: ['analysis-' + (index + 1)], preserve: item.proposal?.preserve ?? [], change: item.proposal?.change ?? [],
      avoid: item.proposal?.avoid ?? [], caption: item.proposal?.caption ?? '',
    })),
  });
  if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > MAX_STORYBOARD_BYTES - 1024) throw Error('Selected analysis exceeds a savable plan; select fewer observations');
  return plan;
}
