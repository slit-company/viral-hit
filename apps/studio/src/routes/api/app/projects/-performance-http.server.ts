import { ZodError } from 'zod';
import { changePerformance, readPerformance, readPublicationPerformance } from '@/core/measurement/application.server';
import { MeasurementRequestError } from '@/core/measurement/contract';
import { publicationProjectId } from '@/core/publishing/requests';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';
import { validateTrustedWorkspaceJsonMutation, validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
function errorResponse(error: unknown) {
  if (error instanceof MeasurementRequestError) {
    const status = { 'not-found': 404, 'invalid-input': 400, 'not-measurable': 422, 'runtime-unavailable': 503, conflict: 409 }[error.code];
    return Response.json({ error: error.message, issue: error.code }, { status, headers });
  }
  const status = error instanceof RequestBodyTooLargeError ? 413 : error instanceof SyntaxError || error instanceof ZodError ? 400 : 503;
  return Response.json({ error: status === 413 ? 'Performance request exceeds 16 KB' : status === 400 ? 'Invalid performance request' : 'Performance service unavailable' }, { status, headers });
}

/** Transport only: trust, size and project ID checks before the shared measurement operations. */
export function createPerformanceHttp(deps = { read: readPerformance, history: readPublicationPerformance, change: changePerformance }) {
  return {
    async read(projectId: string, request: Request) {
      const trust = validateTrustedWorkspaceMutation(request);
      if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
      try {
        const publicationId = new URL(request.url).searchParams.get('publicationId');
        const id = publicationProjectId.parse(projectId);
        return Response.json(publicationId ? await deps.history(id, { publicationId }, request.signal) : await deps.read(id, request.signal), { headers });
      } catch (error) { return errorResponse(error); }
    },
    async change(projectId: string, request: Request) {
      const trust = validateTrustedWorkspaceJsonMutation(request);
      if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
      try {
        const id = publicationProjectId.parse(projectId), input = await readRequestJsonWithLimit(request, 16000);
        return Response.json(await deps.change(id, input, 'ui', AbortSignal.any([request.signal, AbortSignal.timeout(60000)])), { headers });
      } catch (error) { return errorResponse(error); }
    },
  };
}
