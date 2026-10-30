import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useRef } from 'react';
import { TextField } from '@seed-design/react';
import { ArrowLeft, Download } from 'lucide-react';
import { Action } from '@/components/base/action';
import { packScopeLabel } from './pack-labels';
import { MAX_CHOSEN, usePackBuilder, type PackDraft } from './use-pack-builder';

function Field({ id, label, hint, value, onChange, multiline }: { id: keyof PackDraft; label: string; hint?: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const inputId = 'pack-' + id;
  return <div className="space-y-1.5">
    <label htmlFor={inputId} className="block text-xs text-[var(--vh-text-2)]">{label}</label>
    <TextField.Root className="vh-field">
      {multiline ? <TextField.Textarea id={inputId} autoresize={false} value={value} maxLength={2000} onChange={event => onChange(event.target.value)} className="resize-y" />
        : <TextField.Input id={inputId} type="text" value={value} maxLength={120} onChange={event => onChange(event.target.value)} />}
    </TextField.Root>
    {hint && <p className="text-[11px] text-[var(--vh-text-2)]">{hint}</p>}
  </div>;
}

export function PackBuilder({ onBack }: { onBack: () => void }) {
  const b = usePackBuilder();
  const result = useRef<HTMLElement>(null);
  useEffect(() => { if (b.built) result.current?.scrollIntoView({ block: 'nearest' }); }, [b.built]);
  return <section aria-label={uiMessages["ui.app.make_a_pack"]()} className="space-y-4">
    <Action onClick={onBack} disabled={b.busy} className="inline-flex items-center gap-1.5 text-xs text-[var(--vh-text-2)]"><ArrowLeft size={14} />{uiMessages["ui.app.back_to_packs"]()}</Action>
    <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.bundle_recipes_from_this_library_into_one_file_you_can_share_each_recipe_ke"]()}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="title" label={uiMessages["ui.app.pack_name"]()} value={b.draft.title} onChange={value => b.change('title', value)} />
      <Field id="id" label={uiMessages["ui.app.pack_id"]()} hint={uiMessages["ui.app.lowercase_letters_numbers_and_hyphens_recipe_ids_in_the_pack_start_with_it"]()} value={b.draft.id} onChange={value => b.change('id', value)} />
    </div>
    <fieldset className="space-y-2">
      <legend className="text-xs text-[var(--vh-text-2)]">{uiMessages["ui.app.who_is_it_for"]()}</legend>
      <div className="flex flex-wrap gap-2">{(['general', 'specialized'] as const).map(scope => <label key={scope} className={'inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ' + (b.draft.scope === scope ? 'border-[var(--color-ink)]' : 'border-[var(--vh-border)]')}>
        <input type="radio" name="pack-scope" value={scope} checked={b.draft.scope === scope} onChange={() => b.change('scope', scope)} />{packScopeLabel[scope]}
      </label>)}</div>
    </fieldset>
    <Field id="useCases" label={uiMessages["ui.app.use_cases"]()} hint={uiMessages["ui.app.comma_separated_for_example_product_ad_onboarding_video"]()} value={b.draft.useCases} onChange={value => b.change('useCases', value)} />
    <Field id="description" label={uiMessages["ui.creative-packs.description"]()} hint={uiMessages["ui.app.what_it_is_for_and_what_people_need_to_bring"]()} value={b.draft.description} onChange={value => b.change('description', value)} multiline />
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="author" label={uiMessages["ui.app.author"]()} value={b.draft.author} onChange={value => b.change('author', value)} />
      <Field id="license" label={uiMessages["ui.app.license"]()} value={b.draft.license} onChange={value => b.change('license', value)} />
    </div>
    <fieldset className="space-y-2">
      <legend className="text-xs text-[var(--vh-text-2)]">{uiMessages["ui.app.recipes_chosen"]({ count: b.chosen.length, max: MAX_CHOSEN })}</legend>
      <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-[var(--vh-border)] p-2">{b.recipes.map(recipe => <li key={recipe.id}>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-sm hover:bg-[var(--vh-control)]">
          <input type="checkbox" aria-label={recipe.title + ' (' + recipe.id + ')'} className="mt-1" checked={b.chosen.includes(recipe.id)} disabled={!b.chosen.includes(recipe.id) && b.chosen.length >= MAX_CHOSEN} onChange={() => b.toggle(recipe.id)} />
          <span className="min-w-0"><span className="block break-words">{recipe.title}</span><span className="block break-words text-[11px] text-[var(--vh-text-2)]">{recipe.id} · {recipe.author} · {recipe.license}</span></span>
        </label>
      </li>)}</ul>
    </fieldset>
    {b.built && <section ref={result} aria-label={uiMessages["ui.app.built_pack"]()} className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
      <p className="text-sm font-semibold">{b.built.inspection.pack.title} <span className="font-normal text-[var(--vh-text-2)]">v{b.built.inspection.pack.version} · {packScopeLabel[b.built.inspection.pack.scope]}</span></p>
      <p>{b.built.inspection.recipes.length} {uiMessages["ui.app.recipes_renamed_under"]()} {b.built.inspection.pack.id}{uiMessages["ui.app.contents_authors_and_licenses_are_unchanged"]()}</p>
      {b.built.inspection.unavailableOperations.length > 0 && <p className="text-amber-800">{uiMessages["ui.app.this_installation_cannot_run"]()} {b.built.inspection.unavailableOperations.join(', ')}{uiMessages["ui.app.people_who_import_the_pack_will_see_the_same_warning"]()}</p>}
      <Action onClick={b.download} className="vh-primary text-xs"><Download size={14} />{uiMessages["ui.app.download_pack_file"]()}</Action>
    </section>}
    {b.error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{b.error}</p>}
    <Action disabled={b.busy || !b.ready} onClick={() => void b.build()} className="vh-secondary w-full text-xs">{b.busy ? uiMessages["ui.common.building"]() : uiMessages["ui.app.build_pack_file"]()}</Action>
  </section>;
}
