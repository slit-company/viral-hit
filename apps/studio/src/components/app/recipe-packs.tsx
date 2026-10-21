import { useEffect, useRef, useState } from 'react';
import { TextField } from '@seed-design/react';
import { Check, FileJson, Package, PackagePlus } from 'lucide-react';
import { Action } from '@/components/base/action';
import type { CatalogHandoff } from '@/core/community/contract';
import type { PackSummary } from '@/core/harness/recipe-packs';
import { useRecipePacks } from './use-recipe-packs';
import { usePackLifecycle } from './use-pack-lifecycle';
import { PackLifecycleReview } from './pack-lifecycle-review';
import { packScopeLabel } from './pack-labels';

const words = (value: string) => value.replace(/-/g, ' ');

export function RecipePacks({ onInstalled, onRemoved, onMakePack, shared = {} }: { onInstalled: (pack: PackSummary) => Promise<void>; onRemoved: (pack: PackSummary) => Promise<void>; onMakePack: () => void; shared?: CatalogHandoff }) {
  const packs = useRecipePacks(onInstalled);
  const lifecycle = usePackLifecycle(async (kind, pack) => { await packs.load(); await (kind === 'update' ? onInstalled(pack) : onRemoved(pack)); });
  const busy = packs.busy || lifecycle.busy;
  const fileInput = useRef<HTMLInputElement>(null);
  const review = packs.review?.inspection;
  const reviewPanel = useRef<HTMLElement>(null);
  const [link, setLink] = useState(shared.source ?? '');
  useEffect(() => { if (review) reviewPanel.current?.scrollIntoView({ block: 'nearest' }); }, [review]);
  return <section aria-label="Recipe packs" className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Package size={16} aria-hidden="true" />Packs</h3>
      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label="Import pack file" onChange={event => { lifecycle.dismiss(); void packs.importFile(event.target.files?.[0]); event.target.value = ''; }} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Action disabled={busy || !packs.catalog} onClick={onMakePack} className="inline-flex items-center gap-1.5 text-xs"><PackagePlus size={14} />Make a pack</Action>
        <Action disabled={busy || !packs.catalog} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 text-xs"><FileJson size={14} />Import pack file</Action>
      </div>
    </div>
    <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">General packs fit any project. Packs for a specific job set up one kind of work, such as vertical reels or slide stories. Installing adds recipes to this library; nothing runs.</p>
    {packs.catalog?.installed.some(pack => pack.content.state !== 'complete') && <section aria-label="Changed recipe packs" className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
      <h4 className="font-semibold">Installed pack changes</h4>
      {packs.catalog.installed.filter(pack => pack.content.state !== 'complete').map(pack => <p key={pack.id} className="break-words"><strong>{pack.title}</strong> · {pack.id} · {pack.content.state === 'missing' ? 'Recipes missing: ' + pack.content.missingRecipeIds.join(', ') : 'Recipes changed'}</p>)}
      <p className="text-[var(--vh-text-2)]">Review the original pack file to restore missing recipes. Existing changed definitions are kept.</p>
    </section>}
    {!!packs.catalog?.installed.length && <section aria-label="Installed recipe packs" className="space-y-2">
      <h4 className="text-sm font-semibold">Installed packs</h4>
      {packs.catalog.installed.map(pack => <div key={pack.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--vh-border)] p-3 text-xs">
        <div className="min-w-0"><p className="font-semibold">{pack.title}</p><p className="break-all text-[var(--vh-text-2)]">{pack.id} · v{pack.version} · {pack.recipeIds.length} recipes</p></div>
        <Action aria-label={'Review removal of ' + pack.id} disabled={busy} onClick={() => { packs.dismiss(); void lifecycle.inspect('remove', pack.id); }} className="vh-secondary text-xs">Review removal</Action>
      </div>)}
      <p className="text-xs text-[var(--vh-text-2)]">Import a new release file or link to review an update under the same pack ID.</p>
    </section>}
    {lifecycle.review && <PackLifecycleReview lifecycle={lifecycle} />}
    {lifecycle.error && !lifecycle.review && <p role="alert" className="break-words text-xs text-red-800">{lifecycle.error}</p>}
    <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); lifecycle.dismiss(); void packs.fetchLink(link, link.trim() === shared.source ? shared.sha256 : undefined); }}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <label htmlFor="pack-link" className="block text-xs text-[var(--vh-text-2)]">Add from link</label>
        <TextField.Root className="vh-field"><TextField.Input id="pack-link" aria-label="Add from link" type="url" inputMode="url" placeholder="https://github.com/…/my-pack.json" value={link} maxLength={2000} onChange={event => setLink(event.target.value)} /></TextField.Root>
      </div>
      <Action type="submit" disabled={!packs.catalog || busy || !/^https:\/\/\S+$/.test(link.trim())} className="vh-secondary text-xs">Review link</Action>
    </form>
    <ul className="grid gap-2 sm:grid-cols-2">
      {packs.catalog?.available.map(({ manifest, summary, state }) => <li key={summary.id} className="flex flex-col gap-2 rounded-xl border border-[var(--vh-border)] p-3">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className={'rounded-full px-2 py-0.5 font-semibold ' + (summary.scope === 'general' ? 'bg-[var(--vh-control)]' : 'bg-[var(--color-brand-lime-soft)] text-[var(--color-lime-text)]')}>{packScopeLabel[summary.scope]}</span>
          {(state === 'modified' || state === 'incomplete') && <span className="text-amber-800">{state === 'modified' ? 'Recipes changed' : 'Recipes missing'}</span>}
          {state === 'installed' && <span className="inline-flex items-center gap-1 text-[var(--vh-text-2)]"><Check size={12} />Installed</span>}
        </div>
        <p className="text-sm font-semibold">{summary.title}</p>
        <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">{summary.description}</p>
        <p className="text-[11px] text-[var(--vh-text-2)]">{summary.recipeIds.length} recipes · {summary.useCases.map(words).join(', ')}</p>
        {summary.requirements && <p className="rounded-lg bg-[var(--vh-control)] px-2 py-1.5 text-[11px] leading-relaxed"><span className="font-semibold">Needs setup.</span> {summary.requirements}</p>}
        <Action aria-label={(['available', 'modified', 'incomplete', 'other-version'].includes(state) ? 'Review ' : '') + summary.title} disabled={busy || state === 'installed'} onClick={() => { lifecycle.dismiss(); void packs.inspect(manifest); }} className="vh-secondary mt-auto self-start text-xs">{state === 'installed' ? 'Installed' : state === 'other-version' ? 'Review available version' : 'Review pack'}</Action>
      </li>)}
    </ul>
     {review && <section ref={reviewPanel} aria-label="Pack review" className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
      <p className="break-words text-sm font-semibold">{review.pack.title} <span className="font-normal text-[var(--vh-text-2)]">v{review.pack.version} · {packScopeLabel[review.pack.scope]}</span></p>
      <p className="break-words text-[var(--vh-text-2)]">{review.pack.author} · {review.pack.license}</p>
      {packs.review?.source && <p className="break-all text-[var(--vh-text-2)]">From {packs.review.source}</p>}
      {review.pack.requirements && <p><span className="font-semibold">Needs setup.</span> {review.pack.requirements}</p>}
      <ul className="space-y-1.5">{review.recipes.map(recipe => <li key={recipe.id} className="break-words">
        <span className="font-semibold">{recipe.title}</span> · {recipe.parameterCount} {recipe.parameterCount === 1 ? 'input' : 'inputs'}
        {recipe.collision === 'same' && <span className="text-[var(--vh-text-2)]"> · already installed</span>}
        {(recipe.collision === 'different' || recipe.collision === 'reserved') && <span className="text-amber-800"> · conflicts with an existing recipe</span>}
        {recipe.unavailableOperations.length > 0 && <span className="text-amber-800"> · needs {recipe.unavailableOperations.join(', ')}</span>}
      </li>)}</ul>
      {review.blocking.map(reason => <p key={reason} className="text-amber-800">{reason}</p>)}
      {!review.blocking.length && <p className="text-[var(--vh-text-2)]">Recipes, inputs and bindings checked. Installing adds them to this library; no jobs start.</p>}
      {(review.collision !== 'none' && (review.collision === 'different' || review.recipes.some(recipe => recipe.collision === 'different'))) && <Action disabled={busy} className="vh-primary" onClick={() => { const manifest = packs.review!.manifest; packs.dismiss(); void lifecycle.inspect('update', manifest); }}>Review pack update</Action>}
      <div className="flex gap-2 pt-1">
        <Action disabled={busy || !packs.catalog} onClick={packs.dismiss} className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--vh-border)] px-3 text-xs">Cancel</Action>
        <Action disabled={busy || review.blocking.length > 0} onClick={() => void packs.install()} className="vh-primary min-w-0 flex-1 text-xs">{busy ? 'Working…' : review.collision === 'same' ? review.recipes.some(recipe => recipe.collision === 'none') ? 'Restore missing recipes' : 'Use installed pack' : 'Install pack'}</Action>
      </div>
    </section>}
    {packs.error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{packs.error}</p>}
  </section>;
}
