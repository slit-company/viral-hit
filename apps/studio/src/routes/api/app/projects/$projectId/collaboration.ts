import { createFileRoute } from '@tanstack/react-router';
import { ZodError } from 'zod';
import { changeCollaboration, readCollaboration } from '@/core/collaboration/service.server';
import { getActiveProject } from '@/core/projects/projects';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

type Context = { request: Request; params: { projectId: string } };
const failure = (error: unknown) => Response.json({ error: error instanceof ZodError ? 'Invalid collaboration request' : error instanceof Error ? error.message.slice(0, 500) : 'Request failed' },
  { status: error instanceof RequestBodyTooLargeError ? 413 : error instanceof Error && /not found/i.test(error.message) ? 404 : 400 });

/** Share links and comments of a project, for its owner on this computer. */
async function GET({ params }: Context) {
  if (!await getActiveProject({ projectId: params.projectId })) return Response.json({ error: 'Project not found' }, { status: 404 });
  return Response.json(readCollaboration(params.projectId), { headers: { 'Cache-Control': 'no-store' } });
}
async function POST({ params, request }: Context) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  try { return Response.json(await changeCollaboration(params.projectId, await readRequestJsonWithLimit(request, 16_000), { kind: 'owner', name: 'Owner' }), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
export const Route = createFileRoute('/api/app/projects/$projectId/collaboration')({ server: { handlers: { GET, POST } } });
