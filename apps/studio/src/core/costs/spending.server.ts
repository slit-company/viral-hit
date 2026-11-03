import { desc, gte } from 'drizzle-orm';
import { z } from 'zod';
import { generationHistory } from '@/config/db/schema';
import { getDb } from '@/core/workspace-lib/db-adapter';
import { getGenerationProviderMetadata } from '../generation-providers/catalog';
import { estimateGenerationStep } from './generation-cost.server';
import { PRICE_CURRENCIES, sumCosts, type CostEstimate, type CostTotal } from './pricing';

export const SPENDING_PERIODS = [7, 30, 90] as const;
const recorded = z.object({ amount: z.number().finite().min(0), currency: z.enum(PRICE_CURRENCIES), basis: z.enum(['list', 'average']) }).strict();
const provider = z.object({ id: z.string(), modelId: z.string(), name: z.string().optional() }).passthrough();

export type SpendingRow = { id: string; projectId: string | null; providerId: string; modelId: string; modelName: string; status: string; createdAt: string; cost: CostEstimate | null; agent: boolean };
export type SpendingService = { providerId: string; label: string; total: CostTotal; generations: number; failed: number };
export type SpendingView = { days: number; since: string; total: CostTotal; generations: number; failed: number; services: SpendingService[]; recent: SpendingRow[] };

/** The estimate saved when the generation was sent, or one from today's price for older records. */
function costOf(input: Record<string, unknown>, modelId: string): CostEstimate | null {
  const saved = recorded.safeParse(input._cost);
  return saved.success ? saved.data : estimateGenerationStep({ modelId, prompt: input.prompt, parameters: input });
}

/**
 * Spending from the generation history every Studio, Canvas, Cinema, dialogue and agent request writes.
 * Failed generations are listed but not counted as spent; running ones count, since most services charge on submission.
 */
export async function readSpending({ days = 30, limit = 30 }: { days?: number; limit?: number } = {}): Promise<SpendingView> {
  const since = new Date(Date.now() - days * 86_400_000);
  const db = await getDb();
  type Row = { id: string; projectId: string | null; status: string; input: unknown; createdAt: Date | null };
  const rows: Row[] = await db.select({ id: generationHistory.id, projectId: generationHistory.projectId, status: generationHistory.status, input: generationHistory.input, createdAt: generationHistory.createdAt })
    .from(generationHistory).where(gte(generationHistory.createdAt, since)).orderBy(desc(generationHistory.createdAt)).limit(5_000);
  const entries: SpendingRow[] = rows.flatMap(row => {
    const input = (row.input && typeof row.input === 'object' ? row.input : {}) as Record<string, unknown>;
    const meta = provider.safeParse(input._provider);
    if (!meta.success) return [];
    return [{ id: row.id, projectId: row.projectId ?? null, providerId: meta.data.id, modelId: meta.data.modelId, modelName: meta.data.name ?? meta.data.modelId, status: row.status,
      createdAt: (row.createdAt ?? new Date(0)).toISOString(), cost: costOf(input, meta.data.modelId), agent: Boolean(input._agent) }];
  });
  const counted = entries.filter(entry => entry.status !== 'failed');
  const services = [...new Set(entries.map(entry => entry.providerId))].map(providerId => {
    const mine = entries.filter(entry => entry.providerId === providerId);
    return { providerId, label: getGenerationProviderMetadata(providerId)?.label ?? providerId, total: sumCosts(mine.filter(entry => entry.status !== 'failed').map(entry => entry.cost)),
      generations: mine.length, failed: mine.filter(entry => entry.status === 'failed').length };
  }).sort((left, right) => right.generations - left.generations);
  return { days, since: since.toISOString(), total: sumCosts(counted.map(entry => entry.cost)), generations: entries.length, failed: entries.length - counted.length, services, recent: entries.slice(0, limit) };
}
