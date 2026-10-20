import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { changeRecipePacks, recipePackRequest } from '@/core/harness/recipe-pack-library';
import { withToolErrors } from './tool-results';

export function registerRecipePackTools(server: McpServer) {
  server.registerTool('viral_hit_recipe_pack', {
    description: 'List, review or install recipe packs. A pack groups recipes for a general purpose or a specific situation (scope general|specialized). Use list to see bundled packs, fetch to download a shared pack from an HTTPS or GitHub file link, inspect to get a digest and conflicts, then install the reviewed manifest with that exact digest. build composes a shareable pack from local recipes. Installing adds recipes to the local library only; it never queues work. Installed packs are immutable; updates use a new pack ID.',
    inputSchema: z.object({ request: recipePackRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withToolErrors(async ({ request }) => changeRecipePacks(request)));
}
