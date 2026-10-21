import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { communityRequest } from '@/core/community/contract';
import { changeCommunity } from '@/core/community/service.server';
import { withToolErrors } from './tool-results';

export function registerCommunityTools(server: McpServer) {
  server.registerTool(
    'viral_hit_community',
    {
      description:
        'Discover general or specialized skills, recipe packs and creative packs from independently authored catalog JSON. list/get read saved snapshots without networking. inspect/fetch review metadata; save requires expectedDigest and expectedPreviousDigest from that review. remove forgets a catalog, preserving installed contents. To use an entry, pass its URL and sha256 as expectedSha256 to the matching skill_library, recipe_pack or creative_pack fetch action, then review and install through that library. Catalog descriptions are author claims, not execution/quality verification. Saving a catalog never downloads entries, installs code or runs jobs.',
      inputSchema: z.object({ request: communityRequest }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    withToolErrors(async ({ request }) => changeCommunity(request)),
  );
}
