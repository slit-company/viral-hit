import { createFileRoute } from '@tanstack/react-router';
import { ZodError } from 'zod';
import { changeShared, readSharedProject, runSharedCommand, ShareNotFoundError } from '@/core/collaboration/service.server';
import { MAX_PROJECT_SNAPSHOT_BYTES } from '@/core/projects/project-snapshot';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

type Context = { request: Request; params: { token: string } };
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const failure = (error: unknown) => Response.json({ error: error instanceof ZodError ? 'Invalid request' : error instanceof Error ? error.message.slice(0, 500) : 'Request failed' },
  { status: error instanceof ShareNotFoundError ? 404 : error instanceof RequestBodyTooLargeError ? 413 : 400, headers });

/** What a share link may see: the project's name, newest cut and comments. The token is the only credential. */
async function GET({ params }: Context) {
  try { return Response.json(await readSharedProject(params.token), { headers }); }
  catch (error) { return failure(error); }
}
/** Comments from the link, or timeline commands when the link is an editor's. */
async function POST({ params, request }: Context) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
  try {
    const body = await readRequestJsonWithLimit<Record<string, unknown>>(request, MAX_PROJECT_SNAPSHOT_BYTES);
    if (!body || typeof body !== 'object' || !('command' in body)) return Response.json(await changeShared(params.token, body), { headers });
    const result = await runSharedCommand(params.token, body);
    const status = result.ok ? 200 : result.code === 'FORBIDDEN' ? 403 : result.code === 'NOT_FOUND' ? 404 : result.code === 'REVISION_CONFLICT' ? 409 : 400;
    return Response.json(result, { status, headers });
  } catch (error) { return failure(error); }
}
export const Route = createFileRoute('/api/shared/$token')({ server: { handlers: { GET, POST } } });
