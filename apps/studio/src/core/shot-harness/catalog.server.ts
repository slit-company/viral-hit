import { and, desc, gte } from 'drizzle-orm';
import { getDb } from '@/core/workspace-lib/db-adapter';
import { generationHistory } from '@/config/db/schema';
import { getGenerationModelDescriptor } from '../generation-providers/model-catalog';
import { getWorkspaceModelsByType } from '../effects/workspace-models';
import { serviceHealth, type GenerationOutcome } from './health';
import type { ShotModel } from './spec';

const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

/** Recent results on this workspace, attributed to the service that ran them. */
async function recentOutcomes(): Promise<GenerationOutcome[]> {
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

/** Connected image and video models with the facts routing needs, from the same catalog Studio uses. */
export async function listShotModels(): Promise<ShotModel[]> {
  const health = serviceHealth(await recentOutcomes());
  return (['ai-image', 'ai-video'] as const).flatMap(type => getWorkspaceModelsByType(type).flatMap(model => {
    const descriptor = getGenerationModelDescriptor(model.id);
    if (!descriptor || descriptor.providerId === 'cloud-api') return [];
    return [{
      id: model.id, name: model.name, providerId: descriptor.providerId, providerLabel: descriptor.providerLabel,
      kind: type === 'ai-image' ? 'image' as const : 'video' as const, studioTasks: [...(descriptor.studioTasks ?? [])],
      referenceInputs: descriptor.referenceInputs, supportedDurations: model.supportedDurations ? [...model.supportedDurations] : undefined,
      videoImageInputs: descriptor.videoImageInputs,
      supportedAspectRatios: model.supportedAspectRatios ? [...model.supportedAspectRatios] : undefined,
      controls: descriptor.controls as ShotModel['controls'], available: descriptor.available,
      ...(health.has(descriptor.providerId) ? { health: health.get(descriptor.providerId) } : {}),
    }];
  }));
}
