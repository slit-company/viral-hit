import { m } from '@/paraglide/messages.js';
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, RotateCcw } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { commentAuthor } from './editor-comments';
import { clock, useSharedAction, useSharedProject } from './use-collaboration';

const NAME_KEY = 'viral-hit:review-name';

/** What someone with a share link sees: the newest cut, its comments and a way to add theirs at the current moment. */
export function SharedReviewPage({ token }: { token: string }) {
  const shared = useSharedProject(token), action = useSharedAction(token), video = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState(''), [body, setBody] = useState(''), [pin, setPin] = useState(true);
  useEffect(() => { setName(localStorage.getItem(NAME_KEY) ?? ''); }, []);
  const remember = (value: string) => { setName(value); localStorage.setItem(NAME_KEY, value); };
  const view = shared.data;
  const send = () => action.mutate({ action: 'comment', name: name.trim(), body: body.trim(), anchor: pin && video.current ? { time: Math.round(video.current.currentTime * 100) / 100 } : {} }, { onSuccess: () => setBody('') });
  return <main className="min-h-screen bg-[var(--vh-bg)] text-[var(--vh-text-1)]">
    <header className="border-b border-[var(--vh-border)] bg-[var(--vh-surface)] px-5 py-3 text-sm"><span className="font-semibold">Viral Hit</span><span className="text-[var(--vh-text-3)]"> · {m['ui.collab.shared_review']()}</span></header>
    {!view ? <div className="grid place-items-center p-16 text-sm text-[var(--vh-text-2)]">{shared.isError ? m['ui.collab.link_inactive']() : <Loader2 className="size-5 animate-spin" />}</div>
    : <div className="mx-auto grid max-w-6xl gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold">{view.project.name}</h1>
          <span className="rounded-full bg-[var(--color-brand-lime-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-lime-text)]">{view.role === 'editor' ? m['ui.collab.editor']() : m['ui.collab.viewer']()}</span></div>
        {view.cut ? <video ref={video} src={view.cut.url} controls playsInline preload="metadata" className="aspect-video w-full rounded-2xl bg-black" />
          : <div className="grid aspect-video place-items-center rounded-2xl border border-dashed border-[var(--vh-border)] p-6 text-center text-sm text-[var(--vh-text-2)]">{m['ui.collab.no_cut']()}</div>}
        <p className="text-xs text-[var(--vh-text-3)]">{view.role === 'editor' ? m['ui.collab.editor_note']() : m['ui.collab.viewer_note']()}</p>
      </section>
      <aside className="space-y-3" aria-label={m['ui.collab.comments']()}>
        <h2 className="text-sm font-semibold">{m['ui.collab.comments']()} · {view.comments.length}</h2>
        <ol className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {!view.comments.length && <li className="text-sm text-[var(--vh-text-2)]">{m['ui.collab.no_comments']()}</li>}
          {view.comments.map(comment => <li key={comment.id} className={cn('space-y-1 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-3 text-sm', comment.resolvedAt && 'opacity-60')}>
            <div className="flex items-center gap-2 text-xs">
              {comment.anchor.time !== undefined && <Action type="button" className="rounded-md bg-[var(--color-brand-lime-soft)] px-1.5 py-0.5 font-semibold tabular-nums text-[var(--color-lime-text)]" onClick={() => { if (video.current) video.current.currentTime = comment.anchor.time!; }}>{clock(comment.anchor.time)}</Action>}
              <span className="font-semibold">{commentAuthor(comment)}</span>
              {(view.role === 'editor' || comment.mine) && <Action type="button" aria-label={comment.resolvedAt ? m['ui.collab.reopen']() : m['ui.collab.settle']()} title={comment.resolvedAt ? m['ui.collab.reopen']() : m['ui.collab.settle']()} disabled={!name.trim() || action.isPending}
                className="ml-auto grid size-7 place-items-center rounded-md border border-[var(--vh-border)]" onClick={() => action.mutate({ action: 'resolve', name: name.trim(), commentId: comment.id, resolved: !comment.resolvedAt })}>{comment.resolvedAt ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}</Action>}
            </div>
            <p className="whitespace-pre-wrap break-words leading-6">{comment.body}</p>
          </li>)}
        </ol>
        <div className="space-y-2 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-3">
          <Input aria-label={m['ui.collab.your_name']()} placeholder={m['ui.collab.your_name']()} value={name} maxLength={60} onChange={event => remember(event.target.value)} />
          <Textarea aria-label={m['ui.collab.new_comment']()} placeholder={m['ui.collab.new_comment']()} value={body} maxLength={2000} onChange={event => setBody(event.target.value)} className="min-h-20 text-sm" />
          {view.cut && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={pin} onChange={event => setPin(event.target.checked)} />{m['ui.collab.pin_to_moment']()}</label>}
          {action.isError && <p role="alert" className="text-xs text-red-700">{action.error.message}</p>}
          <Action type="button" className="vh-primary w-full" disabled={!name.trim() || !body.trim() || action.isPending} onClick={send}>{m['ui.collab.send']()}</Action>
        </div>
      </aside>
    </div>}
  </main>;
}
