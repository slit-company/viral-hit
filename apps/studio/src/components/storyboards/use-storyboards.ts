import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { StoryboardPlan, StoryboardState, StoryboardView, StoryboardSummary, StoryboardActionView, StoryboardRequest } from '@/core/storyboards/contract';
import type { RecipeCatalog } from '@/core/harness/recipe-library-contract';
import type { RecipeInputAsset, AssetCapability } from '@/core/harness/recipe-assets';
import type { PrepareReference, ReferenceSources } from '@/core/storyboards/reference-input';
import { newDraft, readDraft, readPending, planToSave, type BoardDraft, type PendingShotAction } from './draft';

export type BoardAsset = RecipeInputAsset & { sha256: string | null; durationMs: number | null };
type Catalog = { referenceSources: ReferenceSources; boards: StoryboardSummary[]; assets: BoardAsset[]; recipes: RecipeCatalog; capabilities: AssetCapability[] };
export function useStoryboards(projectId: string) {
  const endpoint = '/api/app/projects/' + encodeURIComponent(projectId);
  const storageKey = 'viral-hit:storyboard:' + projectId;
  const [catalog, setCatalog] = useState<Catalog>();
  const [view, setView] = useState<StoryboardView>();
  const [draft, setDraft] = useState<BoardDraft>();
  const [pending, setPending] = useState<PendingShotAction>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [restored, setRestored] = useState(false);
  const epoch = useRef(0), active = useRef<AbortController | null>(null), locked = useRef(false);
  const dirty = !!draft && (!view || draft.id !== view.id || draft.revision !== view.revision || JSON.stringify(draft.plan) !== JSON.stringify(view.plan));
  const stale = !!draft && !!view && draft.id === view.id && draft.revision !== view.revision;
  const work = useCallback(async (task: (signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    const token = ++epoch.current, controller = new AbortController(); active.current = controller;
    const current = () => token === epoch.current;
    try { await task(controller.signal, current); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Storyboard request failed'); }
    finally { if (current()) { locked.current = false; setBusy(false); } }
  }, []);
  const loadCatalog = useCallback(async (signal: AbortSignal): Promise<Catalog> => {
    const [boards, media, recipes, runs, referenceSources] = await Promise.all([
      apiJsonGet<StoryboardSummary[]>(endpoint + '/storyboards', { signal }),
      apiJsonGet<{ assets: BoardAsset[] }>(endpoint + '/assets', { signal }),
      apiJsonGet<RecipeCatalog>('/api/app/recipes', { signal }),
      apiJsonGet<{ capabilities: AssetCapability[] }>(endpoint + '/runs', { signal }),
      apiJsonPost<ReferenceSources>(endpoint + '/storyboards', { action: 'reference-sources' }, { signal }),
    ]);
    return { referenceSources, boards, assets: media.assets, recipes, capabilities: runs.capabilities };
  }, [endpoint]);
  const post = <T,>(request: StoryboardRequest, signal: AbortSignal) => apiJsonPost<T>(endpoint + '/storyboards', request, { signal });
  useEffect(() => {
    locked.current = false; setRestored(false); setDraft(undefined); setView(undefined); setCatalog(undefined); setPending(undefined);
    void work(async (signal, current) => {
      const next = await loadCatalog(signal);
      let local: BoardDraft | undefined, request: PendingShotAction | undefined;
      try {
        const raw = sessionStorage.getItem(storageKey); if (raw) local = readDraft(raw);
        const action = sessionStorage.getItem(storageKey + ':pending'); if (action) request = readPending(action);
      } catch { if (current()) setNotice('A stored draft could not be restored. Its stored copy has not been deleted.'); }
      let server: StoryboardView | undefined;
      if (local && next.boards.some(board => board.id === local!.id)) server = await apiJsonPost<StoryboardView>(endpoint + '/storyboards', { action: 'read', id: local.id }, { signal });
      if (current()) { setCatalog(next); setDraft(local); setView(server); setPending(request); setRestored(true); }
    });
    return () => { epoch.current++; active.current?.abort(); locked.current = false; };
  }, [loadCatalog, endpoint, storageKey, work]);
  useEffect(() => {
    if (!restored || !draft) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); }
    catch { setError('Browser draft storage is unavailable. Download your plan before leaving.'); }
  }, [draft, restored, storageKey]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, pending]);
  function update(plan: StoryboardPlan) { if (!busy && draft) setDraft({ ...draft, plan }); }
  function create() { if (busy || dirty || pending) return; setView(undefined); setDraft(newDraft()); setNotice(''); }
  async function prepareReference(request: PrepareReference) {
    if (busy || dirty || pending) return false;
    let prepared = false;
    await work(async (signal, current) => {
      // Send only the reviewed identity fields, not catalog presentation metadata.
      const identity = (item: PrepareReference['scenes']) => ({ runId: item.runId, jobId: item.jobId, outputSha256: item.outputSha256 });
      const result = await post<{ plan: StoryboardPlan; warnings: string[] }>({ ...request, scenes: identity(request.scenes), ...(request.transcript ? { transcript: identity(request.transcript) } : {}) }, signal);
      if (current()) { setView(undefined); setDraft({ ...newDraft(), plan: result.plan }); setNotice(result.warnings.join(' ')); prepared = true; }
    });
    return prepared;
  }
  function open(id: string) {
    if (dirty || pending) return;
    return work(async (signal, current) => {
      const next = await post<StoryboardView>({ action: 'read', id }, signal);
      if (current()) { setView(next); setDraft({ id, revision: next.revision, plan: next.plan }); setNotice(''); }
    });
  }
  function refresh() {
    return work(async (signal, current) => {
      const next = await loadCatalog(signal);
      const server = draft && next.boards.some(board => board.id === draft.id) ? await post<StoryboardView>({ action: 'read', id: draft.id }, signal) : undefined;
      if (current()) {
        setCatalog(next); setView(server);
        if (!dirty && server) setDraft({ id: server.id, revision: server.revision, plan: server.plan });
        setNotice(dirty ? 'Server refreshed. Your local plan is preserved.' : 'Status refreshed.');
      }
    });
  }
  function useServer() {
    if (busy || pending) return;
    if (view) setDraft({ id: view.id, revision: view.revision, plan: view.plan });
    else { setDraft(undefined); sessionStorage.removeItem(storageKey); }
    setNotice('Local changes discarded.'); setError('');
  }
  function save(replaceReviewedRevision = false) {
    if (!draft || (stale && !replaceReviewedRevision)) return;
    return work(async (signal, current) => {
      const state = await post<StoryboardState>({ action: 'save', id: draft.id, expectedRevision: replaceReviewedRevision ? view!.revision : draft.revision, plan: planToSave(draft.plan) }, signal);
      if (current()) { setView({ ...state, actions: view?.actions ?? [] }); setDraft({ id: state.id, revision: state.revision, plan: state.plan }); setNotice('Saved revision ' + state.revision + '.'); }
      const next = await loadCatalog(signal); if (current()) setCatalog(next);
    });
  }
  function execute(request: PendingShotAction, recovering = false) {
    return work(async (signal, current) => {
      // Persist the exact request before submitting. A lost response retains this identity across reload.
      sessionStorage.setItem(storageKey + ':pending', JSON.stringify(request)); setPending(request);
      try {
        const action = await post<StoryboardActionView>(request, signal);
        sessionStorage.removeItem(storageKey + ':pending');
        if (current()) {
          setPending(undefined);
          setView(previous => previous?.id === action.boardId ? { ...previous, actions: [action, ...previous.actions.filter(item => item.requestId !== action.requestId)] } : previous);
          setNotice('Saved request ' + action.requestId + '. Refresh status after the worker runs.');
        }
      } catch (cause) {
        if (!recovering && cause instanceof ApiError && typeof cause.data === 'object' && cause.data && 'reserved' in cause.data && cause.data.reserved === false) {
          sessionStorage.removeItem(storageKey + ':pending'); if (current()) setPending(undefined);
        }
        throw cause;
      }
    });
  }
  function generate(shotId: string) {
    if (dirty || !view || pending) return;
    return execute({ action: 'generate', id: view.id, expectedRevision: view.revision, shotId, requestId: crypto.randomUUID() });
  }
  function assemble() {
    if (dirty || !view || pending) return;
    return execute({ action: 'assemble', id: view.id, expectedRevision: view.revision, requestId: crypto.randomUUID() });
  }
  function recover() { if (pending) return execute(pending, true); }
  function accept(shotId: string, source: Extract<StoryboardRequest, { action: 'accept' }>['source'], inPoint: number, notes: string) {
    if (dirty || !view || pending) return;
    return work(async (signal, current) => {
      const state = await post<StoryboardState>({ action: 'accept', id: view.id, expectedRevision: view.revision, shotId, source, inPoint, notes }, signal);
      if (current()) { setView({ ...state, actions: view.actions }); setDraft({ id: state.id, revision: state.revision, plan: state.plan }); setNotice('Result accepted for ' + shotId + '.'); }
      const next = await loadCatalog(signal); if (current()) setCatalog(next);
    });
  }
  return { prepareReference, catalog, view, draft, busy, dirty, stale, pending, error, notice, update, create, open, refresh, useServer, save, generate, assemble, recover, accept };
}
export type StoryboardController = ReturnType<typeof useStoryboards>;
