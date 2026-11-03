import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, Plus, WandSparkles } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { ProductPageShell } from '@/components/app/product-page-shell';
import { Action } from '@/components/base/action';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRouter } from '@/core/i18n/navigation';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { ImageLayerStackSummary } from '@/core/image-layers/contract';
import { handOffToStudio } from '@/core/studio/studio-handoff';
import { cn } from '@/lib/utils';
import { checker } from './layer-canvas';
import { LayerEditor } from './layer-editor';
import type { ProjectImage } from './layer-row';
import { layersApi } from './use-layer-editor';

/** Layer stacks of one project: pick or start one, then edit it beside the canvas. */
export function LayersPage({ projectId, stackId }: { projectId: string; stackId: string | null }) {
  const router = useRouter();
  const project = useQuery({ queryKey: ['layers-project-name', projectId], queryFn: async () => (await apiJsonGet<{ projects: Array<{ id: string; name: string }> }>('/api/app/projects')).projects.find(item => item.id === projectId) ?? null, staleTime: 30_000 });
  const stacks = useQuery({ queryKey: ['image-layer-stacks', projectId], queryFn: () => apiJsonGet<{ stacks: ImageLayerStackSummary[] }>(layersApi(projectId)).then(result => result.stacks) });
  const images = useQuery({ queryKey: ['layer-project-images', projectId], queryFn: async () => (await apiJsonGet<{ assets: Array<ProjectImage & { type: string }> }>('/api/app/projects/' + encodeURIComponent(projectId) + '/assets')).assets.filter(asset => asset.type === 'image') });
  const open = (id: string | null) => router.replace('/layers/' + projectId + (id ? '?stack=' + encodeURIComponent(id) : ''));
  const split = () => { handOffToStudio(projectId, 'image-layers'); router.push('/studio/' + projectId); };
  return <ProductPageShell projectId={projectId} workspaceName={project.data?.name} section="layers"><div className="flex min-h-0 flex-1 flex-col">
    <header className="flex flex-wrap items-center gap-2 border-b border-[var(--vh-border)] bg-[var(--vh-surface)] px-4 py-3 sm:px-6">
      <h1 className="mr-2 flex items-center gap-2 text-[15px] font-semibold"><Layers className="size-4" />{m['ui.layers.title']()}</h1>
      <NativeSelect aria-label={m['ui.layers.stacks']()} className="w-full max-w-72" value={stackId ?? ''} onChange={event => open(event.target.value || null)}>
        <option value="">{m['ui.layers.choose_stack']()}</option>
        {stacks.data?.map(stack => <option key={stack.id} value={stack.id}>{stack.name} · {m['ui.layers.count']({ count: stack.layerCount })}</option>)}
      </NativeSelect>
      <NewStack projectId={projectId} images={images.data ?? []} onCreated={id => { void stacks.refetch(); open(id); }} />
      <Action type="button" className="vh-secondary inline-flex h-9 items-center gap-1.5 px-3 text-xs" onClick={split}><WandSparkles className="size-3.5" />{m['ui.layers.open_split']()}</Action>
    </header>
    {stackId ? <LayerEditor key={stackId} projectId={projectId} stackId={stackId} images={images.data ?? []} onDeleted={() => { void stacks.refetch(); open(null); }} />
      : <div className="flex flex-1 items-center justify-center p-8"><div className="max-w-md space-y-3 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[var(--color-brand-lime-soft)] text-[var(--color-lime-text)]"><Layers className="size-5" /></div>
        <h2 className="text-lg font-semibold">{stacks.data?.length ? m['ui.layers.pick_title']() : m['ui.layers.empty_title']()}</h2>
        <p className="text-sm leading-6 text-[var(--vh-text-2)]">{m['ui.layers.empty_body']()}</p>
      </div></div>}
  </div></ProductPageShell>;
}

/** Stacks project images in the order they are picked, bottom layer first. */
function NewStack({ projectId, images, onCreated }: { projectId: string; images: ProjectImage[]; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false), [picked, setPicked] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const toggle = (id: string) => setPicked(current => current.includes(id) ? current.filter(item => item !== id) : current.length < 16 ? [...current, id] : current);
  async function create() {
    setBusy(true); setError('');
    try {
      const { stack } = await apiJsonPost<{ stack: { id: string } }>(layersApi(projectId), { action: 'create', assetIds: picked });
      setOpen(false); setPicked([]); onCreated(stack.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : m['ui.layers.open_failed']()); }
    finally { setBusy(false); }
  }
  return <>
    <Action type="button" className="vh-secondary inline-flex h-9 items-center gap-1.5 px-3 text-xs" onClick={() => setOpen(true)}><Plus className="size-3.5" />{m['ui.layers.new_from_images']()}</Action>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{m['ui.layers.new_from_images']()}</DialogTitle><DialogDescription>{m['ui.layers.pick_images']()}</DialogDescription></DialogHeader>
        {images.length === 0 ? <p className="text-sm text-[var(--vh-text-2)]">{m['ui.layers.no_images']()}</p>
          : <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{images.map(image => {
            const order = picked.indexOf(image.id);
            return <li key={image.id}><button type="button" aria-pressed={order >= 0} onClick={() => toggle(image.id)} title={image.filename ?? undefined}
              className={cn('relative block aspect-square w-full overflow-hidden rounded-xl shadow-[0_0_0_1px_var(--vh-border)]', order >= 0 && 'shadow-[0_0_0_2px_var(--vh-text-1)]')} style={checker}>
              <img src={image.publicUrl} alt={image.filename ?? ''} className="size-full object-contain" loading="lazy" />
              {order >= 0 && <span className="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-[var(--vh-text-1)] text-xs font-semibold text-[var(--vh-bg)]">{order + 1}</span>}
            </button></li>;
          })}</ul>}
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        <Action type="button" className="vh-primary h-11 w-full text-sm font-semibold" disabled={!picked.length || busy} onClick={() => void create()}>{m['ui.layers.create']({ count: picked.length })}</Action>
      </DialogContent>
    </Dialog>
  </>;
}
