import { balanceCheckedProviders, cachedProviderBalances, refreshProviderBalance } from './installed/balance.server';

const BALANCE_MAX_AGE_MS = 60_000;

/**
 * Refuses a paid submission when the service's own balance API reports no credits, so a doomed job
 * is never created. Unknown balances (no API, no billing access, check failed) never block.
 */
export async function assertServiceHasCredit(providerId: string, label: string) {
  if (!balanceCheckedProviders().includes(providerId)) return;
  let view = (await cachedProviderBalances()).get(providerId);
  if (!view || Date.now() - Date.parse(view.checkedAt) > BALANCE_MAX_AGE_MS) view = await refreshProviderBalance(providerId).catch(() => view);
  if (view?.state !== 'empty') return;
  const left = (view.amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + (view.unit ? ' ' + view.unit : '');
  throw new Error(`${label} has no credits left (${left}). Add credits to that account, then check the balance again in Connections.`);
}
