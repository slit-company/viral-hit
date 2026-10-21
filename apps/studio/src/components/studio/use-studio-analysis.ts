import { useEffect, useState } from 'react';
import { useWorkspaceModels } from '@/core/workspace-hooks/use-workspace-metadata';
import { appendAnalysisSource, newStudioAnalysisDraft, restoreStudioAnalysisHistory, studioAnalysisDraftSchema, studioAnalysisRequest, type StudioAnalysisDraft } from '@/core/studio/studio-analysis';
import { useStudioSourceActions } from './use-studio-source-actions';

export function useStudioAnalysis({ projectId, initialModelId, initialPrompt, onError }: { projectId: string; initialModelId?: string; initialPrompt?: string; onError: (message: string) => void }) {
  const { data } = useWorkspaceModels();
  const models = data?.models.filter(model => model.workspaceType === 'analysis') ?? [];
  const [draft, setDraft] = useState(() => newStudioAnalysisDraft(initialModelId, initialPrompt));
  const [restoredKey, setRestoredKey] = useState('');
  const [unreadableDraft, setUnreadableDraft] = useState(false);
  const key = `viral-hit:studio-analysis:${projectId}`;
  const model = models.find(item => item.id === draft.modelId);
  const actions = useStudioSourceActions({ projectId, draft, setDraft, model, append: appendAnalysisSource, restore: restoreStudioAnalysisHistory, onError });
  const { locked } = actions;
  useEffect(() => {
    setRestoredKey(''); setUnreadableDraft(false);
    let next = newStudioAnalysisDraft(initialModelId, initialPrompt);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) { if (raw.length > 128_000) throw Error('Draft exceeds storage limit'); next = studioAnalysisDraftSchema.parse(JSON.parse(raw)); }
      setRestoredKey(key);
    } catch { setUnreadableDraft(true); }
    // Always reset project-local state and fence pending work, even if storage is unreadable.
    setDraft(next);
  }, [key]);
  useEffect(() => {
    if (restoredKey !== key) return;
    try { sessionStorage.setItem(key, JSON.stringify(draft)); }
    catch { onError('Browser draft storage is unavailable. Completed analyses remain in project history.'); }
  }, [key, draft, restoredKey]);
  function update(patch: Partial<StudioAnalysisDraft>) { if (!locked.current) setDraft(current => ({ ...current, ...patch })); }
  function replaceUnreadableDraft() {
    if (locked.current) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(draft));
      setRestoredKey(key); setUnreadableDraft(false); onError('');
    } catch { onError('Browser draft storage is unavailable. Completed analyses remain in project history.'); }
  }
  return { draft, models, model, busy: actions.busy, unreadableDraft, replaceUnreadableDraft, update, add: actions.add, upload: actions.upload, reuse: actions.reuse, request: () => studioAnalysisRequest(projectId, draft, model) };
}
export type StudioAnalysisController = ReturnType<typeof useStudioAnalysis>;
