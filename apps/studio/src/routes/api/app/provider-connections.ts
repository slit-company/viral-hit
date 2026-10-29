import { createFileRoute } from '@tanstack/react-router';
import { providerConnections, changeProviderConnection, connectionChange } from '@/core/generation-providers/installed/connections.server';
import { validateTrustedWorkspaceJsonMutation, validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

const headers = { 'Cache-Control': 'no-store' };
export const Route = createFileRoute('/api/app/provider-connections')({ server: { handlers: {
  GET: ({ request }) => {
    const trust = validateTrustedWorkspaceMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
    try { return Response.json({ providers: providerConnections() }, { headers }); }
    catch { return Response.json({ error: 'Provider connection settings are unavailable.' }, { status: 503, headers }); }
  },
  POST: async ({ request }) => {
    const trust = validateTrustedWorkspaceJsonMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
    try {
      const parsed = connectionChange.safeParse(await readRequestJsonWithLimit(request, 96_000));
      if (!parsed.success) return Response.json({ error: 'Invalid connection settings.' }, { status: 400, headers });
      return Response.json(await changeProviderConnection(parsed.data), { headers });
    } catch (error) {
      // Never serialize the request body or validation issues: they can contain credentials.
      return Response.json({ error: error instanceof SyntaxError ? 'Invalid connection settings.' : error instanceof Error ? error.message : 'Connection update failed.' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers });
    }
  },
} } });
