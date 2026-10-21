import { useEffect, useRef } from 'react';
import { Action } from '@/components/base/action';
import { RecipeDefinition } from './recipe-lifecycle-review';
import type { PackLifecycleState } from './use-pack-lifecycle';

export function PackLifecycleReview({ lifecycle }: { lifecycle: PackLifecycleState }) {
  const panel = useRef<HTMLElement>(null), review = lifecycle.review!;
  useEffect(() => { panel.current?.scrollIntoView({ block: 'start' }); }, [review]);
  const updating = review.kind === 'update';
  const changes = updating ? review.state.changes : review.state.members.map(member => ({ ...member, incoming: undefined, change: member.current ? 'detach' as const : 'missing' as const, unavailableOperations: [] }));
  return <section ref={panel} aria-label="Pack lifecycle review" className="scroll-mt-24 space-y-4 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-4 text-xs leading-5">
    <header className="space-y-2">
      <h3 className="break-words text-base font-semibold">{updating ? 'Update' : 'Remove'} {review.state.pack.title}</h3>
      <p className="break-all">{review.state.pack.id} · v{review.state.pack.version}{updating && ` → v${review.state.incoming.version}`}</p>
      <p>{updating ? 'New recipes are added. Existing definitions stay as they are unless you select a replacement. Recipes dropped from this release stay in your library.' : 'Remove the pack listing. Its recipes stay in your library unless you select them for deletion. Shared recipes are kept.'}</p>
    </header>
    <details className="rounded-xl border border-[var(--vh-border)] p-3">
      <summary className="cursor-pointer font-medium">Pack metadata and membership</summary>
      <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify({ installed: review.state.pack, ...(updating ? { incoming: review.state.incoming } : {}) }, null, 2)}</pre>
    </details>
    <ul className="space-y-3">{changes.map(member => {
      const selectable = updating ? member.change === 'different' && !member.reserved : !!member.current && !member.reserved && !member.otherPacks.length;
      const checked = lifecycle.selected.includes(member.id);
      return <li key={member.id} className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-3">
        <p className="font-semibold">{member.incoming?.title ?? member.current?.title ?? member.id}</p>
        <p className="break-all text-[var(--vh-text-2)]">{member.id}</p>
        <p>{member.change === 'add' ? 'Will add this recipe' : member.change === 'missing' ? 'Already missing from the library' : checked ? updating ? 'Will replace with incoming definition' : 'Will delete from the library' : member.change === 'same' ? 'Identical definition · kept' : 'Current definition kept'}</p>
        {!!member.otherPacks.length && <p className="break-words">Also used by {member.otherPacks.map(pack => `${pack.title} (${pack.id})`).join(', ')}.{updating && ' A replacement changes those packs too.'}</p>}
        {member.reserved && <p>Protected by the file catalog.</p>}
        {!!member.unavailableOperations.length && <p className="break-words text-amber-800">Needs setup: {member.unavailableOperations.join(', ')}</p>}
        {member.current && <RecipeDefinition title={'Current: ' + member.id} recipe={member.current} />}
        {member.incoming && <RecipeDefinition title={'Incoming: ' + member.id} recipe={member.incoming} />}
        {selectable && <label className="flex items-start gap-2"><input type="checkbox" disabled={lifecycle.busy} checked={checked} onChange={() => lifecycle.toggle(member.id)} className="mt-1" /><span className="break-all">{updating ? 'Replace' : 'Delete'} {member.id}</span></label>}
      </li>;
    })}</ul>
    {updating && review.state.blocking.map(reason => <p key={reason} className="text-amber-800">{reason}</p>)}
    <p className="text-[var(--vh-text-2)]">Saved runs keep their original plans. Project media, timelines and creative-pack snapshots are kept. No jobs start.</p>
    <Action onClick={lifecycle.download} className="text-xs underline">Download reviewed definitions</Action>
    <p>{lifecycle.selected.length} {lifecycle.selected.length === 1 ? 'recipe' : 'recipes'} selected for {updating ? 'replacement' : 'deletion'}.</p>
    <label className="flex items-start gap-2"><input type="checkbox" checked={lifecycle.confirmed} disabled={lifecycle.busy} onChange={event => lifecycle.setConfirmed(event.target.checked)} className="mt-1" /><span>I reviewed these choices for <strong className="break-all">{review.state.pack.id}</strong>.</span></label>
    {lifecycle.error && <p role="alert" className="break-words rounded-lg bg-red-500/10 p-3 text-red-800">{lifecycle.error}</p>}
    <div className="flex flex-wrap gap-2">
      <Action className="vh-secondary" disabled={lifecycle.busy} onClick={lifecycle.dismiss}>Cancel pack change</Action>
      <Action className="vh-primary" disabled={lifecycle.busy || !lifecycle.confirmed || (updating && !!review.state.blocking.length)} onClick={() => void lifecycle.apply()}>{lifecycle.busy ? 'Working…' : updating ? 'Update pack' : 'Remove pack'}</Action>
    </div>
  </section>;
}
