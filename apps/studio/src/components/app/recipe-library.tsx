import { ComfyRecipeBuilder } from './comfy-recipe-builder';
import { useEffect, useRef, useState } from 'react';
import { Download, FileJson, Copy, ArrowLeft } from 'lucide-react';
import { Action } from '@/components/base/action';
import { apiJsonPost } from '@/lib/api-client';
import type { Recipe } from '@/core/harness/recipes';
import type { PackSummary } from '@/core/harness/recipe-packs';
import { RecipePacks } from './recipe-packs';
import { PackBuilder } from './pack-builder';

export type RecipeInspection = {
  recipe: Recipe; digest: string; collision: 'none' | 'same' | 'different' | 'reserved';
  operations: string[]; unavailableOperations: string[]; parameterCount: number; nodeCount: number;
};

function download(recipe: Recipe) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(recipe, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${recipe.id}-${recipe.version}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RecipeLibrary({ selected, onInstalled, onPackInstalled, onBack }: { selected?: Recipe; onInstalled: (recipe: Recipe) => Promise<void>; onPackInstalled: (pack: PackSummary) => Promise<void>; onBack: () => void }) {
  const [text, setText] = useState('');
  const [graphBuilder, setGraphBuilder] = useState(false);
  const [packBuilder, setPackBuilder] = useState(false);
  const [inspection, setInspection] = useState<RecipeInspection>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const epoch = useRef(0);
  const reviewPanel = useRef<HTMLElement>(null);
  useEffect(() => { if (inspection) reviewPanel.current?.scrollIntoView({ block: 'start' }); }, [inspection]);
  function edit(value: string) { epoch.current++; setText(value); setInspection(undefined); setError(''); }
  async function loadFile(file?: File) {
    if (!file) return;
    const current = ++epoch.current;
    setInspection(undefined); setError('');
    try {
      if (file.size > 128_000) throw new Error('Recipe files must be 128 KB or smaller.');
      const value = await file.text();
      if (current === epoch.current) edit(value);
    } catch (error) { if (current === epoch.current) setError(error instanceof Error ? error.message : 'Could not read file'); }
  }
  function fork() {
    if (!selected) return;
    // Keep attribution and graph contents. A new identity prevents replacement.
    edit(JSON.stringify({ ...selected, id: `${selected.id.slice(0, 60)}-copy-${crypto.randomUUID().slice(0, 8)}`, title: `${selected.title.slice(0, 113)} (copy)`, version: '1.0.0' }, null, 2));
  }
  async function inspect() {
    const current = ++epoch.current; setBusy(true); setError(''); setInspection(undefined);
    try {
      if (new TextEncoder().encode(text).byteLength > 128_000) throw new Error('Recipe JSON must be 128 KB or smaller.');
      const manifest = JSON.parse(text);
      const result = await apiJsonPost<RecipeInspection>('/api/app/recipes', { action: 'inspect', manifest });
      if (current === epoch.current) setInspection(result);
    } catch (error) { if (current === epoch.current) setError(error instanceof Error ? error.message : 'Could not inspect recipe'); }
    finally { setBusy(false); }
  }
  async function install() {
    if (!inspection) return;
    setBusy(true); setError('');
    try {
      const result = await apiJsonPost<{ recipe: Recipe }>('/api/app/recipes', { action: 'install', manifest: inspection.recipe, expectedDigest: inspection.digest });
      await onInstalled(result.recipe);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not install recipe'); }
    finally { setBusy(false); }
  }
  if (packBuilder) return <PackBuilder onBack={() => setPackBuilder(false)} />;
  if (graphBuilder) return <ComfyRecipeBuilder onBack={() => setGraphBuilder(false)} onBuilt={result => {
    edit(JSON.stringify(result.recipe, null, 2)); setInspection(result); setGraphBuilder(false);
  }} />;
  return <div className="space-y-4">
    <Action onClick={onBack} disabled={busy} className="inline-flex items-center gap-1.5 text-xs text-[var(--vh-text-2)]"><ArrowLeft size={14} />Back to runs</Action>
    <RecipePacks onInstalled={onPackInstalled} onMakePack={() => { setPackBuilder(true); setError(''); }} />
    <h3 className="border-t border-[var(--vh-border)] pt-4 text-sm font-semibold">Your own recipe</h3>
    <Action disabled={busy} onClick={() => { setGraphBuilder(true); setError(''); }} className="flex w-full items-center justify-between rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-left text-xs"><span><strong className="block text-sm">Import ComfyUI workflow</strong><span className="mt-1 block text-[var(--vh-text-2)]">Choose graph inputs and an output, then build a portable recipe.</span></span><FileJson size={18} className="ml-3 shrink-0" /></Action>
    {selected && <section className="rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3">
      <p className="text-xs text-[var(--vh-text-2)]">Selected recipe</p>
      <p className="mt-1 break-words text-sm font-semibold">{selected.title} <span className="font-normal text-[var(--vh-text-2)]">v{selected.version}</span></p>
      <p className="mt-1 break-words text-xs text-[var(--vh-text-2)]">{selected.author} · {selected.license}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Action disabled={busy} onClick={fork} className="inline-flex items-center gap-1.5 text-xs"><Copy size={14} />Duplicate & edit</Action>
        <Action onClick={() => download(selected)} className="inline-flex items-center gap-1.5 text-xs"><Download size={14} />Export selected JSON</Action>
      </div>
    </section>}
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="recipe-json" className="text-sm font-semibold">Recipe JSON</label>
      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label="Import recipe file" onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} />
      <Action disabled={busy} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 text-xs"><FileJson size={14} />Import JSON file</Action>
    </div>
    <textarea id="recipe-json" value={text} disabled={busy} onChange={event => edit(event.target.value)} spellCheck={false} placeholder="Paste a Viral Hit recipe manifest, import a JSON file, or duplicate the selected recipe."
      className="h-52 w-full resize-y rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 font-mono text-xs leading-5 text-[var(--vh-text-1)] outline-none focus:border-[var(--vh-accent)] sm:h-64" />
    <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">JSON includes graph inputs, prompts, filenames and defaults. Keep the source author and license when sharing a fork. Media files and run history are not included.</p>
    {inspection && <section ref={reviewPanel} aria-label="Recipe inspection" className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
      <p className="break-words text-sm font-semibold">{inspection.recipe.title}</p>
      <p className="break-words">{inspection.recipe.id} · v{inspection.recipe.version}</p>
      <p className="break-words">{inspection.recipe.author} · {inspection.recipe.license}</p>
      <p>{inspection.nodeCount} steps · {inspection.parameterCount} inputs</p>
      <p className="break-words">Operations: {inspection.operations.join(', ')}</p>
      {inspection.unavailableOperations.length > 0 && <p className="text-amber-800">Missing runtime adapters: {inspection.unavailableOperations.join(', ')}. You can keep this recipe, but this runtime cannot execute it yet.</p>}
      {inspection.collision === 'reserved' || inspection.collision === 'different' ? <p className="text-amber-800">This ID already exists. Change its ID to save a separate copy.</p> : inspection.collision === 'same' ? <p>Identical recipe already installed.</p> : <p className="text-[var(--color-lime-text)]">Ready to install as a new local recipe.</p>}
      <p className="text-[var(--vh-text-2)]">Structure and bindings checked. Models, installed nodes and output quality still need runtime checks. No jobs started.</p>
      <Action onClick={() => download(inspection.recipe)} className="inline-flex items-center gap-1.5 underline"><Download size={14} />Download reviewed JSON</Action>
    </section>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{error}</p>}
    <div className={(text.trim() ? 'sticky -bottom-px z-10 ' : '') + 'flex gap-2 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] py-3'}>
      <Action disabled={busy || !text.trim()} onClick={() => void inspect()} className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--vh-border)] px-3 text-xs">Inspect JSON</Action>
      <Action disabled={busy || !inspection || ['reserved', 'different'].includes(inspection.collision)} onClick={() => void install()} className="vh-primary min-w-0 flex-1 text-xs">{busy ? 'Working…' : inspection?.collision === 'same' ? 'Use installed recipe' : 'Install recipe'}</Action>
    </div>
  </div>;
}
