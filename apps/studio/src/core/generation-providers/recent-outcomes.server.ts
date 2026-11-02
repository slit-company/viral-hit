import { and, desc, gte } from 'drizzle-orm';
import { getDb } from '@/core/workspace-lib/db-adapter';
import { generationHistory } from '@/config/db/schema';
import { getGenerationModelDescriptor } from './model-catalog';
import type { GenerationOutcome } from './service-credit';

const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

/** Recent results on this workspace, attributed to the service that ran them. */
export async function recentGenerationOutcomes(): Promise<GenerationOutcome[]> {
  const db = await getDb();
  const rows = await db.select({ status: generationHistory.status, error: generationHistory.error, params: generationHistory.submittedParams, at: generationHistory.createdAt })
    .from(generationHistory).where(and(gte(generationHistory.createdAt, new Date(Date.now() - RECENT_MS)))).orderBy(desc(generationHistory.createdAt)).limit(300);
  return rows.flatMap((row: { status: string; error: string | null; params: unknown; at: unknown }): GenerationOutcome[] => {
    if (row.status !== 'succeeded' && row.status !== 'failed') return [];
    let modelId = '';
    try { modelId = String((JSON.parse(String(row.params ?? '{}')) as { _source?: { logicalModelId?: unknown } })._source?.logicalModelId ?? ''); } catch { return []; }
    const providerId = getGenerationModelDescriptor(modelId)?.providerId;
    return providerId ? [{ modelId, providerId, succeeded: row.status === 'succeeded', error: row.error, at: new Date(row.at as unknown as number).getTime() }] : [];
  });
}
