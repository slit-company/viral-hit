import { getAnalysisRecord, listAnalysisRecords } from '../generation-providers/analysis-records.server';
import { buildAnalysisPlan } from './analysis-plan';
import { checkedMedia } from './media.server';
import type { AnalysisSources, PrepareAnalysis } from './analysis-input';
import { analysisSourceKey, observationSource } from '../generation-providers/analysis-source';
import type { VerifiedAnalysisSource } from './analysis-plan';

export async function listAnalysisSources(projectId: string): Promise<AnalysisSources> {
  const { records, hasOlder } = await listAnalysisRecords(projectId);
  return { hasOlder, sources: records.map(item => {
    const media = item.sources.map(source => ({ kind: source.kind, index: source.index, assetId: source.pin.assetId }));
    return {
      generationId: item.generationId, outputSha256: item.outputSha256, ...(media.length === 1 ? { assetId: media[0].assetId } : {}), model: item.model,
      reportVersion: item.report.schemaVersion, media, summary: item.report.summary,
      observations: item.report.observations.map(observation => {
        const source = media.find(source => analysisSourceKey(source) === analysisSourceKey(observationSource(observation)))!;
        return { id: observation.id, assetId: source.assetId, kind: source.kind, start: observation.start, end: observation.end, title: observation.proposal?.title ?? observation.id };
      }),
    };
  }) };
}
export async function prepareAnalysisPlan(projectId: string, request: PrepareAnalysis) {
  const record = await getAnalysisRecord(projectId, request.analysis.generationId, request.analysis.outputSha256);
  const sources: VerifiedAnalysisSource[] = [];
  // Every retained input influenced the report, including unselected companions. Verify sequentially.
  for (const source of record.sources) {
    const media = await checkedMedia(projectId, source.pin.assetId, source.pin.sha256);
    if (media.type !== source.kind || media.sizeBytes !== source.pin.sizeBytes) throw Error('Analysis source changed');
    sources.push({ kind: source.kind, index: source.index, assetId: source.pin.assetId, sha256: source.pin.sha256, ...(media.type !== 'image' ? { duration: (media.durationMs ?? 0) / 1000 } : {}) });
  }
  const plan = buildAnalysisPlan(request, record.report, sources, record.model);
  return { plan, warnings: ['Provider observations and shot proposals are machine output. Review their meaning, source ranges, directions and captions before saving.', ...(plan.references.some(reference => reference.startTime === undefined) ? ['Image observations without a proposed duration use an editable three-second shot.'] : []), 'This is an unsaved plan. No recipe, generation, accepted result or timeline edit was created.'] };
}
