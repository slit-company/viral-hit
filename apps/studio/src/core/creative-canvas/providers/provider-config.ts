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

export const DEFAULT_CLOUD_API_BASE_URL = 'https://api.cloud.example';

export const isOfficialCloudApiBaseUrl = (
  baseUrl: string | null | undefined
): boolean => {
  try {
    const candidate = new URL(baseUrl || DEFAULT_CLOUD_API_BASE_URL);
    const official = new URL(DEFAULT_CLOUD_API_BASE_URL);
    const candidatePath = candidate.pathname.replace(/\/+$/, '') || '/';
    const officialPath = official.pathname.replace(/\/+$/, '') || '/';

    return (
      candidate.protocol === official.protocol &&
      candidate.host === official.host &&
      candidatePath === officialPath &&
      !candidate.username &&
      !candidate.password &&
      !candidate.search &&
      !candidate.hash
    );
  } catch {
    return false;
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
  baseUrl: _baseUrl,
  apiKey,
}: {
  providerId?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
} = {}): CreativeCanvasProviderServerConfig => {
  const publicConfig = getCreativeCanvasProviderPublicConfig(providerId);

  return {
    ...publicConfig,
    baseUrl: DEFAULT_CLOUD_API_BASE_URL,
    apiKey: apiKey || '',
  };
};
