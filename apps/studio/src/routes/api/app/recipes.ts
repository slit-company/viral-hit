import { createFileRoute } from '@tanstack/react-router';
import { runtimeCapabilities } from '@/core/harness/capabilities';
import { loadRecipes } from '@/core/harness/recipe-registry';
import { inspectRecipe, installRecipe, recipeLibraryRequest } from '@/core/harness/recipe-library';
import { RecipeConflictError } from '@/core/harness/recipe-storage';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

export const Route = createFileRoute('/api/app/recipes')({ server: { handlers: {
  GET: async () => {
    try { return Response.json({ recipes: await loadRecipes(), capabilities: runtimeCapabilities() }, { headers: { 'Cache-Control': 'no-store' } }); }
    catch { return Response.json({ error: 'Recipe catalog is invalid or unavailable; inspect the configured recipe directory and local library.' }, { status: 503 }); }
  },
  POST: async ({ request }) => {
    const trust = validateTrustedWorkspaceJsonMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
    try {
      const body = recipeLibraryRequest.parse(await readRequestJsonWithLimit(request, 132_000));
      return Response.json(body.action === 'inspect' ? await inspectRecipe(body.manifest) : await installRecipe(body.manifest, body.expectedDigest));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message.slice(0, 1500) : 'Invalid recipe manifest' }, { status: error instanceof RequestBodyTooLargeError ? 413 : error instanceof RecipeConflictError ? 409 : 400 });
    }
  },
} } });
