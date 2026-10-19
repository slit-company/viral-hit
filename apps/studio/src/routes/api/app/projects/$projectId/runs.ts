import { createFileRoute } from '@tanstack/react-router';
import { getActiveProject } from '@/core/projects/projects';
import { openHarness } from '@/core/harness/store';
import { runRequest } from '@/core/harness/requests';
import { isComfyConfigured } from '@/core/harness/comfy-router';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

type Context = { request: Request; params: { projectId: string } };
async function GET({ params }: Context) {
  if (!await getActiveProject({ projectId: params.projectId })) return Response.json({ error: 'Project not found' }, { status: 404 });
  const h = openHarness();
  try {
    const runs = h.runs(params.projectId).map(run => ({ ...run, jobs: h.jobs(String(run.id)), events: h.events(String(run.id)) }));
    return Response.json({ configured: isComfyConfigured(), runs }, { headers: { 'Cache-Control': 'no-store' } });
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
    if (body.action === 'enqueue') {
      if (!isComfyConfigured()) return Response.json({ error: 'Comfy API key is not configured on this server' }, { status: 503 });
      const runId = h.enqueue({ projectId: params.projectId, nodes: body.nodes }, body.requestKey);
      return Response.json({ runId }, { status: 202 });
    }
    if (!h.runs(params.projectId).some(run => run.id === body.runId)) return Response.json({ error: 'Run not found' }, { status: 404 });
    if (body.action === 'cancel') h.cancel(body.runId);
    else h.retry(body.runId);
    return Response.json({ runId: body.runId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Run could not be changed' }, { status: 409 });
  } finally { h.close(); }
}
export const Route = createFileRoute('/api/app/projects/$projectId/runs')({ server: { handlers: { GET, POST } } });
