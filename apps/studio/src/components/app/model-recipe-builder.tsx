import { useEffect, useRef } from 'react';
import { TextField } from '@seed-design/react';
import { Action } from '@/components/base/action';
import { NativeSelect } from '@/components/ui/native-select';
import type { RecipeInspection } from '@/core/harness/recipe-library-contract';
import { sourceKinds, useModelRecipeBuilder } from './use-model-recipe-builder';

function Field({ id, label, value, onChange, disabled, min, max, maxLength, multiline, hint }: {
  id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean;
  min?: number; max?: number; maxLength?: number; multiline?: boolean; hint?: string;
}) {
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className="block text-xs">{label}</label>
    <TextField.Root className="vh-field" disabled={disabled}>
      {multiline ? <TextField.Textarea id={id} aria-label={label} autoresize={false} value={value} maxLength={maxLength} onChange={event => onChange(event.target.value)} />
        : <TextField.Input id={id} aria-label={label} type={min === undefined ? 'text' : 'number'} min={min} max={max} step={min === undefined ? undefined : 1} value={value} maxLength={maxLength} onChange={event => onChange(event.target.value)} />}
    </TextField.Root>
    {hint && <p className="text-xs text-[var(--vh-text-2)]">{hint}</p>}
  </div>;
}

export function ModelRecipeBuilder({ onBack, onBuilt }: { onBack: () => void; onBuilt: (result: RecipeInspection) => void }) {
  const b = useModelRecipeBuilder(onBuilt), errorPanel = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (b.error) errorPanel.current?.scrollIntoView({ block: 'start' }); }, [b.error]);
  return <div className="space-y-4">
    <Action onClick={onBack} className="text-xs underline">Back to recipe JSON</Action>
    <div><h3 className="text-sm font-semibold">Build from an installed model</h3><p className="mt-1 text-xs text-[var(--vh-text-2)]">Turn a model into a reusable recipe. Choose source slots here; choose actual project files and settings when running it.</p></div>
    <div className="flex items-center justify-between gap-2"><label htmlFor="recipe-model" className="text-xs font-medium">Installed model</label><Action disabled={b.busy} onClick={() => void b.refresh()} className="text-xs underline">Refresh models</Action></div>
    <NativeSelect id="recipe-model" disabled={b.busy} value={b.modelId} onChange={event => b.choose(event.target.value)}>
      <option value="">Choose a model</option>
      {b.modelId && !b.model && <option value={b.modelId}>Unavailable · {b.modelId}</option>}
      {b.models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
    </NativeSelect>
    {!b.busy && !b.models.length && <p className="text-xs text-[var(--vh-text-2)]">No compatible installed models found. Install a provider runtime in Runtime packages, restart the app and worker, then refresh.</p>}
    {b.model && <>
      <section className="space-y-2 break-words rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
        <p className="font-semibold">{b.model.name}</p><p className="break-all">{b.model.id} · {b.model.kind} · {b.model.providerId}</p>
        <p>{b.model.available ? 'Required configuration present; execution is checked when you run.' : 'Missing configuration. You can author and share this recipe; execution needs provider setup.'}</p>
        <details><summary className="cursor-pointer">Adjustable inputs · {b.model.parameters.length}</summary><ul className="mt-2 space-y-1">{b.model.parameters.map(parameter => <li key={parameter.id}>{parameter.label} · {parameter.type}</li>)}</ul></details>
      </section>
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Source slots · {b.total}/20</h4>
        <div className="grid grid-cols-3 gap-2">{sourceKinds.map(kind => <Field key={kind} id={`model-source-${kind}`} label={`${kind} sources`} value={b.counts[kind]} disabled={b.busy || b.model!.references[kind].max === 0}
          min={b.model!.references[kind].min} max={Math.min(20, b.model!.references[kind].max)} hint={`${b.model!.references[kind].min}–${Math.min(20, b.model!.references[kind].max)} allowed`} onChange={value => b.setCounts({ ...b.counts, [kind]: value })} />)}</div>
        <p className="text-xs text-[var(--vh-text-2)]">Every chosen slot becomes a required project input.{b.model.kind === 'analysis' ? ' Analysis requires at least one source and returns a report.' : ' Select which returned media item to keep; the model must produce that item.'}</p>
        {b.model.roles?.length ? <div className="space-y-2"><p className="text-xs text-[var(--vh-text-2)]">This model understands {b.model.roles.join(', ')} references. Choose a role for each visual slot; others stay plain references.</p>
          <div className="grid gap-2 sm:grid-cols-2">{(['image', 'video'] as const).flatMap(kind => Array.from({ length: Math.max(0, Math.min(20, Number(b.counts[kind]) || 0)) }, (_, index) => kind + '-' + (index + 1))).map(slot =>
            <label key={slot} className="flex items-center justify-between gap-2 text-xs"><span>{slot.replace('-', ' source ')}</span>
              <NativeSelect aria-label={'Role of ' + slot} disabled={b.busy} value={b.sourceRoles[slot] ?? ''} className="h-9 w-auto" onChange={event => { const next = { ...b.sourceRoles }; if (event.target.value) next[slot] = event.target.value as 'style' | 'subject' | 'pose'; else delete next[slot]; b.setSourceRoles(next); }}>
                <option value="">Reference</option>{b.model!.roles!.map(role => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}
              </NativeSelect></label>)}</div></div> : null}
        {b.model.mask?.required && <p className="text-xs text-[var(--vh-text-2)]">This model edits a marked area, so the recipe adds a required Mask input. White marks the area to change.</p>}
        {b.model.mask && !b.model.mask.required && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={b.includeMask} disabled={b.busy} onChange={event => b.setIncludeMask(event.target.checked)} />Add a Mask input (white marks the area to change)</label>}
        {b.model.kind !== 'analysis' && <Field id="model-output-index" label="Output index (starts at 0)" value={b.outputIndex} disabled={b.busy} min={0} max={7} onChange={b.setOutputIndex} />}
      </section>
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Recipe details</h4>
        <div className="grid gap-3 sm:grid-cols-2">{([['title', 'Recipe name', 120], ['id', 'Recipe ID', 80], ['author', 'Author', 120], ['license', 'License', 100], ['version', 'Recipe version', 30], ['category', 'Category', 80]] as const).map(([key, label, max]) => <Field key={key} id={`model-recipe-${key}`} label={label} value={b.metadata[key]} disabled={b.busy} maxLength={max} onChange={value => b.setMetadata({ ...b.metadata, [key]: value })} />)}</div>
        <p className="text-xs text-[var(--vh-text-2)]">IDs and categories use lowercase letters, digits and hyphens, starting with a letter.</p>
        <Field id="model-recipe-description" label="Description" value={b.metadata.description} disabled={b.busy} multiline maxLength={2000} onChange={value => b.setMetadata({ ...b.metadata, description: value })} />
        <label className="block space-y-1 text-xs"><span>Use case</span><NativeSelect aria-label="Use case" disabled={b.busy} value={b.scope} onChange={event => b.setScope(event.target.value)}><option value="general">General purpose</option><option value="specialized">Specialized workflow</option></NativeSelect></label>
      </section>
    </>}
    {b.error && <p ref={errorPanel} role="alert" className="break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{b.error}</p>}
    <div className="sticky -bottom-px z-10 space-y-2 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] py-3">
      <p className="text-xs text-[var(--vh-text-2)]">Creates a single-step recipe for review. Installation and generation are separate actions.</p>
      <Action disabled={b.busy || !b.ready} onClick={() => void b.build()} className="vh-primary w-full text-xs">{b.busy ? 'Working…' : 'Build recipe for review'}</Action>
    </div>
  </div>;
}
