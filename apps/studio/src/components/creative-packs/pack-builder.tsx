import { useState } from 'react';
import { TextField } from '@seed-design/react';
import { Action } from '@/components/base/action';
import type { CreativePackBuild, CreativePackCatalog } from '@/core/creative-packs/contract';

const initial: CreativePackBuild = { id: '', title: '', description: '', version: '1.0.0', author: '', license: 'Apache-2.0', scope: 'general', useCases: ['creative-work'], recipeIds: [], skillIds: [], characterIds: [] };
export function CreativePackBuilder({ catalog, busy, build }: { catalog: CreativePackCatalog; busy: boolean; build: (pack: CreativePackBuild) => Promise<void> }) {
  const [draft, setDraft] = useState(initial);
  const field = (key: keyof CreativePackBuild, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const choose = (key: 'recipeIds' | 'skillIds' | 'characterIds', id: string, checked: boolean) => setDraft(current => ({ ...current, [key]: checked ? [...current[key], id] : current[key].filter(item => item !== id) }));
  const count = draft.recipeIds.length + draft.skillIds.length + draft.characterIds.length;
  return <form aria-label="Create a creative pack" className="space-y-6" onSubmit={event => { event.preventDefault(); void build(draft); }}>
    <div className="grid gap-4 sm:grid-cols-2">{([
      ['title', 'Pack title', 'A way of working', 120], ['id', 'Pack ID', 'my-creative-kit', 40], ['author', 'Author', 'Your name or team', 120], ['license', 'License', 'Apache-2.0', 100],
    ] as const).map(([key, label, placeholder, maxLength]) => <label key={key} className="space-y-2 text-sm"><span>{label}</span><TextField.Root className="vh-field"><TextField.Input aria-label={label} value={draft[key]} onChange={event => field(key, event.target.value)} required maxLength={maxLength} pattern={key === 'id' ? '[a-z][a-z0-9-]{0,39}' : undefined} placeholder={placeholder} /></TextField.Root></label>)}</div>
    <label className="block space-y-2 text-sm"><span>Description</span><TextField.Root className="vh-field"><TextField.Textarea aria-label="Description" value={draft.description} onChange={event => field('description', event.target.value)} required maxLength={2000} placeholder="What can someone make with this pack?" /></TextField.Root></label>
    <div className="grid gap-4 sm:grid-cols-3"><label className="space-y-2 text-sm"><span>Scope</span><select aria-label="Scope" className="h-[50px] w-full rounded-xl border border-[var(--vh-border)] bg-[var(--vh-surface)] px-3 text-sm" value={draft.scope} onChange={event => field('scope', event.target.value)}><option value="general">General</option><option value="specialized">For a specific job</option></select></label><label className="space-y-2 text-sm"><span>Version</span><TextField.Root className="vh-field"><TextField.Input aria-label="Version" value={draft.version} onChange={event => field('version', event.target.value)} required pattern="[0-9]+\.[0-9]+\.[0-9]+" /></TextField.Root></label><label className="space-y-2 text-sm"><span>Use case</span><TextField.Root className="vh-field"><TextField.Input aria-label="Use case" value={draft.useCases[0]} onChange={event => setDraft(current => ({ ...current, useCases: [event.target.value] }))} required pattern="[a-z][a-z0-9-]{0,79}" maxLength={80} /></TextField.Root></label></div>
    <div className="grid gap-5 lg:grid-cols-3">{([
      ['recipeIds', 'Recipes', catalog.recipes.map(item => ({ id: item.id, label: item.title })), 24],
      ['skillIds', 'Skills', catalog.skills.map(item => ({ id: item.id, label: item.title })), 12],
      ['characterIds', 'Characters', catalog.characters.map(item => ({ id: item.id, label: item.name })), 12],
    ] as const).map(([key, title, choices, max]) => <fieldset key={key} className="min-w-0 rounded-xl border border-[var(--vh-border)] p-4"><legend className="px-1 text-sm font-semibold">{title}</legend><div className="max-h-64 space-y-3 overflow-auto">{choices.length ? choices.map(item => <label key={item.id} className="flex items-start gap-2 text-sm leading-5"><input type="checkbox" aria-label={item.label + ' (' + item.id + ')'} className="mt-1 shrink-0" checked={draft[key].includes(item.id)} disabled={!draft[key].includes(item.id) && draft[key].length >= max} onChange={event => choose(key, item.id, event.target.checked)} /><span className="min-w-0 break-words">{item.label}<span className="mt-0.5 block break-all text-[11px] text-[var(--vh-text-2)]">{item.id}</span></span></label>) : <p className="text-xs text-[var(--vh-text-2)]">None in your library yet.</p>}</div></fieldset>)}</div>
    <p className="text-xs leading-5 text-[var(--vh-text-2)]">Skills keep their full instructions. Characters include all reference images, rules and optional voice/provider identities. Review these contents before sharing. Recipe IDs gain the pack prefix; skill and character IDs stay unchanged.</p>
    <Action type="submit" disabled={busy || !count} className="vh-primary">{busy ? 'Preparing…' : 'Download creative pack'}</Action>
  </form>;
}
