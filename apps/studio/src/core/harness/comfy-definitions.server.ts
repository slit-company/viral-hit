import { readProviderCredentials } from '../generation-providers/installed/credentials.server';
import { readComfyConnection } from './comfy-connection';
import type { ComfyDefinitions } from './comfy-canvas';

export const COMFY_CLOUD_URL = 'https://cloud.comfy.org/';
export type DefinitionTarget = 'server' | 'cloud';
const TTL_MS = 10 * 60_000, MAX_BYTES = 48 * 1024 * 1024;
const cache = new Map<string, { at: number; definitions: ComfyDefinitions }>();

/** The Comfy key saved in Connections, or COMFY_API_KEY on the server. Never logged or returned. */
export function comfyCloudKey() {
  try {
    const stored = readProviderCredentials('comfy').values.COMFY_API_KEY?.trim();
    if (stored) return stored;
  } catch { /* Credential storage unavailable: fall back to the environment. */ }
  return process.env.COMFY_API_KEY?.trim() || null;
}

/** Your own ComfyUI server when one is connected, otherwise Comfy Cloud when a Comfy key is saved. */
export function pickDefinitionTarget(preferred?: DefinitionTarget) {
  const server = readComfyConnection().url;
  if (preferred === 'server' || (!preferred && server)) {
    if (!server) throw new Error('Connect a ComfyUI server in Runs → Connections first.');
    return { target: 'server' as const, url: server };
  }
  if (!comfyCloudKey()) throw new Error(preferred === 'cloud' ? 'Save a Comfy key in Connections to use Comfy Cloud.' : 'Connect a ComfyUI server in Runs → Connections, or save a Comfy key in Connections to use Comfy Cloud.');
  return { target: 'cloud' as const, url: COMFY_CLOUD_URL };
}

async function boundedText(response: Response) {
  if (!response.body) throw new Error('The node list was empty.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('The node list is larger than 48 MB.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return Buffer.concat(chunks, size).toString('utf8');
}

/**
 * Node definitions (GET object_info) from the server that will run the workflow, cached for ten
 * minutes. Read-only: nothing is uploaded, queued or installed.
 */
export async function loadComfyDefinitions(preferred?: DefinitionTarget, signal = AbortSignal.timeout(90_000)) {
  const source = pickDefinitionTarget(preferred), cacheKey = source.target + ':' + source.url;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) return { ...source, definitions: cached.definitions };
  const response = await fetch(new URL(source.target === 'cloud' ? 'api/object_info' : 'object_info', source.url), {
    redirect: 'error', signal, headers: source.target === 'cloud' ? { Authorization: 'Bearer ' + comfyCloudKey() } : {},
  });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new Error(source.target === 'cloud' ? 'Comfy Cloud refused the Comfy key saved in Connections.' : 'The ComfyUI server refused to list its nodes.');
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Could not read the node list (HTTP ${response.status}).`); }
  const parsed = JSON.parse(await boundedText(response)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The node list is not a ComfyUI object_info response.');
  const definitions = parsed as ComfyDefinitions;
  cache.set(cacheKey, { at: Date.now(), definitions });
  return { ...source, definitions };
}
