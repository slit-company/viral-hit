import { createFileRoute } from '@tanstack/react-router';
import { getActiveProject } from '@/core/projects/projects';
import { openHarness } from '@/core/harness/store';
import { runRequest } from '@/core/harness/requests';
import { runtimeCapabilities, assertRuntimeConfigured, reconciliableOperations } from '@/core/harness/capabilities';
import { isComfyConfigured } from '@/core/harness/comfy-router';
import { prepareRecipePlan } from '@/core/harness/recipe-plan';
import { pinRuntimePlan } from '@/core/harness/runtime-plan';
import { attachRunResult } from '@/core/harness/attach-result';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

type Context = { request: Request; params: { projectId: string } };
async function GET({ params }: Context) {
  if (!await getActiveProject({ projectId: params.projectId })) return Response.json({ error: 'Project not found' }, { status: 404 });
  const h = openHarness();
  try {
    const runs = h.runs(params.projectId).map(run => ({ ...run, jobs: h.jobs(String(run.id)), events: h.events(String(run.id)) }));
    return Response.json({ configured: isComfyConfigured(), capabilities: runtimeCapabilities(), runs }, { headers: { 'Cache-Control': 'no-store' } });
  } finally { h.close(); }
}
async function POST({ params, request }: Context) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  if (!await getActiveProject({ projectId: params.projectId })) return Response.json({ error: 'Project not found' }, { status: 404 });
  let body;
  try { body = runRequest.parse(await readRequestJsonWithLimit(request, 256_000)); }
  catch (error) { return Response.json({ error: 'Invalid run request' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  const h = openHarness();
  try {
    if (body.action === 'enqueue' || body.action === 'recipe') {
      const plan = body.action === 'recipe' ? await prepareRecipePlan(body.recipeId, body.values, params.projectId, body.expectedRecipeDigest) : { projectId: params.projectId, nodes: body.nodes };
      try { assertRuntimeConfigured(plan.nodes); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Runtime unavailable' }, { status: 503 }); }
      const runId = h.enqueue(await pinRuntimePlan(plan), body.requestKey);
      return Response.json({ runId }, { status: 202 });
    }
    if (!h.runs(params.projectId).some(run => run.id === body.runId)) return Response.json({ error: 'Run not found' }, { status: 404 });
    if (body.action === 'attach' || body.action === 'take') {
      const result = await attachRunResult(h, params.projectId, body.runId, body.jobId, body.expectedRevision, body.action === 'take' ? body.clipId : undefined);
      return Response.json(result.ok ? result : { ...result, error: result.message }, { status: result.ok ? 200 : result.code === 'REVISION_CONFLICT' ? 409 : 400 });
    }
    if (body.action === 'cancel') h.cancel(body.runId);
    else if (body.action === 'reconcile') h.requestReconciliation(body.runId, reconciliableOperations());
    else h.retry(body.runId);
    return Response.json({ runId: body.runId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Run could not be changed' }, { status: 409 });
  } finally { h.close(); }
}
export const Route = createFileRoute('/api/app/projects/$projectId/runs')({ server: { handlers: { GET, POST } } });
