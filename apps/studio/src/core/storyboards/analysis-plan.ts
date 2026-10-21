import type { AnalysisReport } from '../generation-providers/analysis-report';
import { MAX_STORYBOARD_BYTES, storyboardPlan } from './contract';
import { prepareAnalysis, type PrepareAnalysis } from './analysis-input';

export function buildAnalysisPlan(raw: PrepareAnalysis, report: AnalysisReport, source: { assetId: string; sha256: string; model: string; duration: number }) {
  const request = prepareAnalysis.parse(raw);
  const selected = request.observationIds.map(id => {
    const observation = report.observations.find(item => item.id === id);
    if (!observation) throw Error('Selected observation is absent from this report');
    if (observation.end > source.duration) throw Error('Analysis observation exceeds the verified original duration');
    return observation;
  });
  const plan = storyboardPlan.parse({
    schemaVersion: 1, title: request.title, intent: request.intent, scope: request.scope, audio: [],
    references: selected.map((item, index) => ({
      id: 'analysis-' + (index + 1), assetId: source.assetId, sha256: source.sha256,
      startTime: item.start, endTime: item.end, observation: item.description, basis: 'inferred',
      evidence: { ...request.analysis, kind: 'provider-analysis', engine: source.model },
    })),
    shots: selected.map((item, index) => ({
      id: 'shot-' + (index + 1), title: item.proposal?.title ?? 'Analysis interval ' + (index + 1),
      direction: item.proposal?.direction ?? 'Review the source observation and describe the shot you want to create.',
      duration: item.proposal?.duration ?? Math.round((item.end - item.start) * 1000) / 1000,
      references: ['analysis-' + (index + 1)], preserve: item.proposal?.preserve ?? [], change: item.proposal?.change ?? [],
      avoid: item.proposal?.avoid ?? [], caption: item.proposal?.caption ?? '',
    })),
  });
  if (new TextEncoder().encode(JSON.stringify(plan)).byteLength > MAX_STORYBOARD_BYTES - 1024) throw Error('Selected analysis exceeds a savable plan; select fewer observations');
  return plan;
}
