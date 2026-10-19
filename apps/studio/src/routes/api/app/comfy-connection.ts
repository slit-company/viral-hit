import { createFileRoute } from '@tanstack/react-router';
import { changeComfyConnection, connectionRequest, ConnectionConflictError, readComfyConnection } from '@/core/harness/comfy-connection';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

export const Route = createFileRoute('/api/app/comfy-connection')({ server: { handlers: {
  GET: async () => {
    try { return Response.json(readComfyConnection(), { headers: { 'Cache-Control': 'no-store' } }); }
    catch { return Response.json({ error: 'Local connection settings could not be read.' }, { status: 503 }); }
  },
  POST: async ({ request }) => {
    const trust = validateTrustedWorkspaceJsonMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
    try {
      const body = connectionRequest.parse(await readRequestJsonWithLimit(request, 4096));
      return Response.json(await changeComfyConnection(body), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message.slice(0, 1000) : 'Connection request failed' }, { status: error instanceof RequestBodyTooLargeError ? 413 : error instanceof ConnectionConflictError ? 409 : 400 });
    }
  },
} } });
