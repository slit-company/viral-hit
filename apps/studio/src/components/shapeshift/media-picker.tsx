import { useRef, useState, type ReactNode } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AssetChoiceGrid } from '@/components/remix/asset-choice-grid';
import { uploadLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';
import type { ProjectMedia } from './use-shapeshift';

type Group = { label: string; assets: ProjectMedia[] };

/** Videos sorted into the person's uploads, imported references and earlier results. */
export function videoGroups(videos: readonly ProjectMedia[]): Group[] {
  return [
    { label: m['ui.shapeshift.group_uploads'](), assets: videos.filter(video => video.category === 'upload') },
    { label: m['ui.shapeshift.group_references'](), assets: videos.filter(video => video.category === 'reference') },
    { label: m['ui.shapeshift.group_results'](), assets: videos.filter(video => video.category !== 'upload' && video.category !== 'reference') },
  ];
}

/** Pick project media, or upload a new file that is selected right away. */
export function MediaPickerDialog({ projectId, open, onOpenChange, kind, title, description, empty, groups, selected, onToggle, onUploaded, footer }: {
  projectId: string; open: boolean; onOpenChange: (open: boolean) => void; kind: 'image' | 'video'; title: string; description: string; empty: string;
  groups: Group[]; selected: string[]; onToggle: (id: string) => void; onUploaded: (id: string) => void; footer?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null), [uploading, setUploading] = useState(false), [error, setError] = useState('');
  async function upload(file: File) {
    setUploading(true); setError('');
    try { onUploaded((await uploadLocalProjectAsset({ projectId, file })).id); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setUploading(false); }
  }
  const visible = groups.filter(group => group.assets.length);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <div className="flex justify-end">
        <Action type="button" disabled={uploading} onClick={() => input.current?.click()} className="vh-secondary inline-flex h-9 items-center gap-1.5 px-3 text-xs">
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}{uploading ? m['ui.shapeshift.uploading']() : m['ui.shapeshift.upload']()}
        </Action>
        <input ref={input} type="file" className="hidden" accept={kind === 'video' ? 'video/mp4,video/quicktime,video/webm' : 'image/jpeg,image/png,image/webp'}
          onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void upload(file); }} />
      </div>
      {visible.length ? visible.map(group => <section key={group.label} className="space-y-2">
        {groups.length > 1 && <h3 className="text-xs font-semibold text-[var(--vh-text-2)]">{group.label}</h3>}
        <AssetChoiceGrid assets={group.assets} selected={selected} label={group.label} onToggle={onToggle} />
      </section>) : <p className="text-sm text-[var(--vh-text-2)]">{empty}</p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {footer}
    </DialogContent>
  </Dialog>;
}
