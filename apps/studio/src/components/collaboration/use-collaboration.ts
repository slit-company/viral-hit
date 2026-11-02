import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { CollaborationView, OwnerCollaborationRequest, SharedProjectView } from '@/core/collaboration/contract';

const ownerUrl = (projectId: string) => '/api/app/projects/' + encodeURIComponent(projectId) + '/collaboration';
const sharedUrl = (token: string) => '/api/shared/' + encodeURIComponent(token);
const ownerKey = (projectId: string) => ['collaboration', projectId];

/** Links and comments of a project, refreshed every 20 s so reviewers' notes appear while editing. */
export function useCollaboration(projectId: string) {
  return useQuery({ queryKey: ownerKey(projectId), queryFn: () => apiJsonGet<CollaborationView>(ownerUrl(projectId)), refetchInterval: 20_000 });
}

export function useCollaborationAction(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: OwnerCollaborationRequest) => apiJsonPost<{ path?: string }>(ownerUrl(projectId), request),
    onSuccess: () => client.invalidateQueries({ queryKey: ownerKey(projectId) }),
  });
}

export function useSharedProject(token: string) {
  return useQuery({ queryKey: ['shared-project', token], queryFn: () => apiJsonGet<SharedProjectView>(sharedUrl(token)), refetchInterval: 20_000, retry: false });
}

export function useSharedAction(token: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: { action: 'comment'; name: string; body: string; anchor: { time?: number } } | { action: 'resolve'; name: string; commentId: string; resolved: boolean }) => apiJsonPost(sharedUrl(token), request),
    onSuccess: () => client.invalidateQueries({ queryKey: ['shared-project', token] }),
  });
}

/** 75.4 → "1:15". */
export const clock = (seconds: number) => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
