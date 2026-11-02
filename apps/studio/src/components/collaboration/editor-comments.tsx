import { m } from '@/paraglide/messages.js';
import { useState } from 'react';
import { Check, MessageSquare, RotateCcw, Trash2 } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CommentView } from '@/core/collaboration/contract';
import { clock, useCollaboration, useCollaborationAction } from './use-collaboration';
import { cn } from '@/lib/utils';

/** Who wrote a comment, as the editor shows it. */
export const commentAuthor = (comment: CommentView) => comment.authorKind === 'owner' ? m['ui.collab.owner']() : comment.authorKind === 'agent' ? m['ui.collab.agent']() : comment.author;

/** Comments beside the timeline: pin one to the playhead, jump to a pinned moment, settle or delete it. */
export function EditorComments({ projectId, currentTime, selectedClipId, onSeek }: { projectId: string; currentTime: number; selectedClipId?: string | null; onSeek: (time: number) => void }) {
  const [open, setOpen] = useState(false), [body, setBody] = useState('');
  const collaboration = useCollaboration(projectId), action = useCollaborationAction(projectId);
  const comments = [...collaboration.data?.comments ?? []].sort((left, right) => (left.anchor.time ?? -1) - (right.anchor.time ?? -1) || left.createdAt - right.createdAt);
  const waiting = comments.filter(comment => !comment.resolvedAt).length;
  const send = () => action.mutate({ action: 'comment', body: body.trim(), anchor: { time: Math.round(currentTime * 100) / 100, ...(selectedClipId ? { clipId: selectedClipId } : {}) } }, { onSuccess: () => setBody('') });
  return <>
    <Action type="button" onClick={() => setOpen(true)} aria-label={m['ui.collab.comments_count']({ count: waiting })} title={m['ui.collab.comments']()}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)] px-2.5 text-xs font-semibold text-[var(--vh-text-1)]">
      <MessageSquare className="size-3.5" />{waiting > 0 && <span className="tabular-nums">{waiting}</span>}
    </Action>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-32px)] grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>{m['ui.collab.comments']()}</DialogTitle>
          <DialogDescription>{m['ui.collab.comments_description']()}</DialogDescription>
        </DialogHeader>
        <ol className="min-h-0 space-y-2 overflow-y-auto pr-1" aria-label={m['ui.collab.comments']()}>
          {!comments.length && <li className="text-sm text-[var(--vh-text-2)]">{m['ui.collab.no_comments']()}</li>}
          {comments.map(comment => <li key={comment.id} className={cn('space-y-1.5 rounded-xl border border-[var(--vh-border)] p-3 text-sm', comment.resolvedAt && 'opacity-60')}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {comment.anchor.time !== undefined && <Action type="button" className="rounded-md bg-[var(--color-brand-lime-soft)] px-1.5 py-0.5 font-semibold tabular-nums text-[var(--color-lime-text)]" onClick={() => { onSeek(comment.anchor.time!); setOpen(false); }}>{clock(comment.anchor.time)}</Action>}
              <span className="font-semibold">{commentAuthor(comment)}</span>
              {comment.resolvedAt && <span className="text-[var(--vh-text-3)]">{m['ui.collab.settled_by']({ name: comment.resolvedBy ?? '' })}</span>}
              <span className="ml-auto flex gap-1">
                <Action type="button" aria-label={comment.resolvedAt ? m['ui.collab.reopen']() : m['ui.collab.settle']()} title={comment.resolvedAt ? m['ui.collab.reopen']() : m['ui.collab.settle']()} disabled={action.isPending} className="grid size-7 place-items-center rounded-md border border-[var(--vh-border)]" onClick={() => action.mutate({ action: 'resolve', commentId: comment.id, resolved: !comment.resolvedAt })}>{comment.resolvedAt ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}</Action>
                <Action type="button" aria-label={m['ui.collab.delete']()} title={m['ui.collab.delete']()} disabled={action.isPending} className="grid size-7 place-items-center rounded-md border border-[var(--vh-border)]" onClick={() => action.mutate({ action: 'delete', commentId: comment.id })}><Trash2 className="size-3.5" /></Action>
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words leading-6">{comment.body}</p>
          </li>)}
        </ol>
        <div className="space-y-2 border-t border-[var(--vh-border)] pt-3">
          <Textarea aria-label={m['ui.collab.new_comment']()} placeholder={m['ui.collab.new_comment']()} value={body} maxLength={2000} onChange={event => setBody(event.target.value)} className="min-h-20 text-sm" />
          {action.isError && <p role="alert" className="text-xs text-red-700">{action.error.message}</p>}
          <Action type="button" className="vh-primary" disabled={!body.trim() || action.isPending} onClick={send}>{m['ui.collab.comment_at']({ time: clock(currentTime) })}</Action>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
