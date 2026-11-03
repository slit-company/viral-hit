import { createFileRoute } from '@tanstack/react-router';
import { ZodError } from 'zod';
import { changeImageLayers, StackConflictError } from '@/core/image-layers/service.server';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

type Context = { request: Request; params: { projectId: string } };
const failure = (error: unknown) => Response.json({ error: error instanceof ZodError ? 'Invalid layer request' : error instanceof Error ? error.message.slice(0, 500) : 'Layer request failed' },
  { status: error instanceof RequestBodyTooLargeError ? 413 : error instanceof StackConflictError ? 409 : error instanceof Error && /not found/i.test(error.message) ? 404 : 400 });

async function GET({ params, request }: Context) {
  const stackId = new URL(request.url).searchParams.get('stack');
  try { return Response.json(await changeImageLayers(params.projectId, stackId ? { action: 'get', stackId } : { action: 'list' }), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
async function POST({ params, request }: Context) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  try { return Response.json(await changeImageLayers(params.projectId, await readRequestJsonWithLimit(request, 64_000)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
export const Route = createFileRoute('/api/app/projects/$projectId/image-layers')({ server: { handlers: { GET, POST } } });
