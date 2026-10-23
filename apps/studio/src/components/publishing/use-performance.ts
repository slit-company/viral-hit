import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';
import type { readPerformance } from '@/core/measurement/application.server';
import type { MeasurementRequest } from '@/core/measurement/contract';

export type PerformanceSnapshot = Awaited<ReturnType<typeof readPerformance>>;
export type PerformanceItem = PerformanceSnapshot['items'][number];
const headers = { [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE };

/** Loads project performance and sends collect/record requests; refreshes after each change. */
export function usePerformance(projectId: string) {
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(false), abort = useRef<AbortController | null>(null);
  const endpoint = '/api/app/projects/' + projectId + '/performance';
  const refresh = useCallback(async () => {
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    try { const next = await apiJsonGet<PerformanceSnapshot>(endpoint, { headers, signal: controller.signal }); if (mounted.current) setSnapshot(next); }
    catch { if (mounted.current && !controller.signal.aborted) setError('Performance could not be loaded. Refresh to try again.'); }
  }, [endpoint]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; abort.current?.abort(); }; }, [refresh]);
  async function change(request: MeasurementRequest) {
    if (busy) return false;
    setBusy(request.publicationId); setError(null);
    try { await apiJsonPost(endpoint, request, { headers }); await refresh(); return true; }
    catch (failure) { if (mounted.current) setError(failure instanceof ApiError ? failure.message : 'The reading did not finish. Refresh before retrying.'); return false; }
    finally { if (mounted.current) setBusy(null); }
  }
  return { snapshot, error, busy, refresh: () => { setError(null); return refresh(); }, change };
}
