import { z } from 'zod';
import { changeProviderCredentials, providerConfigurationView } from './credentials.server';
import { installGenerationProviders, installedConnectionRuntime } from './install.server';

export const connectionChange = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), providerId: z.string().max(40), revision: z.string().max(64), values: z.record(z.string().max(101), z.string().max(8192).nullable()) }).strict(),
  z.object({ action: z.literal('test'), providerId: z.string().max(40), revision: z.string().max(64) }).strict(),
]);
export function providerConnections() {
  return installGenerationProviders().providers.filter(provider => provider.configurationDelivery === 'request').map(provider => ({
    id: provider.id, label: provider.label, canTest: Boolean(provider.connectionTest), modelCount: provider.models.length,
    ...(provider.description ? { description: provider.description } : {}), ...(provider.setupUrl ? { setupUrl: provider.setupUrl } : {}), ...(provider.keyFormat ? { keyFormat: provider.keyFormat } : {}),
    ...providerConfigurationView(provider),
  }));
}
export async function changeProviderConnection(input: z.infer<typeof connectionChange>) {
  const runtime = installedConnectionRuntime(input.providerId);
  if (!runtime || runtime.manifest.configurationDelivery !== 'request') throw Error('Provider connection is not installed');
  if (input.action === 'save') return changeProviderCredentials(runtime.manifest, input.revision, input.values);
  if (providerConfigurationView(runtime.manifest).revision !== input.revision) throw Error('Settings changed. Refresh before checking.');
  const before = JSON.stringify(providerConfigurationView(runtime.manifest));
  const result = await runtime.testConnection();
  if (before !== JSON.stringify(providerConfigurationView(runtime.manifest))) throw Error('Settings changed during the connection check. Check again.');
  return result;
}
