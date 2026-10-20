import { useEffect, useRef, useState } from 'react';
import { TextField } from '@seed-design/react';
import { Check, FileJson, Package, PackagePlus } from 'lucide-react';
import { Action } from '@/components/base/action';
import type { PackSummary } from '@/core/harness/recipe-packs';
import { useRecipePacks } from './use-recipe-packs';
import { packScopeLabel } from './pack-labels';

const words = (value: string) => value.replace(/-/g, ' ');

export function RecipePacks({ onInstalled, onMakePack }: { onInstalled: (pack: PackSummary) => Promise<void>; onMakePack: () => void }) {
  const packs = useRecipePacks(onInstalled);
  const fileInput = useRef<HTMLInputElement>(null);
  const review = packs.review?.inspection;
  const reviewPanel = useRef<HTMLElement>(null);
  const [link, setLink] = useState('');
  useEffect(() => { if (review) reviewPanel.current?.scrollIntoView({ block: 'nearest' }); }, [review]);
  return <section aria-label="Recipe packs" className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Package size={16} aria-hidden="true" />Packs</h3>
      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label="Import pack file" onChange={event => { void packs.importFile(event.target.files?.[0]); event.target.value = ''; }} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Action disabled={packs.busy} onClick={onMakePack} className="inline-flex items-center gap-1.5 text-xs"><PackagePlus size={14} />Make a pack</Action>
        <Action disabled={packs.busy} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 text-xs"><FileJson size={14} />Import pack file</Action>
      </div>
    </div>
    <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">General packs fit any project. Packs for a specific job set up one kind of work, such as vertical reels or slide stories. Installing adds recipes to this library; nothing runs.</p>
    <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); void packs.fetchLink(link); }}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <label htmlFor="pack-link" className="block text-xs text-[var(--vh-text-2)]">Add from link</label>
        <TextField.Root className="vh-field"><TextField.Input id="pack-link" type="url" inputMode="url" placeholder="https://github.com/…/my-pack.json" value={link} maxLength={2000} onChange={event => setLink(event.target.value)} /></TextField.Root>
      </div>
      <Action type="submit" disabled={packs.busy || !/^https:\/\/\S+$/.test(link.trim())} className="vh-secondary text-xs">Review link</Action>
    </form>
    <ul className="grid gap-2 sm:grid-cols-2">
      {packs.catalog?.available.map(({ manifest, summary, state }) => <li key={summary.id} className="flex flex-col gap-2 rounded-xl border border-[var(--vh-border)] p-3">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className={'rounded-full px-2 py-0.5 font-semibold ' + (summary.scope === 'general' ? 'bg-[var(--vh-control)]' : 'bg-[var(--color-brand-lime-soft)] text-[var(--color-lime-text)]')}>{packScopeLabel[summary.scope]}</span>
          {state === 'installed' && <span className="inline-flex items-center gap-1 text-[var(--vh-text-2)]"><Check size={12} />Installed</span>}
        </div>
        <p className="text-sm font-semibold">{summary.title}</p>
        <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">{summary.description}</p>
        <p className="text-[11px] text-[var(--vh-text-2)]">{summary.recipeIds.length} recipes · {summary.useCases.map(words).join(', ')}</p>
        <Action aria-label={(state === 'available' ? 'Review ' : '') + summary.title} disabled={packs.busy || state !== 'available'} onClick={() => void packs.inspect(manifest)} className="vh-secondary mt-auto self-start text-xs">{state === 'installed' ? 'Installed' : state === 'other-version' ? 'Other version installed' : 'Review pack'}</Action>
      </li>)}
    </ul>
     {review && <section ref={reviewPanel} aria-label="Pack review" className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
      <p className="break-words text-sm font-semibold">{review.pack.title} <span className="font-normal text-[var(--vh-text-2)]">v{review.pack.version} · {packScopeLabel[review.pack.scope]}</span></p>
      <p className="break-words text-[var(--vh-text-2)]">{review.pack.author} · {review.pack.license}</p>
      {packs.review?.source && <p className="break-all text-[var(--vh-text-2)]">From {packs.review.source}</p>}
      <ul className="space-y-1.5">{review.recipes.map(recipe => <li key={recipe.id} className="break-words">
        <span className="font-semibold">{recipe.title}</span> · {recipe.parameterCount} {recipe.parameterCount === 1 ? 'input' : 'inputs'}
        {recipe.collision === 'same' && <span className="text-[var(--vh-text-2)]"> · already installed</span>}
        {(recipe.collision === 'different' || recipe.collision === 'reserved') && <span className="text-amber-800"> · conflicts with an existing recipe</span>}
        {recipe.unavailableOperations.length > 0 && <span className="text-amber-800"> · needs {recipe.unavailableOperations.join(', ')}</span>}
      </li>)}</ul>
      {review.blocking.map(reason => <p key={reason} className="text-amber-800">{reason}</p>)}
      {!review.blocking.length && <p className="text-[var(--vh-text-2)]">Recipes, inputs and bindings checked. Installing adds them to this library; no jobs start.</p>}
      <div className="flex gap-2 pt-1">
        <Action disabled={packs.busy} onClick={packs.dismiss} className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--vh-border)] px-3 text-xs">Cancel</Action>
        <Action disabled={packs.busy || review.blocking.length > 0} onClick={() => void packs.install()} className="vh-primary min-w-0 flex-1 text-xs">{packs.busy ? 'Working…' : review.collision === 'same' ? 'Use installed pack' : 'Install pack'}</Action>
      </div>
    </section>}
    {packs.error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{packs.error}</p>}
  </section>;
}
