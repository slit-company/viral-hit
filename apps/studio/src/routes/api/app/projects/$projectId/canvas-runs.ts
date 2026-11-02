import { createFileRoute } from '@tanstack/react-router';
import { ZodError } from 'zod';
import { changeCanvasRuns } from '@/core/creative-canvas/canvas-runs.server';
import { getActiveProject } from '@/core/projects/projects';
import { validateTrustedWorkspaceJsonMutation, validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

type Context = { request: Request; params: { projectId: string } };
const headers = { 'Cache-Control': 'no-store' };
const failure = (error: unknown) => Response.json({ error: error instanceof ZodError || error instanceof SyntaxError ? 'Invalid canvas run request.' : error instanceof Error ? error.message.slice(0, 1000) : 'Canvas run failed.' },
  { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers });

/** GET brings canvas takes up to date with their runs; POST plans, starts or branches. */
export const Route = createFileRoute('/api/app/projects/$projectId/canvas-runs')({ server: { handlers: {
  GET: async ({ request, params }: Context) => {
    const trust = validateTrustedWorkspaceMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
    if (!await getActiveProject({ projectId: params.projectId })) return Response.json({ error: 'Project not found' }, { status: 404, headers });
    try { return Response.json(await changeCanvasRuns(params.projectId, { action: 'status' }, 'ui'), { headers }); } catch (error) { return failure(error); }
  },
  POST: async ({ request, params }: Context) => {
    const trust = validateTrustedWorkspaceJsonMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
    if (!await getActiveProject({ projectId: params.projectId })) return Response.json({ error: 'Project not found' }, { status: 404, headers });
    try { return Response.json(await changeCanvasRuns(params.projectId, await readRequestJsonWithLimit(request, 8_000), 'ui'), { headers }); } catch (error) { return failure(error); }
  },
} } });
