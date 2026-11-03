import { useEffect, useState } from 'react';
import { Download, ImageDown, Loader2 } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Link, useRouter } from '@/core/i18n/navigation';
import { apiJsonPost } from '@/lib/api-client';
import { moveLayer, newLayer, nextLayerId, type ImageLayer } from '@/core/image-layers/contract';
import { handOffToStudio } from '@/core/studio/studio-handoff';
import { LayerCanvas, layerUrl } from './layer-canvas';
import { LayerRow, type ProjectImage } from './layer-row';
import { layersApi, useLayerEditor } from './use-layer-editor';

/** The canvas with the stack and, beside it, its layers top first, the stack name and the ways to save it. */
export function LayerEditor({ projectId, stackId, images, onDeleted }: { projectId: string; stackId: string; images: ProjectImage[]; onDeleted: () => void }) {
  const editor = useLayerEditor(projectId, stackId), router = useRouter(), stack = editor.stack;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ busy: boolean; done: boolean; error: string }>({ busy: false, done: false, error: '' });
  useEffect(() => { if (stack && !stack.layers.some(layer => layer.id === selectedId)) setSelectedId(stack.layers[stack.layers.length - 1]?.id ?? null); }, [stack?.id, stack?.layers.length]);
  if (!stack) return <p role={editor.state === 'error' ? 'alert' : 'status'} className="p-6 text-sm text-[var(--vh-text-2)]">{editor.state === 'error' ? editor.error : m['ui.layers.loading']()}</p>;
  const set = (id: string, patch: Partial<ImageLayer>, now = false) => { setSaved(value => ({ ...value, done: false })); editor.change(draft => ({ ...draft, layers: draft.layers.map(layer => layer.id === id ? { ...layer, ...patch } : layer) }), now); };
  const top = [...stack.layers].reverse();
  async function save() {
    setSaved({ busy: true, done: false, error: '' });
    try { await editor.flatten(); setSaved({ busy: false, done: true, error: '' }); }
    catch (failure) { setSaved({ busy: false, done: false, error: failure instanceof Error ? failure.message : m['ui.layers.open_failed']() }); }
  }
  async function remove() {
    if (!window.confirm(m['ui.layers.delete_confirm']())) return;
    await apiJsonPost(layersApi(projectId), { action: 'delete', stackId });
    onDeleted();
  }
  return <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
    <section className="flex min-h-[420px] flex-col bg-[var(--vh-bg)]">
      <LayerCanvas projectId={projectId} stack={stack} selectedId={selectedId} onMove={(id, x, y) => set(id, { x, y })} />
    </section>
    <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto border-t border-[var(--vh-border)] bg-[var(--vh-surface)] p-4 lg:border-l lg:border-t-0">
      <div className="space-y-1.5">
        <label className="grid gap-1.5 text-xs"><span className="font-semibold">{m['ui.layers.name']()}</span>
          <Input value={stack.name} maxLength={80} onChange={event => editor.change(draft => ({ ...draft, name: event.target.value }))} /></label>
        <p role="status" className="text-[11px] text-[var(--vh-text-3)]">{stack.width} × {stack.height}<span aria-hidden="true"> · </span>
          {editor.state === 'saving' ? m['ui.layers.saving']() : editor.state === 'saved' ? m['ui.layers.saved']() : null}</p>
        {(editor.state === 'conflict' || editor.state === 'error') && <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-950">{editor.error}
          {editor.state === 'conflict' && <Action type="button" className="vh-secondary h-7 px-2 text-xs" onClick={() => void editor.reload()}>{m['ui.layers.reload']()}</Action>}</p>}
      </div>
      <section aria-label={m['ui.layers.layer_list']()} className="space-y-2">
        <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold">{m['ui.layers.layer_list']()}</h2><span className="text-[11px] text-[var(--vh-text-3)]">{m['ui.layers.top_first']()}</span></div>
        <ol className="space-y-1.5">{top.map((layer, index) => <LayerRow key={layer.id} projectId={projectId} layer={layer} images={images} selected={layer.id === selectedId}
          first={index === 0} last={index === top.length - 1} onSelect={() => setSelectedId(layer.id)} onChange={(patch, now) => set(layer.id, patch, now)}
          onMove={step => editor.change(draft => ({ ...draft, layers: moveLayer(draft.layers, layer.id, step) }))}
          onRemove={() => editor.change(draft => ({ ...draft, layers: draft.layers.filter(item => item.id !== layer.id) }))}
          onEdit={() => { handOffToStudio(projectId, 'image-edit', [{ id: layer.assetId, type: 'image', publicUrl: layerUrl(projectId, layer.assetId), filename: layer.name }]); router.push('/studio/' + projectId); }} />)}</ol>
        {stack.layers.length < 16 && images.length > 0 && <NativeSelect aria-label={m['ui.layers.add']()} value="" onChange={event => {
          const image = images.find(item => item.id === event.target.value);
          if (!image) return;
          const id = nextLayerId(stack.layers);
          editor.change(draft => ({ ...draft, layers: [...draft.layers, { ...newLayer(draft.layers.length, image.id, image.filename?.replace(/\.[^.]+$/, '') || ''), id, width: draft.width, height: draft.height }] }), true);
          setSelectedId(id);
        }}><option value="">{m['ui.layers.add']()}</option>{images.map(image => <option key={image.id} value={image.id}>{image.filename || image.id}</option>)}</NativeSelect>}
      </section>
      <div className="mt-auto space-y-2 border-t border-[var(--vh-border)] pt-4">
        <Action type="button" className="vh-primary flex h-11 w-full items-center justify-center gap-2 text-sm font-semibold" disabled={saved.busy || editor.state === 'conflict'} onClick={() => void save()}>
          {saved.busy ? <Loader2 className="size-4 animate-spin" /> : <ImageDown className="size-4" />}{saved.busy ? m['ui.layers.saving_image']() : m['ui.layers.save_image']()}</Action>
        <a href={editor.zipUrl} download className="vh-secondary flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium"><Download className="size-4" />{m['ui.layers.download']()}</a>
        {saved.done && <p role="status" className="text-xs text-[var(--vh-text-2)]">{m['ui.layers.saved_image']()} <Link href={'/assets/' + projectId} className="underline underline-offset-4">{m['ui.layers.view_media']()}</Link></p>}
        {saved.error && <p role="alert" className="text-xs text-red-700">{saved.error}</p>}
        <button type="button" className="text-xs text-[var(--vh-text-3)] underline underline-offset-4" onClick={() => void remove()}>{m['ui.layers.delete_stack']()}</button>
      </div>
    </aside>
  </div>;
}
