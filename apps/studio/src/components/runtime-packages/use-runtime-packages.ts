import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { MAX_RUNTIME_PACKAGE_BYTES } from '@/core/runtime-packages/limits';
import type { RuntimePackage, RuntimePackageCatalog, RuntimePackageHistory } from '@/core/runtime-packages/contract';
import type { RuntimePackageInspection, RuntimePackageRemoval } from '@/core/runtime-packages/service.server';

const endpoint = '/api/app/runtime-packages';
export type RuntimeView =
  | { kind: 'review'; inspection: RuntimePackageInspection }
  | { kind: 'remove'; review: RuntimePackageRemoval }
  | { kind: 'history'; history: RuntimePackageHistory };

export function downloadRuntimePackage(pkg: RuntimePackage) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(pkg)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = pkg.id + '-v' + pkg.version + '.viralhit-runtime.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useRuntimePackages() {
  const [catalog, setCatalog] = useState<RuntimePackageCatalog>();
  const [view, setView] = useState<RuntimeView>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const epoch = useRef(0), active = useRef<AbortController | null>(null);
  const work = useCallback(async <T,>(task: (signal: AbortSignal) => Promise<T>, accept: (result: T) => void) => {
    const current = ++epoch.current;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError('');
    try {
      const result = await task(controller.signal);
      if (current === epoch.current) accept(result);
    } catch (cause) {
      if (current === epoch.current) setError(cause instanceof Error ? cause.message : 'Runtime package request failed.');
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }, []);
  const refresh = useCallback(() => work(signal => apiJsonGet<RuntimePackageCatalog>(endpoint, { signal, cache: 'no-store' }), setCatalog), [work]);
  useEffect(() => { void refresh(); return () => { epoch.current++; active.current?.abort(); }; }, [refresh]);

  function showReview(inspection: RuntimePackageInspection) {
    setView({ kind: 'review', inspection }); setStale(false); setNotice('');
  }
  function importFile(file?: File) {
    if (!file) return;
    setView(undefined); setNotice('');
    return work(async signal => {
      if (file.size < 1 || file.size > MAX_RUNTIME_PACKAGE_BYTES) throw new Error('Choose a runtime JSON file up to 12 MB.');
      let pkg: unknown;
      try { pkg = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON.'); }
      return apiJsonPost<RuntimePackageInspection>(endpoint, { action: 'inspect', package: pkg }, { signal });
    }, showReview);
  }
  function reviewAgain() {
    if (view?.kind === 'review') return work(signal => apiJsonPost<RuntimePackageInspection>(endpoint, { action: 'inspect', package: view.inspection.package }, { signal }), showReview);
    if (view?.kind === 'remove') return reviewRemoval(view.review.current.id);
  }
  function reviewRemoval(id: string) {
    return work(signal => apiJsonPost<RuntimePackageRemoval>(endpoint, { action: 'review-remove', id }, { signal }), review => {
      setView({ kind: 'remove', review }); setStale(false); setNotice('');
    });
  }
  function history(id: string) {
    return work(signal => apiJsonPost<RuntimePackageHistory>(endpoint, { action: 'history', id }, { signal }), history => {
      setView({ kind: 'history', history }); setNotice('');
    });
  }
  function release(id: string, digest: string, restore: boolean) {
    return work(async signal => {
      const pkg = await apiJsonPost<RuntimePackage>(endpoint, { action: 'export', id, digest }, { signal });
      if (restore) return apiJsonPost<RuntimePackageInspection>(endpoint, { action: 'inspect', package: pkg }, { signal });
      return pkg;
    }, result => { if ('package' in result) showReview(result); else downloadRuntimePackage(result); });
  }
  function apply() {
    if (!view || view.kind === 'history' || stale) return;
    const request = view.kind === 'review'
      ? { action: 'apply', package: view.inspection.package, expectedDigest: view.inspection.digest, expectedStateDigest: view.inspection.stateDigest, trustCode: true }
      : { action: 'remove', id: view.review.current.id, expectedStateDigest: view.review.stateDigest };
    const id = view.kind === 'review' ? view.inspection.package.id : view.review.current.id;
    setStale(true);
    return work(async signal => {
      await apiJsonPost(endpoint, request, { signal });
      return apiJsonGet<RuntimePackageCatalog>(endpoint, { signal, cache: 'no-store' });
    }, next => {
      setCatalog(next); setView(undefined);
      setNotice(id + (request.action === 'remove' ? ' was removed from the installed set.' : ' was saved to the installed set.') + (next.restartRequired ? ' Restart the studio, MCP and workers together to activate the change.' : ' The loaded set already matches.'));
    });
  }
  function close() {
    if (busy) return;
    epoch.current++; active.current?.abort(); setView(undefined); setError(''); setStale(false);
  }
  return { catalog, view, busy, error, notice, stale, refresh, importFile, reviewAgain, reviewRemoval, history, release, apply, close };
}
