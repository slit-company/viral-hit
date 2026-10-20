import { useEffect, useRef, useState } from 'react';
import { apiJsonPost } from '@/lib/api-client';
import { WORKSPACE_MUTATION_HEADER } from '@/lib/trusted-local-request';
import type { inspectProjectBundle } from '@/core/projects/bundles/import.server';
import type { exportProjectBundle } from '@/core/projects/bundles/export.server';

type Review = Awaited<ReturnType<typeof inspectProjectBundle>>;
type Prepared = Awaited<ReturnType<typeof exportProjectBundle>>;
export function useProjectBundle(projectId?: string | null) {
  const [review, setReview] = useState<Review | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function run(label: string, task: (signal: AbortSignal) => Promise<void>) {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(label); setError(null);
    try { await task(controller.signal); }
    catch (error) { setError(controller.signal.aborted ? 'Stopped. No existing project was changed.' : error instanceof Error ? error.message : 'Project file operation failed'); }
    finally { pending.current = null; setBusy(null); }
  }
  const prepare = () => run('Preparing project file…', async signal => {
    setPrepared(null);
    setPrepared(await apiJsonPost('/api/app/project-bundles', { projectId }, { signal }));
  });
  const inspect = (file: File) => run('Checking media and edit data…', async signal => {
    setReview(null); setImported(null);
    if (file.size > 2 * 1024 * 1024 * 1024) throw Error('Choose a project file smaller than 2 GiB');
    const response = await fetch('/api/app/project-bundles', { method: 'POST', body: file, signal,
      headers: { 'Content-Type': 'application/x-tar', [WORKSPACE_MUTATION_HEADER]: '1' } });
    const body = await response.json(); if (!response.ok) throw Error(body.error || 'Unable to inspect file');
    setReview(body);
  });
  const accept = () => run('Creating your editable project…', async signal => {
    if (!review) throw Error('Choose and inspect a project file first');
    const result = await apiJsonPost<{ projectId: string; status: string }>(`/api/app/project-bundles/${review.id}/accept`, { sha256: review.sha256 }, { signal });
    if (result.status !== 'active') throw Error('This file review was already imported and its project was deleted. Choose the file again to create a new copy.');
    setImported(result.projectId);
  });
  return { review, prepared, busy, error, imported, prepare, inspect, accept, cancel: () => pending.current?.abort() };
}
