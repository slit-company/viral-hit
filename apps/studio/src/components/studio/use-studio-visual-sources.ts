import { useEffect, useState } from 'react';
import { useStudioSourceActions } from './use-studio-source-actions';
import { appendVisualSource, restoreVisualSources, visualSourcesSchema, type StudioMask } from '@/core/studio/studio-visual-sources';
import type { WorkspaceModelOption } from '@/core/effects/workspace-models';
import type { StudioMediaSource } from '@/core/studio/studio-media-sources';

export function useStudioVisualSources(projectId: string, model: WorkspaceModelOption | null, onError: (message: string) => void) {
  const [draft, setDraft] = useState<{ sources: StudioMediaSource[]; mask?: StudioMask }>({ sources: [] });
  const [restored, setRestored] = useState(''), [unreadable, setUnreadable] = useState(false);
  const key = `viral-hit:studio-visual-sources:${projectId}`;
  const actions = useStudioSourceActions({ projectId, draft, setDraft, model: model ?? undefined, append: appendVisualSource, restore: restoreVisualSources, onError });
  useEffect(() => {
    setRestored(''); setUnreadable(false);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw && raw.length > 128_000) throw Error('Source selection is too large');
      setDraft(raw ? visualSourcesSchema.parse(JSON.parse(raw)) : { sources: [] }); setRestored(key);
    } catch { setDraft({ sources: [] }); setUnreadable(true); }
  }, [key]);
  function save() { sessionStorage.setItem(key, JSON.stringify(draft)); }
  useEffect(() => { if (restored === key) try { save(); } catch { onError('Browser source storage is unavailable. Original files remain in Assets.'); } }, [key, restored, draft]);
  function replaceUnreadable() {
    if (actions.locked.current) return;
    try { save(); setRestored(key); setUnreadable(false); onError(''); } catch { onError('Browser source storage is unavailable.'); }
  }
  return { ...actions, sources: draft.sources, mask: draft.mask, unreadable, replaceUnreadable,
    // Removing the image a mask was painted for also drops that mask.
    remove: (id: string) => { if (!actions.locked.current) setDraft(current => ({ sources: current.sources.filter(source => source.id !== id), ...(current.mask && current.mask.targetId !== id ? { mask: current.mask } : {}) })); },
    setRole: (id: string, role: StudioMediaSource['role']) => { if (!actions.locked.current) setDraft(current => ({ ...current, sources: current.sources.map(source => source.id === id ? { ...source, role } : source) })); },
    setMask: (mask: StudioMask | undefined) => { if (!actions.locked.current) setDraft(current => ({ sources: current.sources, ...(mask ? { mask } : {}) })); } };
}
export type StudioVisualSourcesController = ReturnType<typeof useStudioVisualSources>;
