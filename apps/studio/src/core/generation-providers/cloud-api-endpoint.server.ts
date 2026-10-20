import { normalizeCloudApiBaseUrl } from '@/core/creative-canvas/providers/provider-config';

export const CLOUD_API_URL_ENV = 'VIRAL_HIT_CLOUD_API_URL';

/**
 * The endpoint is operator configuration. Workspace settings can store a key
 * but cannot redirect it to another origin.
 */
export function getCloudApiBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return normalizeCloudApiBaseUrl(env[CLOUD_API_URL_ENV]);
}

export function requireCloudApiBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = getCloudApiBaseUrl(env);
  if (!baseUrl) {
    throw new Error(
      `Set ${CLOUD_API_URL_ENV} to a compatible HTTPS Cloud API endpoint before generating.`
    );
  }
  return baseUrl;
}
