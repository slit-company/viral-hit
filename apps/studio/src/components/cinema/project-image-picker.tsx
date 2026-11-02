import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { apiJsonGet } from '@/lib/api-client';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { cn } from '@/lib/utils';

type ProjectImage = { id: string; type: string; publicUrl: string; filename: string | null };

export function useProjectImages(projectId: string) {
  return useQuery({
    queryKey: ['cinema-images', projectId],
    queryFn: () => apiJsonGet<{ assets: ProjectImage[] }>('/api/app/projects/' + encodeURIComponent(projectId) + '/assets')
      .then(result => [...new Map(result.assets.filter(asset => asset.type === 'image').map(asset => [asset.id, asset])).values()]),
    staleTime: 15_000,
  });
}

/** Thumbnails of chosen project images with a dialog to change them. */
export function ProjectImagePicker({ projectId, label, value, max, disabled, onChange }: {
  projectId: string; label: string; value: string[]; max: number; disabled?: boolean; onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('AppShell.cinema');
  const images = useProjectImages(projectId), [open, setOpen] = useState(false);
  const byId = new Map((images.data ?? []).map(image => [image.id, image]));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(item => item !== id) : max === 1 ? [id] : [...value, id].slice(0, max));
  return <div className="flex flex-wrap items-center gap-2">
    {value.map(id => <span key={id} className="relative size-14 overflow-hidden rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)]">
      {byId.get(id) && <img src={byId.get(id)!.publicUrl} alt={byId.get(id)!.filename ?? ''} className="size-full object-cover" />}
      <Action type="button" aria-label={t('clearStart')} disabled={disabled} onClick={() => onChange(value.filter(item => item !== id))} className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/70 text-white"><X className="size-3" /></Action>
    </span>)}
    {value.length < max && <Action type="button" disabled={disabled} onClick={() => setOpen(true)} className="inline-flex h-14 items-center gap-1.5 rounded-lg border border-dashed border-[var(--vh-border)] px-3 text-xs font-medium text-[var(--vh-text-2)] hover:bg-[var(--vh-control)]">
      <ImagePlus className="size-4" />{label}
    </Action>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogTitle>{label}</DialogTitle>
        {images.data?.length ? <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {images.data.map(image => <Action key={image.id} type="button" aria-pressed={value.includes(image.id)} aria-label={image.filename ?? image.id} onClick={() => toggle(image.id)}
            className={cn('aspect-square overflow-hidden rounded-xl border-2', value.includes(image.id) ? 'border-[var(--vh-text-1)]' : 'border-transparent')}>
            <img src={image.publicUrl} alt="" className="size-full object-cover" />
          </Action>)}
        </div> : <p className="text-sm text-[var(--vh-text-2)]">{t('noImages')}</p>}
        <div className="flex justify-end"><Action type="button" className="vh-primary" onClick={() => setOpen(false)}>{t('done')}</Action></div>
      </DialogContent>
    </Dialog>
  </div>;
}
