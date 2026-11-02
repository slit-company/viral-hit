import { eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { generationAssetLink, generationHistory } from '@/config/db/schema';
import { captionWordSchema, type CaptionWord } from '@/core/editor/caption-words';
import { getDb } from '@/core/workspace-lib/db-adapter';
import { getProjectAssetById } from '@/core/workspace-lib/assets/user-assets';

const speechWords = z.array(captionWordSchema).min(1).max(10_000);

/**
 * Word timing a voice provider returned with this audio asset (seconds from the start of the file),
 * or null when the asset was not generated with timing. Only this project's generations count.
 */
export async function readAssetSpeechWords({ projectId, assetId }: { projectId: string; assetId: string }): Promise<CaptionWord[] | null> {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset) throw new Error('Asset not found in this project.');
  if (asset.type !== 'audio') return null;
  const db = await getDb();
  const links = await db.select({ generationId: generationAssetLink.generationId }).from(generationAssetLink).where(eq(generationAssetLink.assetId, assetId)).limit(20);
  const generationIds = links.map((link: { generationId: string }) => link.generationId);
  const rows = await db.select({ projectId: generationHistory.projectId, output: generationHistory.output }).from(generationHistory)
    .where(generationIds.length ? or(eq(generationHistory.resultAssetId, assetId), inArray(generationHistory.id, generationIds)) : eq(generationHistory.resultAssetId, assetId))
    .limit(20);
  for (const row of rows as Array<{ projectId: string | null; output: unknown }>) {
    if (row.projectId !== projectId) continue;
    const output = typeof row.output === 'string' ? (() => { try { return JSON.parse(row.output as string); } catch { return null; } })() : row.output;
    const parsed = speechWords.safeParse((output as { speech_words?: unknown } | null)?.speech_words);
    if (parsed.success) return parsed.data;
  }
  return null;
}
