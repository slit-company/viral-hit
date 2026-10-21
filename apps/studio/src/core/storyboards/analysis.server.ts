import { getAnalysisRecord, listAnalysisRecords } from '../generation-providers/analysis-records.server';
import { buildAnalysisPlan } from './analysis-plan';
import { checkedMedia } from './media.server';
import type { AnalysisSources, PrepareAnalysis } from './analysis-input';

export async function listAnalysisSources(projectId: string): Promise<AnalysisSources> {
  const { records, hasOlder } = await listAnalysisRecords(projectId);
  return { hasOlder, sources: records.map(item => ({
    generationId: item.generationId, outputSha256: item.outputSha256, assetId: item.source.assetId, model: item.model,
    summary: item.report.summary, observations: item.report.observations.map(observation => ({ id: observation.id, start: observation.start, end: observation.end, title: observation.proposal?.title ?? observation.id })),
  })) };
}
export async function prepareAnalysisPlan(projectId: string, request: PrepareAnalysis) {
  const record = await getAnalysisRecord(projectId, request.analysis.generationId, request.analysis.outputSha256);
  const media = await checkedMedia(projectId, record.source.assetId, record.source.sha256);
  if (media.type !== 'video' || media.sizeBytes !== record.source.sizeBytes) throw Error('Analysis source changed');
  const plan = buildAnalysisPlan(request, record.report, { ...record.source, model: record.model, duration: (media.durationMs ?? 0) / 1000 });
  return { plan, warnings: ['Provider observations and shot proposals are machine output. Review their meaning, source ranges, directions and captions before saving.', 'This is an unsaved plan. No recipe, generation, accepted result or timeline edit was created.'] };
}
