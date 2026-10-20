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
  return <section aria-label="Make a pack" className="space-y-4">
    <Action onClick={onBack} disabled={b.busy} className="inline-flex items-center gap-1.5 text-xs text-[var(--vh-text-2)]"><ArrowLeft size={14} />Back to packs</Action>
    <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">Bundle recipes from this library into one file you can share. Each recipe keeps its author and license. People who import the file review it before anything is installed.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="title" label="Pack name" value={b.draft.title} onChange={value => b.change('title', value)} />
      <Field id="id" label="Pack ID" hint="Lowercase letters, numbers and hyphens. Recipe IDs in the pack start with it." value={b.draft.id} onChange={value => b.change('id', value)} />
    </div>
    <fieldset className="space-y-2">
      <legend className="text-xs text-[var(--vh-text-2)]">Who is it for</legend>
      <div className="flex flex-wrap gap-2">{(['general', 'specialized'] as const).map(scope => <label key={scope} className={'inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ' + (b.draft.scope === scope ? 'border-[var(--color-ink)]' : 'border-[var(--vh-border)]')}>
        <input type="radio" name="pack-scope" value={scope} checked={b.draft.scope === scope} onChange={() => b.change('scope', scope)} />{packScopeLabel[scope]}
      </label>)}</div>
    </fieldset>
    <Field id="useCases" label="Use cases" hint="Comma-separated, for example: product ad, onboarding video." value={b.draft.useCases} onChange={value => b.change('useCases', value)} />
    <Field id="description" label="Description" hint="What it is for and what people need to bring." value={b.draft.description} onChange={value => b.change('description', value)} multiline />
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="author" label="Author" value={b.draft.author} onChange={value => b.change('author', value)} />
      <Field id="license" label="License" value={b.draft.license} onChange={value => b.change('license', value)} />
    </div>
    <fieldset className="space-y-2">
      <legend className="text-xs text-[var(--vh-text-2)]">Recipes · {b.chosen.length} of up to {MAX_CHOSEN}</legend>
      <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-[var(--vh-border)] p-2">{b.recipes.map(recipe => <li key={recipe.id}>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-sm hover:bg-[var(--vh-control)]">
          <input type="checkbox" className="mt-1" checked={b.chosen.includes(recipe.id)} disabled={!b.chosen.includes(recipe.id) && b.chosen.length >= MAX_CHOSEN} onChange={() => b.toggle(recipe.id)} />
          <span className="min-w-0"><span className="block break-words">{recipe.title}</span><span className="block break-words text-[11px] text-[var(--vh-text-2)]">{recipe.author} · {recipe.license}</span></span>
        </label>
      </li>)}</ul>
    </fieldset>
    {b.built && <section ref={result} aria-label="Built pack" className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
      <p className="text-sm font-semibold">{b.built.inspection.pack.title} <span className="font-normal text-[var(--vh-text-2)]">v{b.built.inspection.pack.version} · {packScopeLabel[b.built.inspection.pack.scope]}</span></p>
      <p>{b.built.inspection.recipes.length} recipes, renamed under {b.built.inspection.pack.id}. Contents, authors and licenses are unchanged.</p>
      {b.built.inspection.unavailableOperations.length > 0 && <p className="text-amber-800">This installation cannot run {b.built.inspection.unavailableOperations.join(', ')}; people who import the pack will see the same warning.</p>}
      <Action onClick={b.download} className="vh-primary text-xs"><Download size={14} />Download pack file</Action>
    </section>}
    {b.error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{b.error}</p>}
    <Action disabled={b.busy || !b.ready} onClick={() => void b.build()} className="vh-secondary w-full text-xs">{b.busy ? 'Building…' : 'Build pack file'}</Action>
  </section>;
}
