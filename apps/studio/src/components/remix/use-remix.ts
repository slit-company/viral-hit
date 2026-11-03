import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { RemixView } from '@/core/remix/contract';
import type { TimelineTransition } from '@/core/editor/transition-contract';

const url = (projectId: string) => '/api/app/projects/' + encodeURIComponent(projectId) + '/remix';
export const REMIX_RUNNING = new Set(['queued', 'submitting', 'running', 'pending']);
const key = (projectId: string) => ['remixes', projectId];

export function useRemixes(projectId: string) {
  return useQuery({
    queryKey: key(projectId),
    queryFn: () => apiJsonGet<{ remixes: RemixView[] }>(url(projectId)).then(result => result.remixes),
    // Cuts usually finish first; keep polling until the camera and text analysis is done too.
    refetchInterval: query => query.state.data?.some(remix => REMIX_RUNNING.has(remix.state) || (remix.edit !== null && REMIX_RUNNING.has(remix.edit.state))) ? 2000 : false,
  });
}

/** Queues local cut detection on the chosen reference; nothing is generated or charged. */
export function useAnalyzeReference(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => apiJsonPost<{ runId: string }>(url(projectId), { action: 'analyze', assetId, requestId: crypto.randomUUID() }),
    onSuccess: () => client.invalidateQueries({ queryKey: key(projectId) }),
  });
}

export type RemixBuildResult = { offset: number; soundtrack: boolean; cameraMoves: number; texts: number; shots: Array<{ start: number; duration: number; assetId: string; filled: number }> };
export function useBuildRemix(projectId: string) {
  return useMutation({
    mutationFn: (input: { requestId: string; materials: string[]; keepSoundtrack: boolean; keepCamera: boolean; keepText: boolean; keepSpeed: boolean; transition: TimelineTransition | null }) =>
      apiJsonPost<RemixBuildResult>(url(projectId), { action: 'build', ...input }),
  });
}
