import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { apiJsonGet } from '@/lib/api-client';
import { uploadLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';
import { detectUploadedMediaType } from '@/core/effects/validation';
import type { ProjectGenerationItem } from '@/core/effects/project-generations';
import type { WorkspaceModelOption } from '@/core/effects/workspace-models';
import type { StudioMediaSource } from '@/core/studio/studio-media-sources';

export async function loadStudioSources(projectId: string) {
  const result = await apiJsonGet<{ assets: Array<{ id: string; type: StudioMediaSource['type']; publicUrl: string; filename: string | null }>; limit: number }>(`/api/app/projects/${encodeURIComponent(projectId)}/assets`);
  return { sources: [...new Map(result.assets.map(asset => [asset.id, { id: asset.id, type: asset.type, publicUrl: asset.publicUrl, filename: asset.filename ?? asset.id }])).values()], limited: result.assets.length >= result.limit };
}

/** Shared uploads/history recovery. Fence old-project completions and retain each successfully uploaded file. */
export function useStudioSourceActions<T>({ projectId, draft, setDraft, model, append, restore, onError }: {
  projectId: string; draft: T; setDraft: Dispatch<SetStateAction<T>>; model: WorkspaceModelOption | undefined;
  append: (draft: T, source: StudioMediaSource, model: WorkspaceModelOption) => T;
  restore: (projectId: string, item: ProjectGenerationItem, library: StudioMediaSource[]) => T;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false), locked = useRef(false), epoch = useRef(0);
  useEffect(() => { epoch.current++; locked.current = false; setBusy(false); return () => { epoch.current++; }; }, [projectId]);
  function add(source: StudioMediaSource) {
    if (locked.current) return;
    if (!model || model.available === false) { onError('Choose an available model first.'); return; }
    try { setDraft(append(draft, source, model)); onError(''); }
    catch (error) { onError((error as Error).message); }
  }
  async function upload(files: File[]) {
    if (locked.current || !files.length) return;
    if (!model || model.available === false) { onError('Choose an available model first.'); return; }
    const token = epoch.current;
    locked.current = true; setBusy(true); onError('');
    try {
      // Validate the complete selection before writing files; the server verifies their actual media kind.
      let preview = draft;
      for (const [index, file] of files.entries()) {
        const type = detectUploadedMediaType(file);
        if (!type) throw Error('Unsupported media file: ' + file.name);
        preview = append(preview, { id: `pending-${index}`, type, filename: file.name, publicUrl: 'pending' }, model);
      }
      let next = draft;
      for (const file of files) {
        const asset = await uploadLocalProjectAsset({ projectId, file });
        if (token !== epoch.current) return;
        next = append(next, { id: asset.id, type: asset.type, publicUrl: asset.publicUrl, filename: asset.filename }, model);
        setDraft(next);
      }
    } catch (error) { if (token === epoch.current) onError((error as Error).message); }
    finally { if (token === epoch.current) { locked.current = false; setBusy(false); } }
  }
  async function reuse(item: ProjectGenerationItem) {
    if (locked.current) return;
    const token = epoch.current;
    locked.current = true; setBusy(true); onError('');
    try { const library = await loadStudioSources(projectId); if (token === epoch.current) setDraft(restore(projectId, item, library.sources)); }
    catch (error) { if (token === epoch.current) onError((error as Error).message); }
    finally { if (token === epoch.current) { locked.current = false; setBusy(false); } }
  }
  return { busy, locked, add, upload, reuse };
}
