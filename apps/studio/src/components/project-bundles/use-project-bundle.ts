import { m as uiMessages } from '@/paraglide/messages.js';
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
    catch (error) { setError(controller.signal.aborted ? uiMessages["ui.project-bundles.stopped_no_existing_project_was_changed"]() : error instanceof Error ? error.message : uiMessages["ui.project-bundles.project_file_operation_failed"]()); }
    finally { pending.current = null; setBusy(null); }
  }
  const prepare = () => run(uiMessages["ui.project-bundles.preparing_project_file"](), async signal => {
    setPrepared(null);
    setPrepared(await apiJsonPost('/api/app/project-bundles', { projectId }, { signal }));
  });
  const inspect = (file: File) => run(uiMessages["ui.project-bundles.checking_media_and_edit_data"](), async signal => {
    setReview(null); setImported(null);
    if (file.size > 2 * 1024 * 1024 * 1024) throw Error(uiMessages["ui.project-bundles.choose_a_project_file_smaller_than_2_gib"]());
    const response = await fetch('/api/app/project-bundles', { method: 'POST', body: file, signal,
      headers: { 'Content-Type': 'application/x-tar', [WORKSPACE_MUTATION_HEADER]: '1' } });
    const body = await response.json(); if (!response.ok) throw Error(body.error || uiMessages["ui.project-bundles.unable_to_inspect_file"]());
    setReview(body);
  });
  const accept = () => run(uiMessages["ui.project-bundles.creating_your_editable_project"](), async signal => {
    if (!review) throw Error(uiMessages["ui.project-bundles.choose_and_inspect_a_project_file_first"]());
    const result = await apiJsonPost<{ projectId: string; status: string }>(`/api/app/project-bundles/${review.id}/accept`, { sha256: review.sha256 }, { signal });
    if (result.status !== 'active') throw Error(uiMessages["ui.project-bundles.this_file_review_was_already_imported_and_its_project_was_deleted_choose_th"]());
    setImported(result.projectId);
  });
  return { review, prepared, busy, error, imported, prepare, inspect, accept, cancel: () => pending.current?.abort() };
}
