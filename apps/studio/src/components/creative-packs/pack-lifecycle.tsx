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
    <details className="rounded-xl border border-[var(--vh-border)] p-3"><summary className="cursor-pointer break-words font-medium">{label} definition · {member.id}</summary>
      {member.kind === 'skill' && <pre aria-label={`${label} instructions ${member.id}`} className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-6">{(value as SkillPackage).instructions}</pre>}
      <pre aria-label={`${label} definition ${member.id}`} className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5">{JSON.stringify(value, null, 2)}</pre>
    </details>
  </div>;
}
export function CreativeUpdateChoices({ library, selected, toggle }: { library: CreativePackLibrary; selected: string[]; toggle: (key: string) => void }) {
  const review = library.review!.update!;
  return <section aria-label="Creative pack update choices" className="space-y-4 text-sm">
    <h3 className="font-semibold">Review release update · v{review.current.version} → v{library.review!.pack.version}</h3>
    <p>New entries are added. Select only definitions to replace. Local edits and entries dropped from the release stay unless selected for replacement. Previous releases remain downloadable.</p>
    {review.members.map(member => <article key={member.key} className="space-y-3 rounded-xl border border-[var(--vh-border)] p-4">
      <h4 className="break-all font-semibold">{member.kind} · {member.id}</h4>
      <p className="text-xs text-[var(--vh-text-2)]">{member.change === 'add' ? 'Will add' : member.change === 'same' ? 'Matching definition reused' : selected.includes(member.key) ? 'Will replace with incoming definition' : member.current ? 'Current definition kept' : 'Already missing'}</p>
      {!!member.otherPacks.length && <p className="break-words text-xs">Also used by {member.otherPacks.map(pack => `${pack.title} (${pack.id})`).join(', ')}.</p>}
      <Definition label="Current" member={member} value={member.current} />
      <Definition label="Incoming" member={member} value={member.incoming} previews={library.previews} />
      {member.blocking.map(reason => <p key={reason} className="text-xs text-amber-800">{reason}</p>)}
      {member.change === 'different' && !member.reserved && <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={selected.includes(member.key)} disabled={library.busy} onChange={() => toggle(member.key)} className="mt-1" /><span className="break-all">Replace {member.key}</span></label>}
    </article>)}
    <p className="text-xs">{selected.length} selected for replacement. Each library applies its own checked change. If an update stops, completed items remain and the review shows what is left.</p>
  </section>;
}

export function CreativePackMaintenance({ library }: { library: CreativePackLibrary }) {
  const panel = useRef<HTMLElement>(null), [confirmed, setConfirmed] = useState(false), state = library.maintenance!;
  useEffect(() => { panel.current?.scrollIntoView({ block: 'start' }); }, [state]);
  return <section ref={panel} aria-label="Creative pack maintenance" className="scroll-mt-24 space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 text-sm sm:p-7">
    {state.kind === 'history' ? <>
      <h2 className="break-all text-lg font-semibold">Retained releases · {state.data.id}</h2>
      <p>Downloads contain the exact release definitions and images, including entries you kept locally instead of replacing.</p>
      {state.data.releases.map(release => <div key={release.digest} className="space-y-2 rounded-xl bg-[var(--vh-control)] p-4">
        <p className="font-medium">v{release.version} · {release.title}{release.digest === state.data.currentDigest ? ' · Active' : ''}</p>
        <p className="break-all font-mono text-[11px]">{release.digest}</p>
        <Action disabled={library.busy} onClick={() => void library.download({ action: 'export', id: release.id, digest: release.digest })} aria-label={`Download release ${release.version} ${release.digest}`} className="vh-secondary text-xs">Download release</Action>
      </div>)}
    </> : <>
      <h2 className="break-words text-lg font-semibold">Remove {state.data.current.title}?</h2>
      <p className="break-all">{state.data.current.id} · v{state.data.current.version}</p>
      <p>This removes the active creative-pack listing. Recipes, recipe-pack groups, skills, characters, project media and saved runs stay available. Retained releases can still be downloaded.</p>
      <label className="flex items-start gap-2 leading-6"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1.5" /><span>Remove the listing for <strong className="break-all">{state.data.current.id}</strong> and keep its contents.</span></label>
    </>}
    <div className="flex flex-wrap gap-3">
      {state.kind === 'remove' && <Action disabled={!confirmed || library.busy} onClick={() => void library.remove()} className="vh-primary">Remove creative pack</Action>}
      <Action disabled={library.busy} onClick={library.dismiss} className="vh-secondary">Close pack maintenance</Action>
    </div>
  </section>;
}
