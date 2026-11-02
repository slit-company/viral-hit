import { createFileRoute } from '@tanstack/react-router';
import { ZodError } from 'zod';
import { changeAgent, readAgentOverview, readApprovalBadge } from '@/core/agent/agent.server';
import { validateTrustedWorkspaceJsonMutation, validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

const headers = { 'Cache-Control': 'no-store' };
/** The Agent page: ask-before-generating, approvals waiting for a person, and memory. */
export const Route = createFileRoute('/api/app/agent')({ server: { handlers: {
  GET: async ({ request }) => {
    const trust = validateTrustedWorkspaceMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
    if (new URL(request.url).searchParams.get('view') === 'badge') return Response.json(readApprovalBadge(), { headers });
    return Response.json(await readAgentOverview(), { headers });
  },
  POST: async ({ request }) => {
    const trust = validateTrustedWorkspaceJsonMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
    try {
      return Response.json(changeAgent(await readRequestJsonWithLimit(request, 16_000), 'person'), { headers });
    } catch (error) {
      const message = error instanceof ZodError || error instanceof SyntaxError ? 'Invalid agent change.' : error instanceof Error ? error.message : 'Agent change failed.';
      return Response.json({ error: message }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers });
    }
  },
} } });
