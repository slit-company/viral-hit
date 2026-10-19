import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';
import type { PublicationView } from '@/core/publishing/public-view';
import type { PublicationRequest } from '@/core/publishing/requests';
import type { InstagramAccount } from '@/core/publishing/instagram-accounts-contract';
import type { AccountSnapshot } from '@/core/publishing/account-requests';

export type PublicationVideo = { id: string; filename: string | null; mimeType: string | null; storageProvider: string | null; sizeBytes: number | null };
type Snapshot = { project: { id: string; name: string }; configured: boolean; connectors: { youtube: boolean; instagram: boolean }; publications: PublicationView[] };
const headers = { [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE };
export function usePublications(projectId: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [accounts, setAccounts] = useState<AccountSnapshot | null>(null), [videos, setVideos] = useState<PublicationVideo[]>([]);
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccount[]>([]);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true), [pending, setPending] = useState(false);
  const mounted = useRef(false), reading = useRef(false), busy = useRef(false), sequence = useRef(0), abort = useRef<AbortController | null>(null);
  const endpoint = `/api/app/projects/${projectId}/publications`;
  const refresh = useCallback(async (options = true) => {
    const version = ++sequence.current; reading.current = true;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    try {
      const [next, channels, media, instagram] = await Promise.all([
        apiJsonGet<Snapshot>(endpoint, { headers, signal: controller.signal }),
        options ? apiJsonGet<AccountSnapshot>('/api/app/publishing/accounts', { headers, signal: controller.signal }) : null,
        options ? apiJsonGet<{ assets: PublicationVideo[] }>(`/api/app/projects/${projectId}/assets`, { signal: controller.signal }) : null,
        options ? apiJsonGet<{ accounts: InstagramAccount[] }>('/api/app/publishing/instagram/accounts', { headers, signal: controller.signal }) : null,
      ]);
      if (!mounted.current || sequence.current !== version) return;
      setSnapshot(next); if (instagram) setInstagramAccounts(instagram.accounts); if (channels) setAccounts(channels);
      if (media) setVideos(media.assets.filter(asset => asset.storageProvider === 'local' && ['video/mp4', 'video/webm'].includes(asset.mimeType ?? '')));
    } catch { if (mounted.current && !controller.signal.aborted && sequence.current === version) setError('Publishing could not be loaded. Refresh to try again.'); }
    finally { if (sequence.current === version) { reading.current = false; if (mounted.current) setLoading(false); } }
  }, [endpoint, projectId]);
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = setInterval(() => { if (!busy.current && !reading.current && document.visibilityState === 'visible') void refresh(false); }, 5000);
    return () => { mounted.current = false; clearInterval(timer); abort.current?.abort(); };
  }, [refresh]);
  async function change(request: PublicationRequest) {
    if (busy.current) return false;
    busy.current = true; setPending(true); setError(null); abort.current?.abort(); sequence.current++;
    try {
      await apiJsonPost<PublicationView>(endpoint, request);
      if (mounted.current) await refresh();
      return true;
    } catch (failure) {
      const message = failure instanceof ApiError ? failure.message : 'Publication request did not finish. Refresh before retrying.';
      if (mounted.current) { await refresh(); setError(message); }
      return false;
    } finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return { snapshot, accounts, instagramAccounts, videos, loading, pending, error, refresh: () => { setError(null); return refresh(); }, change };
}
