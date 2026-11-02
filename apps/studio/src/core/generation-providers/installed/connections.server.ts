import { z } from 'zod';
import { changeProviderCredentials, providerConfigurationView } from './credentials.server';
import { installGenerationProviders, installedConnectionRuntime } from './install.server';
import { cachedProviderBalances, creditsAddedTimes, markCreditsAdded, refreshProviderBalance } from './balance.server';
import { recentGenerationOutcomes } from '../recent-outcomes.server';
import { serviceCredit, serviceHealth } from '../service-credit';

export const connectionChange = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), providerId: z.string().max(40), revision: z.string().max(64), values: z.record(z.string().max(101), z.string().max(8192).nullable()) }).strict(),
  z.object({ action: z.literal('test'), providerId: z.string().max(40), revision: z.string().max(64) }).strict(),
  /** Read-only remaining-credit check for services that declare one. */
  z.object({ action: z.literal('balance'), providerId: z.string().max(40) }).strict(),
  /** The operator topped up: earlier out-of-credit failures stop excluding this service. */
  z.object({ action: z.literal('credits-added'), providerId: z.string().max(40) }).strict(),
]);

/** Connection metadata plus what the workspace knows about each service's credit; never makes requests. */
export async function providerConnections() {
  const [balances, creditsAdded, outcomes] = await Promise.all([cachedProviderBalances(), creditsAddedTimes(), recentGenerationOutcomes().catch(() => [])]);
  const health = serviceHealth(outcomes, creditsAdded);
  return installGenerationProviders().providers.filter(provider => provider.configurationDelivery === 'request').map(provider => {
    const balance = balances.get(provider.id), credit = serviceCredit(balance, health.get(provider.id));
    return {
      id: provider.id, label: provider.label, canTest: Boolean(provider.connectionTest), canCheckBalance: Boolean(provider.balanceCheck), modelCount: provider.models.length,
      ...(provider.description ? { description: provider.description } : {}), ...(provider.setupUrl ? { setupUrl: provider.setupUrl } : {}), ...(provider.keyFormat ? { keyFormat: provider.keyFormat } : {}),
      ...(balance ? { balance } : {}), ...(credit ? { credit } : {}),
      ...providerConfigurationView(provider),
    };
  });
}

export async function changeProviderConnection(input: z.infer<typeof connectionChange>) {
  const runtime = installedConnectionRuntime(input.providerId);
  if (!runtime || runtime.manifest.configurationDelivery !== 'request') throw Error('Provider connection is not installed');
  if (input.action === 'save') return changeProviderCredentials(runtime.manifest, input.revision, input.values);
  if (input.action === 'balance') return { balance: await refreshProviderBalance(input.providerId) };
  if (input.action === 'credits-added') return markCreditsAdded(input.providerId);
  if (providerConfigurationView(runtime.manifest).revision !== input.revision) throw Error('Settings changed. Refresh before checking.');
  const before = JSON.stringify(providerConfigurationView(runtime.manifest));
  const result = await runtime.testConnection();
  if (before !== JSON.stringify(providerConfigurationView(runtime.manifest))) throw Error('Settings changed during the connection check. Check again.');
  return runtime.manifest.balanceCheck ? { ...result, balance: await refreshProviderBalance(input.providerId) } : result;
}
