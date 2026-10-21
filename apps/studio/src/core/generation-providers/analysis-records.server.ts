import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { generationHistory } from '@/config/db/schema';
import { getDb } from '../workspace-lib/db-adapter';
import { getGenerationById } from '../effects/record-generation';
import { analysisReport } from './analysis-report';
import { parseLocalReference } from './local-reference';
import { singleAnalysisVideo } from './analysis-inputs';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
type AnalysisGenerationRow = { id: string; projectId: string | null; status: string; input: unknown; output: unknown };
function readRecord(record: AnalysisGenerationRow) {
  const input = object(record.input), provider = object(input._provider);
  const videoUrl = singleAnalysisVideo(input);
  if (record.status !== 'succeeded' || provider.kind !== 'analysis' || !videoUrl) return null;
  const source = parseLocalReference(videoUrl);
  const report = analysisReport.safeParse(object(record.output).analysis_report);
  if (!report.success || !source || source.kind !== 'video' || source.projectId !== record.projectId || typeof provider.id !== 'string' || typeof provider.modelId !== 'string') return null;
  const identity = { report: report.data, source, providerId: provider.id, modelId: provider.modelId };
  const outputSha256 = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return { ...identity, generationId: record.id, outputSha256, model: `${provider.id} / ${provider.modelId}`.slice(0, 200) };
}

/** Bounded discovery; direct lookup remains available for older generation IDs. */
export async function listAnalysisRecords(projectId: string) {
  const records: AnalysisGenerationRow[] = await (await getDb()).select().from(generationHistory).where(and(eq(generationHistory.projectId, projectId), eq(generationHistory.status, 'succeeded'))).orderBy(desc(generationHistory.createdAt)).limit(101);
  return { records: records.slice(0, 100).flatMap(record => { const result = readRecord(record); return result ? [result] : []; }), hasOlder: records.length > 100 };
}
export async function getAnalysisRecord(projectId: string, generationId: string, outputSha256: string) {
  const row = await getGenerationById({ id: generationId });
  const record = row?.projectId === projectId ? readRecord(row) : null;
  if (!record || record.outputSha256 !== outputSha256) throw Error('Analysis is unavailable, changed or belongs to another project');
  return record;
}
