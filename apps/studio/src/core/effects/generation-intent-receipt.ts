import { and, eq, isNull, or } from 'drizzle-orm';
import { generationHistory, generationUploadIntent } from '@/config/db/schema';
import { getDb } from '@/core/workspace-lib/db-adapter';

type DbClient = Awaited<ReturnType<typeof getDb>>;

export async function completeGenerationUploadIntent({ intentId, generationId, now = new Date(), dbClient }: {
  intentId: string; generationId: string; now?: Date; dbClient?: DbClient;
}) {
  const db = dbClient ?? await getDb();
  const rows = await db.update(generationUploadIntent).set({
    status: 'consumed', generationId, consumedAt: now, updatedAt: now,
  }).where(and(
    eq(generationUploadIntent.id, intentId), eq(generationUploadIntent.status, 'submitting'),
    or(isNull(generationUploadIntent.generationId), eq(generationUploadIntent.generationId, generationId)),
  )).returning({ id: generationUploadIntent.id });
  return rows.length === 1;
}

/** Bind once, before provider execution. A consumed intent is never reassigned on recovery. */
export async function bindGenerationIntentReceipt({ intentId, projectId, effectId, generationId, dbClient }: {
  intentId: string; projectId: string; effectId: number; generationId: string; dbClient?: DbClient;
}) {
  const db = dbClient ?? await getDb();
  const [generation] = await db.select({ id: generationHistory.id }).from(generationHistory).where(and(
    eq(generationHistory.id, generationId), eq(generationHistory.projectId, projectId), eq(generationHistory.effectId, effectId),
  )).limit(1);
  if (!generation) throw Error('Generation receipt does not match its project and model');
  const bound = await db.update(generationUploadIntent).set({ generationId, updatedAt: new Date() }).where(and(
    eq(generationUploadIntent.id, intentId), eq(generationUploadIntent.projectId, projectId),
    eq(generationUploadIntent.effectId, effectId), eq(generationUploadIntent.status, 'submitting'),
    or(isNull(generationUploadIntent.generationId), eq(generationUploadIntent.generationId, generationId)),
  )).returning({ id: generationUploadIntent.id });
  if (bound.length !== 1) throw Error('Generation intent could not retain its original receipt; provider submission stopped');
}

/** Pure observation: no expiry mutation, provider polling, module import or authorization renewal. */
export async function readGenerationIntentReceipt({ intentId, projectId, dbClient }: {
  intentId: string; projectId: string; dbClient?: DbClient;
}) {
  const db = dbClient ?? await getDb();
  const [row] = await db.select({ intent: generationUploadIntent, generation: generationHistory })
    .from(generationUploadIntent).leftJoin(generationHistory, and(
      eq(generationHistory.id, generationUploadIntent.generationId),
      eq(generationHistory.projectId, generationUploadIntent.projectId),
      eq(generationHistory.effectId, generationUploadIntent.effectId),
    )).where(and(eq(generationUploadIntent.id, intentId), eq(generationUploadIntent.projectId, projectId))).limit(1);
  if (!row) throw Error('Generation intent not found in this project');
  if (row.intent.generationId && !row.generation) throw Error('Generation receipt is unavailable; do not resubmit this request');
  return row;
}
