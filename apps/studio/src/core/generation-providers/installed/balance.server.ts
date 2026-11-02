import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { getViralHitDataRoot } from '@/config/data-root';
import { installGenerationProviders, installedConnectionRuntime, missingProviderEnvironment } from './install.server';

/**
 * What the workspace knows about each service's remaining credits. Balances come from read-only
 * provider checks; "credits added" is the operator's statement that clears an inferred empty state
 * for services without a balance API. This is a cache, never a billing ledger.
 */
const balanceView = z.object({
  providerId: z.string().max(40),
  state: z.enum(['available', 'empty', 'unknown']),
  amount: z.number().finite().optional(),
  unit: z.string().max(16).optional(),
  reason: z.string().max(300).optional(),
  checkedAt: z.string().max(40),
}).strict();
export type ProviderBalanceView = z.infer<typeof balanceView>;
const statusFile = z.object({
  balances: z.record(z.string(), balanceView).default({}),
  creditsAddedAt: z.record(z.string(), z.string().max(40)).default({}),
}).strict();
type StatusFile = z.infer<typeof statusFile>;

const file = () => join(getViralHitDataRoot(), 'provider-status.json');
let writes: Promise<unknown> = Promise.resolve();
const inflight = new Map<string, Promise<ProviderBalanceView>>();

async function readStatus(): Promise<StatusFile> {
  try { return statusFile.parse(JSON.parse(await readFile(file(), 'utf8'))); }
  catch { return { balances: {}, creditsAddedAt: {} }; }
}

/** Serialized read-modify-write with an atomic rename; concurrent updates never interleave. */
function updateStatus(change: (status: StatusFile) => void) {
  const next = writes.then(async () => {
    const status = await readStatus();
    change(status);
    const path = file(), temporary = path + '.' + randomUUID() + '.tmp';
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, JSON.stringify(status), { mode: 0o600 });
    await rename(temporary, path);
  });
  writes = next.catch(() => undefined);
  return next;
}

/** Installed services that declare a balance check and have their settings saved. */
export function balanceCheckedProviders() {
  return installGenerationProviders().providers
    .filter(provider => provider.balanceCheck && provider.configurationDelivery === 'request' && !missingProviderEnvironment(provider).length)
    .map(provider => provider.id);
}

/** Asks one service for its balance now (read-only, bounded) and remembers the answer. */
export function refreshProviderBalance(providerId: string): Promise<ProviderBalanceView> {
  const running = inflight.get(providerId);
  if (running) return running;
  const task = (async () => {
    const runtime = installedConnectionRuntime(providerId);
    if (!runtime) throw Error('Provider connection is not installed');
    const checkedAt = new Date().toISOString();
    let view: ProviderBalanceView;
    try {
      const result = await runtime.checkBalance();
      view = result.state === 'known'
        ? { providerId, state: result.amount > 0 ? 'available' : 'empty', amount: result.amount, unit: result.unit, checkedAt }
        : { providerId, state: 'unknown', reason: result.reason, checkedAt };
    } catch (error) {
      view = { providerId, state: 'unknown', reason: (error instanceof Error ? error.message : 'Balance check failed').slice(0, 300), checkedAt };
    }
    await updateStatus(status => { status.balances[providerId] = view; });
    return view;
  })().finally(() => inflight.delete(providerId));
  inflight.set(providerId, task);
  return task;
}

/**
 * Known balances; stale ones (older than maxAgeMs) are re-checked. With wait=false the stale checks
 * run in the background and the cached answers are returned immediately (previews); wait=true is for
 * the moment before a paid submission.
 */
export async function providerBalances({ maxAgeMs = 120_000, wait = false }: { maxAgeMs?: number; wait?: boolean } = {}) {
  const status = await readStatus();
  const now = Date.now();
  const stale = balanceCheckedProviders().filter(id => {
    const known = status.balances[id];
    return !known || now - Date.parse(known.checkedAt) > maxAgeMs;
  });
  const checks = stale.map(id => refreshProviderBalance(id));
  if (!wait) {
    for (const check of checks) check.catch(() => undefined);
    return new Map(Object.entries(status.balances));
  }
  await Promise.allSettled(checks);
  return new Map(Object.entries((await readStatus()).balances));
}

export async function cachedProviderBalances() {
  return new Map(Object.entries((await readStatus()).balances));
}

/** The operator added credits: forget failures before now and the cached balance for this service. */
export async function markCreditsAdded(providerId: string) {
  if (!installedConnectionRuntime(providerId)) throw Error('Provider connection is not installed');
  const at = new Date().toISOString();
  await updateStatus(status => { status.creditsAddedAt[providerId] = at; delete status.balances[providerId]; });
  return { providerId, creditsAddedAt: at };
}

export async function creditsAddedTimes() {
  return new Map(Object.entries((await readStatus()).creditsAddedAt).map(([id, at]) => [id, Date.parse(at)] as const));
}
