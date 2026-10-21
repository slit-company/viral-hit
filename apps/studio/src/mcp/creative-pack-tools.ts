import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { creativePackRequest } from '@/core/creative-packs/contract';
import { changeCreativePacks } from '@/core/creative-packs/service.server';
import { withToolErrors } from './tool-results';
export function registerCreativePackTools(server: McpServer) {
  server.registerTool('viral_hit_creative_pack', {
    description: 'Share a general or specialized setup containing recipes, skills and characters with verified reference images. fetch downloads a public HTTPS or GitHub file link to a new absolute host path without installation or validation; then inspect that same file and read its complete contents. install uses the retained file, never refetches the URL. list shows available selections and installed packs; build writes a new .viralhit-pack.tar to an absolute host path; inspect reads it without changing libraries; install requires its exact reviewed digest. Read full skill instructions and character rules before installing. Matching items are reused, conflicting IDs never overwritten. Check complete and items: an interrupted installation can be partial; review and retry the same file to resume. inspect additionally returns update with full current/incoming member definitions, shared membership and stateDigest for an installed ID. update pins expectedDigest, expectedStateDigest and explicit replaceKeys; additions apply, unselected and dropped definitions remain. On complete:false inspect the same retained file again and review remaining changes. history lists immutable release digests; export accepts an optional digest, including removed packs. review-remove then remove with expectedStateDigest removes only the active listing; all library contents and historical releases remain. No generation, skill execution or publishing starts.',
    inputSchema: z.object({ request: creativePackRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(async ({ request }) => changeCreativePacks(request)));
}
