export type GenerationOutcome = { modelId: string; providerId: string; succeeded: boolean; error: string | null; at: number };
export type ServiceHealth = { score: number; reason: string };
const BILLING = /credit|balance|insufficient|quota|billing|payment|top up|exceeded your/i;

/**
 * What this workspace recently learned about each service. A service whose latest result ran out of
 * credit sinks below services that work; one that worked recently gets a small lift. Outcomes are read
 * newest first and only the latest outcome per service decides.
 */
export function serviceHealth(outcomes: readonly GenerationOutcome[]): Map<string, ServiceHealth> {
  const health = new Map<string, ServiceHealth>();
  for (const outcome of [...outcomes].sort((left, right) => right.at - left.at)) {
    if (health.has(outcome.providerId)) continue;
    if (outcome.succeeded) health.set(outcome.providerId, { score: 3, reason: 'worked recently' });
    else if (outcome.error && BILLING.test(outcome.error)) health.set(outcome.providerId, { score: -30, reason: 'ran out of credit recently' });
  }
  return health;
}
