import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import type { ImageLayer, ImageLayerStack } from '@/core/image-layers/contract';

const strip = ({ width: _width, height: _height, ...layer }: ImageLayer) => layer;
export const layersApi = (projectId: string) => '/api/app/projects/' + encodeURIComponent(projectId) + '/image-layers';
type SaveState = 'loading' | 'saved' | 'saving' | 'conflict' | 'error';

/**
 * One stack being edited. Changes show at once and save after a short pause with the revision they were
 * made on; when another window saved first, saving stops until the person reloads.
 */
export function useLayerEditor(projectId: string, stackId: string) {
  const api = layersApi(projectId);
  const [stack, setStack] = useState<ImageLayerStack | null>(null);
  const [state, setState] = useState<SaveState>('loading'), [error, setError] = useState('');
  const current = useRef<ImageLayerStack | null>(null), revision = useRef(0), dirty = useRef(false), blocked = useRef(false);
  const saving = useRef<Promise<void> | null>(null), timer = useRef<number | undefined>(undefined);
  const show = (next: ImageLayerStack | null) => { current.current = next; setStack(next); };
  const load = useCallback(async () => {
    window.clearTimeout(timer.current);
    setState('loading'); setError(''); dirty.current = false; blocked.current = false;
    try { const { stack: loaded } = await apiJsonGet<{ stack: ImageLayerStack }>(api + '?stack=' + encodeURIComponent(stackId)); revision.current = loaded.revision; show(loaded); setState('saved'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : m['ui.layers.open_failed']()); setState('error'); }
  }, [api, stackId]);
  useEffect(() => { void load(); return () => window.clearTimeout(timer.current); }, [load]);
  const schedule = (delay: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void flush(), delay); };
  function flush(): Promise<void> {
    if (saving.current) return saving.current;
    const draft = current.current;
    if (!dirty.current || !draft || blocked.current) return Promise.resolve();
    dirty.current = false; setState('saving');
    saving.current = (async () => {
      try {
        const { stack: saved } = await apiJsonPost<{ stack: ImageLayerStack }>(api, { action: 'update', stackId, revision: revision.current, name: draft.name, layers: draft.layers.map(strip) });
        revision.current = saved.revision;
        // Edits made while saving stay; replaced or added layers take their pixel size from the server.
        const sizes = new Map(saved.layers.map(layer => [layer.id + '\0' + layer.assetId, layer]));
        const latest = current.current ?? saved;
        show({ ...saved, name: latest.name, layers: latest.layers.map(layer => { const size = sizes.get(layer.id + '\0' + layer.assetId); return size ? { ...layer, width: size.width, height: size.height } : layer; }) });
        setState(dirty.current ? 'saving' : 'saved');
      } catch (failure) {
        blocked.current = failure instanceof ApiError && failure.code === 409;
        setError(blocked.current ? m['ui.layers.conflict']() : failure instanceof Error ? failure.message : m['ui.layers.open_failed']());
        setState(blocked.current ? 'conflict' : 'error');
      }
    })().finally(() => { saving.current = null; if (dirty.current && !blocked.current) schedule(400); });
    return saving.current;
  }
  /** Shows a change at once and saves it; now skips the pause, for added or replaced images. */
  function change(update: (draft: ImageLayerStack) => ImageLayerStack, now = false) {
    const draft = current.current;
    if (!draft || blocked.current) return;
    show(update(draft)); dirty.current = true;
    schedule(now ? 0 : 500);
  }
  /** Saves pending edits first, so the image always matches what is on screen. */
  async function flatten() {
    window.clearTimeout(timer.current);
    for (let attempt = 0; attempt < 3 && (saving.current || dirty.current); attempt++) await flush();
    if (blocked.current || dirty.current) throw Error(blocked.current ? m['ui.layers.conflict']() : m['ui.layers.open_failed']());
    return apiJsonPost<{ assetId: string; publicUrl: string | null }>(api, { action: 'flatten', stackId });
  }
  return { stack, state, error, change, flatten, reload: load, zipUrl: api + '/' + encodeURIComponent(stackId) + '/zip' };
}
export type LayerEditor = ReturnType<typeof useLayerEditor>;
