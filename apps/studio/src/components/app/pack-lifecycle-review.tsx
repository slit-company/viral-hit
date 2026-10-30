import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useRef } from 'react';
import { Action } from '@/components/base/action';
import { RecipeDefinition } from './recipe-lifecycle-review';
import type { PackLifecycleState } from './use-pack-lifecycle';

export function PackLifecycleReview({ lifecycle }: { lifecycle: PackLifecycleState }) {
  const panel = useRef<HTMLElement>(null), review = lifecycle.review!;
  useEffect(() => { panel.current?.scrollIntoView({ block: 'start' }); }, [review]);
  const updating = review.kind === 'update';
  const changes = updating ? review.state.changes : review.state.members.map(member => ({ ...member, incoming: undefined, change: member.current ? 'detach' as const : 'missing' as const, unavailableOperations: [] }));
  return <section ref={panel} aria-label={uiMessages["ui.app.pack_lifecycle_review"]()} className="scroll-mt-24 space-y-4 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-4 text-xs leading-5">
    <header className="space-y-2">
      <h3 className="break-words text-base font-semibold">{updating ? uiMessages["ui.app.update"]() : uiMessages["ui.app.remove_2"]()} {review.state.pack.title}</h3>
      <p className="break-all">{review.state.pack.id} · v{review.state.pack.version}{updating && ` → v${review.state.incoming.version}`}</p>
      <p>{updating ? uiMessages["ui.app.new_recipes_are_added_existing_definitions_stay_as_they_are_unless_you_sele"]() : uiMessages["ui.app.remove_the_pack_listing_its_recipes_stay_in_your_library_unless_you_select_"]()}</p>
    </header>
    <details className="rounded-xl border border-[var(--vh-border)] p-3">
      <summary className="cursor-pointer font-medium">{uiMessages["ui.app.pack_metadata_and_membership"]()}</summary>
      <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-words text-[11px]">{JSON.stringify({ installed: review.state.pack, ...(updating ? { incoming: review.state.incoming } : {}) }, null, 2)}</pre>
    </details>
    <ul className="space-y-3">{changes.map(member => {
      const selectable = updating ? member.change === 'different' && !member.reserved : !!member.current && !member.reserved && !member.otherPacks.length;
      const checked = lifecycle.selected.includes(member.id);
      return <li key={member.id} className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-3">
        <p className="font-semibold">{member.incoming?.title ?? member.current?.title ?? member.id}</p>
        <p className="break-all text-[var(--vh-text-2)]">{member.id}</p>
        <p>{member.change === 'add' ? uiMessages["ui.app.will_add_this_recipe"]() : member.change === 'missing' ? uiMessages["ui.app.already_missing_from_the_library"]() : checked ? updating ? uiMessages["ui.app.will_replace_with_incoming_definition"]() : uiMessages["ui.app.will_delete_from_the_library"]() : member.change === 'same' ? uiMessages["ui.app.identical_definition_kept"]() : uiMessages["ui.app.current_definition_kept"]()}</p>
        {!!member.otherPacks.length && <p className="break-words">{uiMessages["ui.app.also_used_by"]()} {member.otherPacks.map(pack => `${pack.title} (${pack.id})`).join(', ')}{uiMessages["ui.publishing.open_editor_end"]()}{updating && uiMessages["ui.app.shared_pack_change"]()}</p>}
        {member.reserved && <p>{uiMessages["ui.app.protected_by_the_file_catalog"]()}</p>}
        {!!member.unavailableOperations.length && <p className="break-words text-amber-800">{uiMessages["ui.app.needs_setup"]()} {member.unavailableOperations.join(', ')}</p>}
        {member.current && <RecipeDefinition title={uiMessages["ui.app.current"]() + member.id} recipe={member.current} />}
        {member.incoming && <RecipeDefinition title={uiMessages["ui.app.incoming"]() + member.id} recipe={member.incoming} />}
        {selectable && <label className="flex items-start gap-2"><input type="checkbox" disabled={lifecycle.busy} checked={checked} onChange={() => lifecycle.toggle(member.id)} className="mt-1" /><span className="break-all">{updating ? uiMessages["ui.creative-packs.replace"]() : uiMessages["ui.app.delete"]()} {member.id}</span></label>}
      </li>;
    })}</ul>
    {updating && review.state.blocking.map(reason => <p key={reason} className="text-amber-800">{reason}</p>)}
    <p className="text-[var(--vh-text-2)]">{uiMessages["ui.app.saved_runs_keep_their_original_plans_project_media_timelines_and_creative_p"]()}</p>
    <Action onClick={lifecycle.download} className="text-xs underline">{uiMessages["ui.app.download_reviewed_definitions"]()}</Action>
    <p>{updating ? uiMessages["ui.app.recipe_replace_count"]({ count: lifecycle.selected.length, plural: lifecycle.selected.length === 1 ? '' : 's' }) : uiMessages["ui.app.recipe_delete_count"]({ count: lifecycle.selected.length, plural: lifecycle.selected.length === 1 ? '' : 's' })}</p>
    <label className="flex items-start gap-2"><input type="checkbox" checked={lifecycle.confirmed} disabled={lifecycle.busy} onChange={event => lifecycle.setConfirmed(event.target.checked)} className="mt-1" /><span>{uiMessages["ui.app.i_reviewed_these_choices_for"]()} <strong className="break-all">{review.state.pack.id}</strong>{uiMessages["ui.publishing.open_editor_end"]()}</span></label>
    {lifecycle.error && <p role="alert" className="break-words rounded-lg bg-red-500/10 p-3 text-red-800">{lifecycle.error}</p>}
    <div className="flex flex-wrap gap-2">
      <Action className="vh-secondary" disabled={lifecycle.busy} onClick={lifecycle.dismiss}>{uiMessages["ui.app.cancel_pack_change"]()}</Action>
      <Action className="vh-primary" disabled={lifecycle.busy || !lifecycle.confirmed || (updating && !!review.state.blocking.length)} onClick={() => void lifecycle.apply()}>{lifecycle.busy ? uiMessages["ui.common.working"]() : updating ? uiMessages["ui.app.update_pack"]() : uiMessages["ui.app.remove_pack"]()}</Action>
    </div>
  </section>;
}
