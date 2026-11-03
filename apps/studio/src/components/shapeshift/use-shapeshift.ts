import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { RecentAsset } from '@/core/workspace-lib/app/workspace-client-api';
import type { ShapeshiftCandidate, ShapeshiftMode, ShapeshiftPlan, ShapeshiftRequest, ShapeshiftView } from '@/core/shapeshift/contract';

export const shapeshiftApi = (projectId: string) => '/api/app/projects/' + encodeURIComponent(projectId) + '/shapeshifts';
export type ShapeshiftDraft = Omit<Extract<ShapeshiftRequest, { action: 'plan' }>, 'action'>;
export const pieceFailed = (state: string) => state === 'failed' || state === 'cancelled' || state === 'uncertain';
/** A run is still moving while a variation has neither a result nor a stopped piece. */
export const runActive = (run: ShapeshiftView) => run.variations.some(variation => !variation.resultAssetId && !variation.pieces.some(piece => pieceFailed(piece.state)));

/** The value after it has stopped changing for a moment, compared by content. */
export function useDebounced<T>(value: T, delay = 600) {
  const [current, setCurrent] = useState(value), key = JSON.stringify(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = setTimeout(() => setCurrent(value), delay); return () => clearTimeout(timer); }, [key, delay]);
  return current;
}

export type ProjectMedia = RecentAsset & { kind: 'image' | 'video'; category?: string | null };
type ProjectAsset = RecentAsset & { type: string; category?: string | null; source?: string | null };

/** Project videos and images, newest first, without the pieces and frames other tools cut from them. */
export function useProjectMedia(projectId: string) {
  return useQuery({ queryKey: ['shapeshift-media', projectId], staleTime: 10_000, queryFn: async () => {
    const { assets } = await apiJsonGet<{ assets: ProjectAsset[] }>('/api/app/projects/' + encodeURIComponent(projectId) + '/assets');
    // An asset linked to the project in two roles is listed twice; keep its first listing.
    const seen = new Set<string>(), usable = assets.filter(asset => !(asset.source === 'derived' && asset.category === 'reference') && !seen.has(asset.id) && Boolean(seen.add(asset.id)))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    const of = (kind: 'image' | 'video'): ProjectMedia[] => usable.filter(asset => asset.type === kind).map(asset => ({ ...asset, kind }));
    return { videos: of('video'), images: of('image') };
  } });
}

export function useShapeshiftModels(projectId: string, mode: ShapeshiftMode) {
  return useQuery({ queryKey: ['shapeshift-models', projectId, mode], staleTime: 60_000,
    queryFn: () => apiJsonPost<{ models: ShapeshiftCandidate[] }>(shapeshiftApi(projectId), { action: 'models', mode }).then(result => result.models) });
}

/** Models, pieces and price for the current settings; nothing is spent. */
export function useShapeshiftPlan(projectId: string, draft: ShapeshiftDraft | null) {
  return useQuery({ queryKey: ['shapeshift-plan', projectId, draft], enabled: Boolean(draft), retry: false, staleTime: 60_000,
    queryFn: () => apiJsonPost<{ plan: ShapeshiftPlan }>(shapeshiftApi(projectId), { action: 'plan', ...draft! }).then(result => result.plan) });
}

export function useShapeshifts(projectId: string) {
  return useQuery({ queryKey: ['shapeshifts', projectId], queryFn: () => apiJsonGet<{ shapeshifts: ShapeshiftView[] }>(shapeshiftApi(projectId)).then(result => result.shapeshifts),
    refetchInterval: query => (query.state.data ?? []).some(runActive) ? 4_000 : false });
}

export function useProduceShapeshift(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: ShapeshiftDraft) => apiJsonPost<{ runId: string }>(shapeshiftApi(projectId), { action: 'produce', requestId: crypto.randomUUID(), ...draft }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['shapeshifts', projectId] }),
  });
}

/** Joins each variation as soon as all its pieces arrive; every state is asked for once per visit. */
export function useAutoFinish(projectId: string, runs: readonly ShapeshiftView[] | undefined) {
  const client = useQueryClient(), asked = useRef(new Set<string>());
  const [joining, setJoining] = useState<string[]>([]), [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const run of runs ?? []) {
      const ready = run.variations.some(variation => !variation.resultAssetId && variation.pieces.length > 0 && variation.pieces.every(piece => piece.outputAssetId));
      const key = run.requestId + ':' + run.variations.filter(variation => variation.resultAssetId).length;
      if (!ready || asked.current.has(key)) continue;
      asked.current.add(key);
      setJoining(current => [...current, run.requestId]);
      apiJsonPost(shapeshiftApi(projectId), { action: 'finish', requestId: run.requestId })
        .catch((failure: unknown) => setErrors(current => ({ ...current, [run.requestId]: failure instanceof Error ? failure.message : String(failure) })))
        .finally(() => { setJoining(current => current.filter(id => id !== run.requestId)); void client.invalidateQueries({ queryKey: ['shapeshifts', projectId] }); });
    }
  }, [runs, projectId, client]);
  return { joining, errors };
}
