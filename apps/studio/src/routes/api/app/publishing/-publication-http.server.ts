import { ZodError } from 'zod';
import { changePublication, listPublications } from '@/core/publishing/application.server';
import { publicationProjectId, publicationRequest, PublicationRequestError } from '@/core/publishing/requests';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';
import { validateTrustedWorkspaceJsonMutation, validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
function errorResponse(error: unknown) {
  if (error instanceof PublicationRequestError) {
    const status = { 'not-found': 404, conflict: 409, 'invalid-input': 400, 'account-unavailable': 503, 'media-unavailable': 422, 'runtime-unavailable': 503 }[error.code];
    return Response.json({ error: error.message, issue: error.code }, { status, headers });
  }
  const status = error instanceof RequestBodyTooLargeError ? 413 : error instanceof ZodError || error instanceof SyntaxError ? 400 : 503;
  return Response.json({ error: status === 413 ? 'Publication request exceeds 32 KB' : status === 400 ? 'Invalid publication request' : 'Publication service unavailable' }, { status, headers });
}
export function createPublicationHttp(deps = { list: listPublications, change: changePublication }) {
  return {
    async read(projectId: string, request: Request) {
      const trust = validateTrustedWorkspaceMutation(request);
      if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
      try { return Response.json(await deps.list(publicationProjectId.parse(projectId), request.signal), { headers }); }
      catch (error) { return errorResponse(error); }
    },
    async change(projectId: string, request: Request) {
      const trust = validateTrustedWorkspaceJsonMutation(request);
      if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
      try {
        const id = publicationProjectId.parse(projectId), input = publicationRequest.parse(await readRequestJsonWithLimit(request, 32000));
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(300000)]);
        return Response.json(await deps.change(id, input, 'ui', signal), { headers });
      } catch (error) { return errorResponse(error); }
    },
  };
}
