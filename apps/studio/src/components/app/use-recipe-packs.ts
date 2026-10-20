import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { PackCatalog, PackInspection, PackSummary } from '@/core/harness/recipe-packs';

const MAX_FILE_BYTES = 1_000_000;

/** Loading, review and installation for recipe packs; rendering lives in RecipePacks. */
export function useRecipePacks(onInstalled: (pack: PackSummary) => Promise<void>) {
  const [catalog, setCatalog] = useState<PackCatalog>();
  const [review, setReview] = useState<{ inspection: PackInspection; manifest: unknown; source?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const load = useCallback(async () => {
    try { setCatalog(await apiJsonGet<PackCatalog>('/api/app/recipe-packs')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Packs are unavailable'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function inspect(manifest: unknown) {
    const current = ++epoch.current; setBusy(true); setError(''); setReview(undefined);
    try {
      const inspection = await apiJsonPost<PackInspection>('/api/app/recipe-packs', { action: 'inspect', pack: manifest });
      if (current === epoch.current) setReview({ inspection, manifest });
    } catch (cause) { if (current === epoch.current) setError(cause instanceof Error ? cause.message : 'Could not review pack'); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function fetchLink(url: string) {
    const current = ++epoch.current; setBusy(true); setError(''); setReview(undefined);
    try {
      const result = await apiJsonPost<{ source: string; manifest: unknown; inspection: PackInspection }>('/api/app/recipe-packs', { action: 'fetch', url: url.trim() });
      if (current === epoch.current) setReview(result);
    } catch (cause) { if (current === epoch.current) setError(cause instanceof Error ? cause.message : 'Could not download pack'); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function importFile(file?: File) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setError('Pack files must be 1 MB or smaller.'); return; }
    try { await inspect(JSON.parse(await file.text())); }
    catch (cause) { setError(cause instanceof SyntaxError ? 'This file is not valid JSON.' : cause instanceof Error ? cause.message : 'Could not read file'); }
  }
  async function install() {
    if (!review) return;
    setBusy(true); setError('');
    try {
      const result = await apiJsonPost<{ pack: PackSummary }>('/api/app/recipe-packs', { action: 'install', pack: review.manifest, expectedDigest: review.inspection.pack.digest });
      setReview(undefined); await load(); await onInstalled(result.pack);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not install pack'); }
    finally { setBusy(false); }
  }
  return { catalog, review, busy, error, inspect, fetchLink, importFile, install, dismiss: () => { epoch.current++; setReview(undefined); setBusy(false); } };
}
