import { createFileRoute } from '@tanstack/react-router';
import { changeRecipePacks, listRecipePacks, recipePackRequest } from '@/core/harness/recipe-pack-library';
import { MAX_PACK_BYTES } from '@/core/harness/recipe-packs';
import { RecipeConflictError } from '@/core/harness/recipe-storage';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

export const Route = createFileRoute('/api/app/recipe-packs')({ server: { handlers: {
  GET: async () => {
    try { return Response.json(await listRecipePacks(), { headers: { 'Cache-Control': 'no-store' } }); }
    catch { return Response.json({ error: 'Recipe packs are unavailable; check the pack directory and local library.' }, { status: 503 }); }
  },
  POST: async ({ request }) => {
    const trust = validateTrustedWorkspaceJsonMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
    try {
      const body = recipePackRequest.parse(await readRequestJsonWithLimit(request, MAX_PACK_BYTES + 4096));
      return Response.json(await changeRecipePacks(body));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message.slice(0, 1500) : 'Invalid recipe pack' }, { status: error instanceof RequestBodyTooLargeError ? 413 : error instanceof RecipeConflictError ? 409 : 400 });
    }
  },
} } });
