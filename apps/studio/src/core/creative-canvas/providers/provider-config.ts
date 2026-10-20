export const CREATIVE_CANVAS_PROVIDER_IDS = ['cloud-api'] as const;

export type CreativeCanvasProviderId =
  (typeof CREATIVE_CANVAS_PROVIDER_IDS)[number];

export type CreativeCanvasProviderPublicConfig = {
  id: CreativeCanvasProviderId;
  label: string;
  isDefault: boolean;
  supports: readonly ['image', 'video', 'analysis'];
};

export type CreativeCanvasProviderServerConfig =
  CreativeCanvasProviderPublicConfig & {
    baseUrl: string;
    apiKey: string;
  };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Normalize an operator-provided Cloud API endpoint. HTTPS is required except
 * for a loopback development server; credentials, queries and fragments are
 * rejected so the API key is only ever sent to the exact configured origin.
 */
export const normalizeCloudApiBaseUrl = (
  value: string | null | undefined
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const secure =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
    if (!secure || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
};

export const resolveCreativeCanvasProviderId = (
  _value: string | null | undefined
): CreativeCanvasProviderId => 'cloud-api';

export const getCreativeCanvasProviderPublicConfig = (
  providerId: string | null | undefined
): CreativeCanvasProviderPublicConfig => {
  const id = resolveCreativeCanvasProviderId(providerId);

  return {
    id,
    label: 'Cloud API',
    isDefault: true,
    supports: ['image', 'video', 'analysis'],
  };
};

export const getCreativeCanvasProviderServerConfig = ({
  providerId,
  baseUrl,
  apiKey,
}: {
  providerId?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
} = {}): CreativeCanvasProviderServerConfig => {
  const publicConfig = getCreativeCanvasProviderPublicConfig(providerId);

  return {
    ...publicConfig,
    baseUrl: normalizeCloudApiBaseUrl(baseUrl) ?? '',
    apiKey: apiKey || '',
  };
};
