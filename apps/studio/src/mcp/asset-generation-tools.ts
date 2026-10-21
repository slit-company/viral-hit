import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { assetGenerationRequest } from '@/core/generation-providers/asset-generation';
import { requestAssetGeneration } from '@/core/generation-providers/asset-generation.server';
import { withToolErrors } from './tool-results';

export function registerAssetGenerationTools(server: McpServer) {
  server.registerTool('viral_hit_asset_generation', {
    description: 'Create reusable project assets or analysis with an installed/available model, including independent audio models, without a Canvas generation node. Prepare validates the full version-2 generation request and returns its digest and single-use generationIntentToken without generating or uploading. Review the exact request and invoke submit only within the user-authorized generation scope; it may spend provider credits. Submit the returned generation, generationIntentToken and expectedDigest. A consumed token never authorizes another provider call: after an uncertain response inspect project generation history/status, never prepare a fresh token automatically. Uses the same admission, polling, retained assets and history as Studio. This does not place a timeline clip or publish.',
    inputSchema: z.object({ request: assetGenerationRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(({ request }) => requestAssetGeneration(request, 'mcp')));
}
