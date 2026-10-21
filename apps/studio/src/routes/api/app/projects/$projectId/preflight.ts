import { createFileRoute } from '@tanstack/react-router';
import { getActiveProject } from '@/core/projects/projects';
import { prepareRecipeCheck, recipeCheckRequest } from '@/core/harness/recipe-plan';
import { preflightRecipePlan } from '@/core/harness/recipe-preflight.server';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit } from '@/lib/request-body-limit';

async function POST({ request, params }: { request: Request; params: { projectId: string } }) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  if (!await getActiveProject({ projectId: params.projectId })) return Response.json({ error: 'Project not found' }, { status: 404 });
  try {
    const input = recipeCheckRequest.parse(await readRequestJsonWithLimit(request, 128_000));
    const { plan, deferredInputs } = await prepareRecipeCheck(input.recipeId, input.values, params.projectId, input.expectedRecipeDigest);
    return Response.json(await preflightRecipePlan(plan, { signal: request.signal, deferredInputs }), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Could not check this recipe. Verify its required values and installed manifest.' }, { status: 400 }); }
}
export const Route = createFileRoute('/api/app/projects/$projectId/preflight')({ server: { handlers: { POST } } });
