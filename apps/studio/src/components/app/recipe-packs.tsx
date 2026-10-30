import { m as uiMessages } from '@/paraglide/messages.js';
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
  return <section aria-label={uiMessages["ui.app.recipe_packs"]()} className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Package size={16} aria-hidden="true" />{uiMessages["ui.app.packs"]()}</h3>
      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label={uiMessages["ui.app.import_pack_file"]()} onChange={event => { lifecycle.dismiss(); void packs.importFile(event.target.files?.[0]); event.target.value = ''; }} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Action disabled={busy || !packs.catalog} onClick={onMakePack} className="inline-flex items-center gap-1.5 text-xs"><PackagePlus size={14} />{uiMessages["ui.app.make_a_pack"]()}</Action>
        <Action disabled={busy || !packs.catalog} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 text-xs"><FileJson size={14} />{uiMessages["ui.app.import_pack_file"]()}</Action>
      </div>
    </div>
    <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.general_packs_fit_any_project_packs_for_a_specific_job_set_up_one_kind_of_w"]()}</p>
    {packs.catalog?.installed.some(pack => pack.content.state !== 'complete') && <section aria-label={uiMessages["ui.app.changed_recipe_packs"]()} className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
      <h4 className="font-semibold">{uiMessages["ui.app.installed_pack_changes"]()}</h4>
      {packs.catalog.installed.filter(pack => pack.content.state !== 'complete').map(pack => <p key={pack.id} className="break-words"><strong>{pack.title}</strong> · {pack.id} · {pack.content.state === 'missing' ? uiMessages["ui.app.recipes_missing"]() + pack.content.missingRecipeIds.join(', ') : uiMessages["ui.app.recipes_changed"]()}</p>)}
      <p className="text-[var(--vh-text-2)]">{uiMessages["ui.app.review_the_original_pack_file_to_restore_missing_recipes_existing_changed_d"]()}</p>
    </section>}
    {!!packs.catalog?.installed.length && <section aria-label={uiMessages["ui.app.installed_recipe_packs"]()} className="space-y-2">
      <h4 className="text-sm font-semibold">{uiMessages["ui.app.installed_packs"]()}</h4>
      {packs.catalog.installed.map(pack => <div key={pack.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--vh-border)] p-3 text-xs">
        <div className="min-w-0"><p className="font-semibold">{pack.title}</p><p className="break-all text-[var(--vh-text-2)]">{pack.id} · v{pack.version} · {pack.recipeIds.length} {uiMessages["ui.app.recipes_2"]()}</p></div>
        <Action aria-label={uiMessages["ui.app.review_removal_of"]() + pack.id} disabled={busy} onClick={() => { packs.dismiss(); void lifecycle.inspect('remove', pack.id); }} className="vh-secondary text-xs">{uiMessages["ui.app.review_removal"]()}</Action>
      </div>)}
      <p className="text-xs text-[var(--vh-text-2)]">{uiMessages["ui.app.import_a_new_release_file_or_link_to_review_an_update_under_the_same_pack_i"]()}</p>
    </section>}
    {lifecycle.review && <PackLifecycleReview lifecycle={lifecycle} />}
    {lifecycle.error && !lifecycle.review && <p role="alert" className="break-words text-xs text-red-800">{lifecycle.error}</p>}
    <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); lifecycle.dismiss(); void packs.fetchLink(link, link.trim() === shared.source ? shared.sha256 : undefined); }}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <label htmlFor="pack-link" className="block text-xs text-[var(--vh-text-2)]">{uiMessages["ui.app.add_from_link"]()}</label>
        <TextField.Root className="vh-field"><TextField.Input id="pack-link" aria-label={uiMessages["ui.app.add_from_link"]()} type="url" inputMode="url" placeholder="https://github.com/…/my-pack.json" value={link} maxLength={2000} onChange={event => setLink(event.target.value)} /></TextField.Root>
      </div>
      <Action type="submit" disabled={!packs.catalog || busy || !/^https:\/\/\S+$/.test(link.trim())} className="vh-secondary text-xs">{uiMessages["ui.app.review_link"]()}</Action>
    </form>
    <ul className="grid gap-2 sm:grid-cols-2">
      {packs.catalog?.available.map(({ manifest, summary, state }) => <li key={summary.id} className="flex flex-col gap-2 rounded-xl border border-[var(--vh-border)] p-3">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className={'rounded-full px-2 py-0.5 font-semibold ' + (summary.scope === 'general' ? 'bg-[var(--vh-control)]' : 'bg-[var(--color-brand-lime-soft)] text-[var(--color-lime-text)]')}>{packScopeLabel[summary.scope]}</span>
          {(state === 'modified' || state === 'incomplete') && <span className="text-amber-800">{state === 'modified' ? uiMessages["ui.app.recipes_changed"]() : uiMessages["ui.app.recipes_missing_2"]()}</span>}
          {state === 'installed' && <span className="inline-flex items-center gap-1 text-[var(--vh-text-2)]"><Check size={12} />{uiMessages["ui.app.installed"]()}</span>}
        </div>
        <p className="text-sm font-semibold">{summary.title}</p>
        <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">{summary.description}</p>
        <p className="text-[11px] text-[var(--vh-text-2)]">{summary.recipeIds.length} {uiMessages["ui.app.recipes_3"]()} {summary.useCases.map(words).join(', ')}</p>
        {summary.requirements && <p className="rounded-lg bg-[var(--vh-control)] px-2 py-1.5 text-[11px] leading-relaxed"><span className="font-semibold">{uiMessages["ui.app.needs_setup_2"]()}</span> {summary.requirements}</p>}
        <Action aria-label={(['available', 'modified', 'incomplete', 'other-version'].includes(state) ? uiMessages["ui.app.review"]() : '') + summary.title} disabled={busy || state === 'installed'} onClick={() => { lifecycle.dismiss(); void packs.inspect(manifest); }} className="vh-secondary mt-auto self-start text-xs">{state === 'installed' ? uiMessages["ui.app.installed"]() : state === 'other-version' ? uiMessages["ui.app.review_available_version"]() : uiMessages["ui.app.review_pack"]()}</Action>
      </li>)}
    </ul>
     {review && <section ref={reviewPanel} aria-label={uiMessages["ui.app.pack_review"]()} className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
      <p className="break-words text-sm font-semibold">{review.pack.title} <span className="font-normal text-[var(--vh-text-2)]">v{review.pack.version} · {packScopeLabel[review.pack.scope]}</span></p>
      <p className="break-words text-[var(--vh-text-2)]">{review.pack.author} · {review.pack.license}</p>
      {packs.review?.source && <p className="break-all text-[var(--vh-text-2)]">{uiMessages["ui.app.from"]()} {packs.review.source}</p>}
      {review.pack.requirements && <p><span className="font-semibold">{uiMessages["ui.app.needs_setup_2"]()}</span> {review.pack.requirements}</p>}
      <ul className="space-y-1.5">{review.recipes.map(recipe => <li key={recipe.id} className="break-words">
        <span className="font-semibold">{recipe.title}</span> · {recipe.parameterCount} {recipe.parameterCount === 1 ? 'input' : 'inputs'}
        {recipe.collision === 'same' && <span className="text-[var(--vh-text-2)]"> {uiMessages["ui.app.already_installed"]()}</span>}
        {(recipe.collision === 'different' || recipe.collision === 'reserved') && <span className="text-amber-800"> {uiMessages["ui.app.conflicts_with_an_existing_recipe"]()}</span>}
        {recipe.unavailableOperations.length > 0 && <span className="text-amber-800"> {uiMessages["ui.app.needs"]()} {recipe.unavailableOperations.join(', ')}</span>}
      </li>)}</ul>
      {review.blocking.map(reason => <p key={reason} className="text-amber-800">{reason}</p>)}
      {!review.blocking.length && <p className="text-[var(--vh-text-2)]">{uiMessages["ui.app.recipes_inputs_and_bindings_checked_installing_adds_them_to_this_library_no"]()}</p>}
      {(review.collision !== 'none' && (review.collision === 'different' || review.recipes.some(recipe => recipe.collision === 'different'))) && <Action disabled={busy} className="vh-primary" onClick={() => { const manifest = packs.review!.manifest; packs.dismiss(); void lifecycle.inspect('update', manifest); }}>{uiMessages["ui.app.review_pack_update"]()}</Action>}
      <div className="flex gap-2 pt-1">
        <Action disabled={busy || !packs.catalog} onClick={packs.dismiss} className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--vh-border)] px-3 text-xs">{uiMessages["product.history.cancel"]()}</Action>
        <Action disabled={busy || review.blocking.length > 0} onClick={() => void packs.install()} className="vh-primary min-w-0 flex-1 text-xs">{busy ? uiMessages["ui.common.working"]() : review.collision === 'same' ? review.recipes.some(recipe => recipe.collision === 'none') ? uiMessages["ui.app.restore_missing_recipes"]() : uiMessages["ui.app.use_installed_pack"]() : uiMessages["ui.app.install_pack"]()}</Action>
      </div>
    </section>}
    {packs.error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{packs.error}</p>}
  </section>;
}
