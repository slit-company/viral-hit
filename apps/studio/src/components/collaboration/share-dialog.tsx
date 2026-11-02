import { m } from '@/paraglide/messages.js';
import { useState } from 'react';
import { Check, Copy, Link2, Users } from 'lucide-react';
import { Action } from '@/components/base/action';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ShareRole } from '@/core/collaboration/contract';
import { useCollaboration, useCollaborationAction } from './use-collaboration';

// Dates follow the app's language, not the browser default.
const date = (time: number) => new Date(time).toLocaleDateString(document.documentElement.lang || undefined, { month: 'short', day: 'numeric' });

/** Make, copy and revoke review links. The full link is shown once; afterwards only its label and role remain. */
export function ShareDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false), [role, setRole] = useState<ShareRole>('viewer'), [label, setLabel] = useState('');
  const [link, setLink] = useState(''), [copied, setCopied] = useState(false);
  const collaboration = useCollaboration(projectId), action = useCollaborationAction(projectId);
  const active = collaboration.data?.shares.filter(share => !share.revokedAt) ?? [];
  const create = () => action.mutate({ action: 'share', role, ...(label.trim() ? { label: label.trim() } : {}) }, { onSuccess: result => { setLink(location.origin + (result.path ?? '')); setCopied(false); setLabel(''); } });
  return <>
    <Action aria-label={m['ui.collab.share']()} title={m['ui.collab.share']()} onClick={() => setOpen(true)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground"><Users size={17} aria-hidden="true" /></Action>
    <Dialog open={open} onOpenChange={next => { setOpen(next); if (!next) setLink(''); }}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6 text-2xl">{m['ui.collab.share_title']()}</DialogTitle>
          <DialogDescription>{m['ui.collab.share_description']()}</DialogDescription>
        </DialogHeader>
        <section className="space-y-3 rounded-2xl border border-border p-4">
          <label className="block space-y-1.5 text-sm font-medium">{m['ui.collab.role']()}
            <NativeSelect value={role} onChange={event => setRole(event.target.value as ShareRole)}>
              <option value="viewer">{m['ui.collab.role_viewer']()}</option>
              <option value="editor">{m['ui.collab.role_editor']()}</option>
            </NativeSelect>
          </label>
          <label className="block space-y-1.5 text-sm font-medium">{m['ui.collab.label']()}<Input value={label} maxLength={60} placeholder={m['ui.collab.label_placeholder']()} onChange={event => setLabel(event.target.value)} /></label>
          <Action className="vh-primary inline-flex items-center gap-2" disabled={action.isPending} onClick={create}><Link2 size={16} />{m['ui.collab.create_link']()}</Action>
          {link && <div role="status" className="space-y-2 rounded-xl bg-muted p-3">
            <p className="break-all font-mono text-xs">{link}</p>
            <Action className="vh-secondary inline-flex items-center gap-1.5" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? m['ui.collab.copied']() : m['ui.collab.copy']()}</Action>
            <p className="text-xs text-muted-foreground">{m['ui.collab.link_once']()}</p>
          </div>}
          {action.isError && <p role="alert" className="text-sm text-red-700">{action.error.message}</p>}
        </section>
        <section className="space-y-2" aria-label={m['ui.collab.active_links']()}>
          <h3 className="text-sm font-semibold">{m['ui.collab.active_links']()} · {active.length}</h3>
          {!active.length && <p className="text-sm text-muted-foreground">{m['ui.collab.no_links']()}</p>}
          {active.map(share => <div key={share.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
            <span className="font-medium">{share.label ?? (share.role === 'editor' ? m['ui.collab.role_editor']() : m['ui.collab.role_viewer']())}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{share.role === 'editor' ? m['ui.collab.editor']() : m['ui.collab.viewer']()}</span>
            <span className="text-xs text-muted-foreground">{m['ui.collab.made_on']({ date: date(share.createdAt) })}{share.lastUsedAt ? ' · ' + m['ui.collab.opened_on']({ date: date(share.lastUsedAt) }) : ''}</span>
            <Action className="vh-secondary ml-auto h-8 px-2.5 text-xs" disabled={action.isPending} onClick={() => action.mutate({ action: 'revoke', shareId: share.id })}>{m['ui.collab.revoke']()}</Action>
          </div>)}
        </section>
        <p className="text-xs leading-5 text-muted-foreground">{m['ui.collab.network_note']()}</p>
      </DialogContent>
    </Dialog>
  </>;
}
