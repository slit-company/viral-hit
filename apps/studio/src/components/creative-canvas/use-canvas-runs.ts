import { useQuery, useQueryClient } from '@tanstack/react-query';
import { m } from '@/paraglide/messages.js';
import type { CanvasRunReason } from '@/core/creative-canvas/canvas-run-plan';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';

export type CanvasRunStepView = { cardId: string; name: string; modelId: string; mode: string; action: 'run' | 'reuse'; reason: CanvasRunReason | null };
export type CanvasRunPlanView = { blocked: { cardId: string; name: string; message: string } | null; steps: CanvasRunStepView[] };
type Status = { active: boolean; runs: Array<{ runId: string; held: boolean; steps: Array<{ cardId: string; state: string }> }> };

async function canvasRuns<T>(projectId: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/app/projects/${encodeURIComponent(projectId)}/canvas-runs`, { method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !json) throw new Error(json?.error ?? m['ui.canvas_run.failed']());
  return json;
}

/** Brings canvas takes up to date on load, then every three seconds while a canvas run is active. */
export const useCanvasRunStatus = (projectId: string) => useQuery({
  queryKey: ['canvas-runs', projectId], queryFn: () => canvasRuns<Status>(projectId),
  refetchInterval: (query) => (query.state.data?.active ? 3000 : false), staleTime: 2000,
});

export function useCanvasRunActions(projectId: string) {
  const client = useQueryClient();
  return {
    plan: (cardId: string) => canvasRuns<{ plan: CanvasRunPlanView }>(projectId, { action: 'plan', cardId }).then((result) => result.plan),
    start: async (cardId: string) => {
      const result = await canvasRuns<{ runId: string | null }>(projectId, { action: 'start', cardId, requestId: crypto.randomUUID() });
      await client.invalidateQueries({ queryKey: ['canvas-runs', projectId] });
      return result;
    },
    branch: (cardId: string) => canvasRuns<{ cardId: string }>(projectId, { action: 'branch', cardId, requestId: crypto.randomUUID() }),
  };
}
