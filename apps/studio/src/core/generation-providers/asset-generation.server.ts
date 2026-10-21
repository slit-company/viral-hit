import { inspectAssetGeneration } from './generation-receipt.server';
import { createHash } from 'node:crypto';
import { canonicalJson } from '@/lib/canonical-json';
import { assetGenerationRequest } from './asset-generation';
import { createAssetFirstGenerationIntent, submitAssetFirstGeneration } from './submit';

/** Reuses project admission, consumed intent fencing, generation history and output storage. */
export async function requestAssetGeneration(raw: unknown, origin: 'mcp' | 'cli'): Promise<Record<string, unknown>> {
  const request = assetGenerationRequest.parse(raw);
  if (request.action === 'inspect') return inspectAssetGeneration(request);
  const generation = JSON.parse(JSON.stringify(request.generation));
  const digest = createHash('sha256').update(canonicalJson(generation)).digest('hex');
  if (request.action === 'prepare') {
    const generationIntentToken = await createAssetFirstGenerationIntent(generation);
    return { generation, generationIntentToken, digest };
  }
  if (digest !== request.expectedDigest) throw Error('Generation request changed after preparation. Review and prepare the new request.');
  const result = await submitAssetFirstGeneration({ generation, generationIntentId: request.generationIntentToken, origin, refreshExpiredIntent: false });
  if (result.status >= 400) throw Error(String(result.body.error ?? 'Generation failed'));
  return result.body;
}
