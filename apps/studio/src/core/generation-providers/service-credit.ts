/** Pure service health and credit state shared by Cinema routing, Connections and agents. */
export type GenerationOutcome = { modelId: string; providerId: string; succeeded: boolean; error: string | null; at: number };
export type ServiceHealth = { score: number; reason: string; outOfCredit?: boolean };
const BILLING = /credit|balance|insufficient|quota|billing|payment|top up|exceeded your/i;

/**
 * What this workspace recently learned about each service. A service whose latest result ran out of
 * credit sinks below services that work; one that worked recently gets a small lift. Outcomes are read
 * newest first and only the latest outcome per service decides. Outcomes from before the operator
 * said credits were added no longer count.
 */
export function serviceHealth(outcomes: readonly GenerationOutcome[], creditsAddedAt: ReadonlyMap<string, number> = new Map()): Map<string, ServiceHealth> {
  const health = new Map<string, ServiceHealth>();
  for (const outcome of [...outcomes].sort((left, right) => right.at - left.at)) {
    if (health.has(outcome.providerId)) continue;
    if ((creditsAddedAt.get(outcome.providerId) ?? -Infinity) > outcome.at) continue;
    if (outcome.succeeded) health.set(outcome.providerId, { score: 3, reason: 'worked recently' });
    else if (outcome.error && BILLING.test(outcome.error)) health.set(outcome.providerId, { score: -30, reason: 'ran out of credit on its last run', outOfCredit: true });
  }
  return health;
}

export type BalanceFact = { state: 'available' | 'empty' | 'unknown'; amount?: number; unit?: string };
/** source=balance came from the service's own balance API; history was inferred from a failed run. */
export type ServiceCredit = { state: 'available' | 'empty'; source: 'balance' | 'history'; reason: string };

const amount = (fact: BalanceFact) => (fact.amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + (fact.unit ?? '');

/** A reported balance is authoritative; without one, a last run that ran out of credit marks the service empty. */
export function serviceCredit(balance: BalanceFact | undefined, health: ServiceHealth | undefined): ServiceCredit | undefined {
  if (balance?.state === 'empty') return { state: 'empty', source: 'balance', reason: 'no credits left (' + amount(balance).trim() + ')' };
  if (balance?.state === 'available') return { state: 'available', source: 'balance', reason: amount(balance).trim() + ' left' };
  if (health?.outOfCredit) return { state: 'empty', source: 'history', reason: health.reason };
  return undefined;
}
