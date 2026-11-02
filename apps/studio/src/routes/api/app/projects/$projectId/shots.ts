import { createFileRoute } from '@tanstack/react-router';
import { ZodError } from 'zod';
import { changeShots } from '@/core/shot-harness/service.server';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

type Context = { request: Request; params: { projectId: string } };
const failure = (error: unknown) => Response.json({ error: error instanceof ZodError ? 'Invalid shot request' : error instanceof Error ? error.message.slice(0, 1000) : 'Shot request failed' },
  { status: error instanceof RequestBodyTooLargeError ? 413 : error instanceof Error && error.message === 'Project not found' ? 404 : 400 });

async function GET({ params }: Context) {
  try { return Response.json(await changeShots(params.projectId, { action: 'list' }), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
async function POST({ params, request }: Context) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  try { return Response.json(await changeShots(params.projectId, await readRequestJsonWithLimit(request, 64_000)), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
export const Route = createFileRoute('/api/app/projects/$projectId/shots')({ server: { handlers: { GET, POST } } });
