import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useRef, useState } from 'react';
import { Action } from '@/components/base/action';
import type { CreativePackLibrary } from './use-creative-packs';
import type { CreativeMemberReview } from '@/core/creative-packs/lifecycle-contract';
import type { Character, CharacterFileManifest } from '@/core/characters/contract';
import type { SkillPackage } from '@/core/skills/package';

function Definition({ label, member, value, previews }: { label: string; member: CreativeMemberReview; value: unknown; previews?: Record<string, string> }) {
  if (!value) return null;
  const character = member.kind === 'character' ? value as Character | CharacterFileManifest : undefined;
  return <div className="space-y-3">
    {character && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{character.references.map(reference => <figure key={reference.sha256}>
      <img alt={`${label} ${member.id} ${reference.role}`} src={previews ? previews[reference.sha256] : `/api/app/characters/${member.id}/references/${reference.sha256}`} className="aspect-square w-full rounded-lg bg-[var(--vh-control)] object-contain" />
      <figcaption className="mt-1 break-words text-xs text-[var(--vh-text-2)]">{label} · {reference.role}</figcaption>
    </figure>)}</div>}
    <details className="rounded-xl border border-[var(--vh-border)] p-3"><summary className="cursor-pointer break-words font-medium">{label} {uiMessages["ui.creative-packs.definition"]()} {member.id}</summary>
      {member.kind === 'skill' && <pre aria-label={uiMessages["ui.creative-packs.named_instructions"]({ label, id: member.id })} className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-6">{(value as SkillPackage).instructions}</pre>}
      <pre aria-label={uiMessages["ui.creative-packs.named_definition"]({ label, id: member.id })} className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5">{JSON.stringify(value, null, 2)}</pre>
    </details>
  </div>;
}
export function CreativeUpdateChoices({ library, selected, toggle }: { library: CreativePackLibrary; selected: string[]; toggle: (key: string) => void }) {
  const review = library.review!.update!;
  return <section aria-label={uiMessages["ui.creative-packs.creative_pack_update_choices"]()} className="space-y-4 text-sm">
    <h3 className="font-semibold">{uiMessages["ui.creative-packs.review_release_update_v"]()}{review.current.version} → v{library.review!.pack.version}</h3>
    <p>{uiMessages["ui.creative-packs.new_entries_are_added_select_only_definitions_to_replace_local_edits_and_en"]()}</p>
    {review.members.map(member => <article key={member.key} className="space-y-3 rounded-xl border border-[var(--vh-border)] p-4">
      <h4 className="break-all font-semibold">{member.kind} · {member.id}</h4>
      <p className="text-xs text-[var(--vh-text-2)]">{member.change === 'add' ? uiMessages["ui.creative-packs.will_add"]() : member.change === 'same' ? uiMessages["ui.creative-packs.matching_definition_reused"]() : selected.includes(member.key) ? uiMessages["ui.app.will_replace_with_incoming_definition"]() : member.current ? uiMessages["ui.app.current_definition_kept"]() : uiMessages["ui.creative-packs.already_missing"]()}</p>
      {!!member.otherPacks.length && <p className="break-words text-xs">{uiMessages["ui.app.also_used_by"]()} {member.otherPacks.map(pack => `${pack.title} (${pack.id})`).join(', ')}{uiMessages["ui.publishing.open_editor_end"]()}</p>}
      <Definition label={uiMessages["ui.creative-packs.current"]()} member={member} value={member.current} />
      <Definition label={uiMessages["ui.creative-packs.incoming"]()} member={member} value={member.incoming} previews={library.previews} />
      {member.blocking.map(reason => <p key={reason} className="text-xs text-amber-800">{reason}</p>)}
      {member.change === 'different' && !member.reserved && <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={selected.includes(member.key)} disabled={library.busy} onChange={() => toggle(member.key)} className="mt-1" /><span className="break-all">{uiMessages["ui.creative-packs.replace"]()} {member.key}</span></label>}
    </article>)}
    <p className="text-xs">{selected.length} {uiMessages["ui.creative-packs.selected_for_replacement_each_library_applies_its_own_checked_change_if_an_"]()}</p>
  </section>;
}

export function CreativePackMaintenance({ library }: { library: CreativePackLibrary }) {
  const panel = useRef<HTMLElement>(null), [confirmed, setConfirmed] = useState(false), state = library.maintenance!;
  useEffect(() => { panel.current?.scrollIntoView({ block: 'start' }); }, [state]);
  return <section ref={panel} aria-label={uiMessages["ui.creative-packs.creative_pack_maintenance"]()} className="scroll-mt-24 space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 text-sm sm:p-7">
    {state.kind === 'history' ? <>
      <h2 className="break-all text-lg font-semibold">{uiMessages["ui.creative-packs.retained_releases"]()} {state.data.id}</h2>
      <p>{uiMessages["ui.creative-packs.downloads_contain_the_exact_release_definitions_and_images_including_entrie"]()}</p>
      {state.data.releases.map(release => <div key={release.digest} className="space-y-2 rounded-xl bg-[var(--vh-control)] p-4">
        <p className="font-medium">v{release.version} · {release.title}{release.digest === state.data.currentDigest ? uiMessages["ui.creative-packs.active_release"]() : ''}</p>
        <p className="break-all font-mono text-[11px]">{release.digest}</p>
        <Action disabled={library.busy} onClick={() => void library.download({ action: 'export', id: release.id, digest: release.digest })} aria-label={uiMessages["ui.creative-packs.download_release_named"]({ version: release.version, digest: release.digest })} className="vh-secondary text-xs">{uiMessages["ui.creative-packs.download_release"]()}</Action>
      </div>)}
    </> : <>
      <h2 className="break-words text-lg font-semibold">{uiMessages["ui.app.remove"]()} {state.data.current.title}?</h2>
      <p className="break-all">{state.data.current.id} · v{state.data.current.version}</p>
      <p>{uiMessages["ui.creative-packs.this_removes_the_active_creative_pack_listing_recipes_recipe_pack_groups_sk"]()}</p>
      <label className="flex items-start gap-2 leading-6"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1.5" /><span>{uiMessages["ui.creative-packs.remove_the_listing_for"]()} <strong className="break-all">{state.data.current.id}</strong> {uiMessages["ui.creative-packs.and_keep_its_contents"]()}</span></label>
    </>}
    <div className="flex flex-wrap gap-3">
      {state.kind === 'remove' && <Action disabled={!confirmed || library.busy} onClick={() => void library.remove()} className="vh-primary">{uiMessages["ui.creative-packs.remove_creative_pack"]()}</Action>}
      <Action disabled={library.busy} onClick={library.dismiss} className="vh-secondary">{uiMessages["ui.creative-packs.close_pack_maintenance"]()}</Action>
    </div>
  </section>;
}
