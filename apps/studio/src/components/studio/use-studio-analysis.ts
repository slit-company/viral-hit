import { useEffect, useRef, useState } from 'react';
import { useWorkspaceModels } from '@/core/workspace-hooks/use-workspace-metadata';
import { uploadLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';
import { detectUploadedMediaType } from '@/core/effects/validation';
import type { ProjectGenerationItem } from '@/core/effects/project-generations';
import { apiJsonGet } from '@/lib/api-client';
import { appendAnalysisSource, newStudioAnalysisDraft, restoreStudioAnalysisHistory, studioAnalysisDraftSchema, studioAnalysisRequest, type StudioAnalysisDraft, type StudioAnalysisSource } from '@/core/studio/studio-analysis';

export async function loadStudioAnalysisSources(projectId: string) {
  const result = await apiJsonGet<{ assets: Array<{ id: string; type: StudioAnalysisSource['type']; publicUrl: string; filename: string | null }>; limit: number }>(`/api/app/projects/${encodeURIComponent(projectId)}/assets`);
  return { sources: [...new Map(result.assets.map(asset => [asset.id, { id: asset.id, type: asset.type, publicUrl: asset.publicUrl, filename: asset.filename ?? asset.id }])).values()], limited: result.assets.length >= result.limit };
}

export function useStudioAnalysis({ projectId, initialModelId, initialPrompt, onError }: { projectId: string; initialModelId?: string; initialPrompt?: string; onError: (message: string) => void }) {
  const { data } = useWorkspaceModels();
  const models = data?.models.filter(model => model.workspaceType === 'analysis') ?? [];
  const [draft, setDraft] = useState(() => newStudioAnalysisDraft(initialModelId, initialPrompt));
  const [busy, setBusy] = useState(false), [restoredKey, setRestoredKey] = useState('');
  const [unreadableDraft, setUnreadableDraft] = useState(false);
  const locked = useRef(false), epoch = useRef(0);
  const key = `viral-hit:studio-analysis:${projectId}`;
  const model = models.find(item => item.id === draft.modelId);
  useEffect(() => {
    epoch.current++; locked.current = false; setBusy(false); setRestoredKey(''); setUnreadableDraft(false);
    let next = newStudioAnalysisDraft(initialModelId, initialPrompt);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) { if (raw.length > 128_000) throw Error('Draft exceeds storage limit'); next = studioAnalysisDraftSchema.parse(JSON.parse(raw)); }
      setRestoredKey(key);
    } catch { setUnreadableDraft(true); }
    // Always reset project-local state and fence pending work, even if storage is unreadable.
    setDraft(next);
    return () => { epoch.current++; };
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
  function add(source: StudioAnalysisSource) {
    if (locked.current) return;
    if (!model) { onError('Choose an available analysis model first.'); return; }
    try { setDraft(appendAnalysisSource(draft, source, model)); onError(''); }
    catch (error) { onError((error as Error).message); }
  }
  async function upload(files: File[]) {
    if (locked.current || !files.length) return;
    if (!model) { onError('Choose an available analysis model first.'); return; }
    const token = epoch.current;
    locked.current = true; setBusy(true); onError('');
    try {
      // Check the complete selection before writing any files. The server verifies actual media on upload.
      let preview = draft;
      for (const [index, file] of files.entries()) {
        const type = detectUploadedMediaType(file);
        if (!type) throw Error('Unsupported media file: ' + file.name);
        preview = appendAnalysisSource(preview, { id: `pending-${index}`, type, filename: file.name, publicUrl: 'pending' }, model);
      }
      let next = draft;
      for (const file of files) {
        const asset = await uploadLocalProjectAsset({ projectId, file });
        if (token !== epoch.current) return;
        const source = { id: asset.id, type: asset.type, publicUrl: asset.publicUrl, filename: asset.filename };
        next = appendAnalysisSource(next, source, model);
        setDraft(next);
      }
    } catch (error) { if (token === epoch.current) onError((error as Error).message); }
    finally { if (token === epoch.current) { locked.current = false; setBusy(false); } }
  }
  async function reuse(item: ProjectGenerationItem) {
    if (locked.current) return;
    const token = epoch.current;
    locked.current = true; setBusy(true); onError('');
    try {
      const library = await loadStudioAnalysisSources(projectId);
      if (token === epoch.current) setDraft(restoreStudioAnalysisHistory(projectId, item, library.sources));
    } catch (error) { if (token === epoch.current) onError((error as Error).message); }
    finally { if (token === epoch.current) { locked.current = false; setBusy(false); } }
  }
  return { draft, models, model, busy, unreadableDraft, replaceUnreadableDraft, update, add, upload, reuse, request: () => studioAnalysisRequest(projectId, draft, model) };
}
export type StudioAnalysisController = ReturnType<typeof useStudioAnalysis>;
