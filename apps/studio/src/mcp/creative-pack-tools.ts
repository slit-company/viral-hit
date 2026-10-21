import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { creativePackRequest } from '@/core/creative-packs/contract';
import { changeCreativePacks } from '@/core/creative-packs/service.server';
import { withToolErrors } from './tool-results';
export function registerCreativePackTools(server: McpServer) {
  server.registerTool('viral_hit_creative_pack', {
    description: 'Share a general or specialized setup containing recipes, skills and characters with verified reference images. list shows available selections and installed packs; build writes a new .viralhit-pack.tar to an absolute host path; inspect reads it without changing libraries; install requires its exact reviewed digest. Read full skill instructions and character rules before installing. Matching items are reused, conflicting IDs never overwritten. Check complete and items: an interrupted installation can be partial; review and retry the same file to resume. export writes the immutable installed contents. No generation, skill execution or publishing starts.',
    inputSchema: z.object({ request: creativePackRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withToolErrors(async ({ request }) => changeCreativePacks(request)));
}
