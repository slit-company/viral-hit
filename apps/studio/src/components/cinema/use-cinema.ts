import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { addProjectAssetsToTimeline } from '@/core/editor/timeline-client';
import { fetchRecentAssets } from '@/core/workspace-lib/app/workspace-client-api';
import type { ShotRunView } from '@/core/shot-harness/contract';
import type { TakeQuality } from '@/core/shot-harness/quality';
import type { ShotSpecInput } from '@/core/shot-harness/spec';

export type ShotStepView = { modelId: string; modelName: string; provider: string; prompt: string; dropped: string[]; parameters: Record<string, unknown> };
export type Alternative = { id: string; name: string; score: number; reasons: string[] };
export type ProductionView = { still: ShotStepView | null; video: ShotStepView; variations: number; notes: string[]; alternatives: { video: Alternative[]; still: Alternative[] } };
export type CinemaDraft = ShotSpecInput & { subject: string; moves: string[]; characterAssetIds: string[] };

export const DEFAULT_DRAFT: CinemaDraft = { subject: '', action: '', setting: '', moves: ['dolly-in'], mood: '', audio: '', duration: 5, aspectRatio: '16:9', startFrame: 'generate', characterAssetIds: [], videoModel: 'auto', imageModel: 'auto', provider: 'any', variations: 2 };
const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'cancelled', 'uncertain', 'blocked']);
const shotsKey = (projectId: string) => ['cinema-shots', projectId];
const url = (projectId: string) => '/api/app/projects/' + encodeURIComponent(projectId) + '/shots';

/** The shot being written, kept per project in this browser until it is rendered or changed. */
export function useCinemaDraft(projectId: string) {
  const key = 'viral-hit:cinema:' + projectId;
  const [draft, setDraft] = useState<CinemaDraft>(DEFAULT_DRAFT);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try { const saved = localStorage.getItem(key); setDraft(saved ? { ...DEFAULT_DRAFT, ...JSON.parse(saved) } : DEFAULT_DRAFT); } catch { setDraft(DEFAULT_DRAFT); }
    setLoaded(true);
  }, [key]);
  useEffect(() => { if (loaded) try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* storage unavailable */ } }, [key, loaded, draft]);
  const update = (patch: Partial<CinemaDraft>) => setDraft(current => {
    const next = { ...current, ...patch };
    if (next.startFrame === 'none' && !next.startAssetId) next.endAssetId = undefined;
    return next;
  });
  return { draft, update, loaded };
}

/** The plan for the current draft, recomputed shortly after typing stops. Previews never spend credits. */
export function useShotPreview(projectId: string, draft: CinemaDraft) {
  const [settled, setSettled] = useState(draft);
  useEffect(() => { const timer = window.setTimeout(() => setSettled(draft), 450); return () => window.clearTimeout(timer); }, [draft]);
  const query = useQuery({
    queryKey: ['cinema-preview', projectId, JSON.stringify(settled)],
    queryFn: () => apiJsonPost<{ production: ProductionView }>(url(projectId), { action: 'preview', spec: settled }).then(result => result.production),
    enabled: settled.subject.trim().length > 0, retry: false, staleTime: 60_000,
  });
  return { ...query, isFetching: query.isFetching || JSON.stringify(draft) !== JSON.stringify(settled) };
}

export function useShotRuns(projectId: string) {
  return useQuery({
    queryKey: shotsKey(projectId),
    queryFn: () => apiJsonGet<{ shots: ShotRunView[] }>(url(projectId)).then(result => result.shots),
    refetchInterval: query => query.state.data?.some(shot => [shot.still, ...shot.takes].some(take => take && !TERMINAL.has(take.state))) ? 4000 : false,
  });
}

export function useProduceShot(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (spec: CinemaDraft) => apiJsonPost<{ runId: string }>(url(projectId), { action: 'produce', spec, requestId: crypto.randomUUID() }),
    onSuccess: () => client.invalidateQueries({ queryKey: shotsKey(projectId) }),
  });
}

const qualityQuery = (projectId: string, assetId: string | undefined, expect: { durationSec: number | null; audio: boolean }) => ({
  queryKey: ['cinema-quality', projectId, assetId, expect.durationSec, expect.audio],
  queryFn: () => apiJsonPost<{ quality: TakeQuality }>(url(projectId), { action: 'quality', assetId, ...(expect.durationSec ? { durationSec: expect.durationSec } : {}), audio: expect.audio }).then(result => result.quality),
  staleTime: Infinity, retry: false,
});

/** Decodes a finished take once; the result does not change for the same file. */
export function useTakeQuality(projectId: string, assetId: string | undefined, expect: { durationSec: number | null; audio: boolean }) {
  return useQuery({ ...qualityQuery(projectId, assetId, expect), enabled: Boolean(assetId) });
}

/** Adds project videos to the end of the timeline in the given order. */
async function addVideos(projectId: string, assetIds: string[]) {
  const recent = await fetchRecentAssets(projectId);
  const assets = assetIds.map(id => recent.videos.find(asset => asset.id === id)).filter(asset => asset !== undefined);
  if (!assets.length) throw Error('The takes are not in this project any more');
  await addProjectAssetsToTimeline({ projectId, assets: assets.map(asset => ({ asset, mediaType: 'video' as const })) });
  return assets.length;
}

export function useAddTake(projectId: string) {
  return useMutation({ mutationFn: (assetId: string) => addVideos(projectId, [assetId]) });
}

/** For every shot, oldest first, the finished take with the best quality score goes onto the timeline. */
export function useAssembleBest(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (shots: ShotRunView[]) => {
      const chosen: string[] = [];
      for (const shot of [...shots].sort((left, right) => left.createdAt - right.createdAt)) {
        let best: { assetId: string; score: number } | null = null;
        for (const take of shot.takes) {
          if (!take.assetId) continue;
          const quality = await client.fetchQuery(qualityQuery(projectId, take.assetId, shot));
          if (!best || quality.score > best.score) best = { assetId: take.assetId, score: quality.score };
        }
        if (best) chosen.push(best.assetId);
      }
      return addVideos(projectId, chosen);
    },
  });
}
