import { useEffect, useState } from 'react';
import { useWorkspaceModels } from '@/core/workspace-hooks/use-workspace-metadata';
import type { ProjectGenerationItem } from '@/core/effects/project-generations';
import { newStudioAudioDraft, restoreStudioAudioHistory, studioAudioDraftSchema, studioAudioRequest, type StudioAudioDraft } from '@/core/studio/studio-audio';

export function useStudioAudio({ projectId, initialModelId, initialPrompt, onError }: { projectId: string; initialModelId?: string; initialPrompt?: string; onError: (message: string) => void }) {
  const { data } = useWorkspaceModels();
  const models = data?.models.filter(model => model.workspaceType === 'ai-audio') ?? [];
  const [draft, setDraft] = useState(() => newStudioAudioDraft(initialModelId, initialPrompt));
  const [restoredKey, setRestoredKey] = useState(''), [unreadableDraft, setUnreadableDraft] = useState(false);
  const key = `viral-hit:studio-audio:${projectId}`;
  const model = models.find(item => item.id === draft.modelId);
  useEffect(() => {
    setRestoredKey(''); setUnreadableDraft(false);
    let next = newStudioAudioDraft(initialModelId, initialPrompt);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) { if (raw.length > 128_000) throw Error('Draft exceeds storage limit'); next = studioAudioDraftSchema.parse(JSON.parse(raw)); }
      setRestoredKey(key);
    } catch { setUnreadableDraft(true); }
    setDraft(next);
  }, [key]);
  useEffect(() => {
    if (draft.modelId || !data) return;
    const first = models.find(item => item.available !== false);
    if (first) setDraft(current => current.modelId ? current : { ...current, modelId: first.id });
  }, [data, draft.modelId]);
  function save() {
    const serialized = JSON.stringify(draft);
    if (serialized.length > 128_000) throw Error('Audio draft is too large for browser recovery. Reduce option text.');
    sessionStorage.setItem(key, serialized);
  }
  useEffect(() => {
    if (restoredKey !== key) return;
    try { save(); }
    catch { onError('Browser draft storage is unavailable or full. Completed audio remains in project history.'); }
  }, [key, draft, restoredKey]);
  function replaceUnreadableDraft() {
    try { save(); setRestoredKey(key); setUnreadableDraft(false); onError(''); }
    catch { onError('Browser draft storage is unavailable or full.'); }
  }
  function reuse(item: ProjectGenerationItem) {
    try { setDraft(restoreStudioAudioHistory(item)); onError(''); }
    catch (error) { onError((error as Error).message); }
  }
  return { draft, models, model, unreadableDraft, replaceUnreadableDraft, reuse,
    update: (patch: Partial<StudioAudioDraft>) => setDraft(current => ({ ...current, ...patch })),
    request: () => studioAudioRequest(projectId, draft, model) };
}
export type StudioAudioController = ReturnType<typeof useStudioAudio>;
