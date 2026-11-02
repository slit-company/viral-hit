import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { m } from '@/paraglide/messages.js';
import type { AgentAction, AgentOverview, ApprovalMode } from '@/core/agent/contract';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';

const headers = { [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE, 'Content-Type': 'application/json' };

async function agentRequest<T>({ query = '', body }: { query?: string; body?: AgentAction } = {}): Promise<T> {
  const response = await fetch('/api/app/agent' + query, { method: body ? 'POST' : 'GET', headers, cache: 'no-store', ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !json) throw new Error(json?.error ?? m['ui.agent.failed']());
  return json;
}

/** The Agent page; refreshes every few seconds while asking is on, so new requests appear. */
export const useAgentOverview = () => useQuery({
  queryKey: ['agent'], queryFn: () => agentRequest<AgentOverview>(),
  refetchInterval: (query) => (query.state.data?.mode === 'ask' ? 5000 : false),
});

/** Pending approvals for the header badge. */
export const useApprovalBadge = () => useQuery({
  queryKey: ['agent-badge'], queryFn: () => agentRequest<{ mode: ApprovalMode; pending: number }>({ query: '?view=badge' }),
  refetchInterval: 15_000, staleTime: 10_000,
});

export function useAgentChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentAction) => agentRequest<Record<string, unknown>>({ body }),
    onSettled: () => Promise.all([client.invalidateQueries({ queryKey: ['agent'] }), client.invalidateQueries({ queryKey: ['agent-badge'] })]),
  });
}
