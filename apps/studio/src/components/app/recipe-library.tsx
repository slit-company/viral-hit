import { RecipeRequirementsReport } from './recipe-requirements-report';
import { ModelRecipeBuilder } from './model-recipe-builder';
import { m as uiMessages } from '@/paraglide/messages.js';
import { ComfyRecipeBuilder } from './comfy-recipe-builder';
import { useEffect, useRef, useState } from 'react';
import { Download, FileJson, Copy, ArrowLeft } from 'lucide-react';
import { Action } from '@/components/base/action';
import type { Recipe } from '@/core/harness/recipes';
import type { PackSummary } from '@/core/harness/recipe-packs';
import { RecipePacks } from './recipe-packs';
import { PackBuilder } from './pack-builder';

export type { RecipeInspection } from '@/core/harness/recipe-library-contract';
import { useRecipeLibrary, downloadRecipe as download } from './use-recipe-library';
import { RecipeUpdateReview, RecipeRemovalPanel } from './recipe-lifecycle-review';

export function RecipeLibrary({ selected, installed = false, onInstalled, onRemoved, onPackInstalled, onPackRemoved, onBack }: { selected?: Recipe; installed?: boolean; onInstalled: (recipe: Recipe) => Promise<void>; onRemoved: (recipe: Recipe) => Promise<void>; onPackInstalled: (pack: PackSummary) => Promise<void>; onPackRemoved: (pack: PackSummary) => Promise<void>; onBack: () => void }) {
  const library = useRecipeLibrary(selected, onInstalled, onRemoved);
  const { text, inspection, removal, error, busy, edit, fork, loadFile, inspect, install } = library;
  const [graphBuilder, setGraphBuilder] = useState(false), [packBuilder, setPackBuilder] = useState(false);
  const [modelBuilder, setModelBuilder] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), reviewPanel = useRef<HTMLElement>(null);
  useEffect(() => { if (inspection || removal) reviewPanel.current?.scrollIntoView({ block: 'start' }); }, [inspection, removal]);
  if (removal) return <section ref={reviewPanel}><RecipeRemovalPanel library={library} /></section>;
  if (packBuilder) return <PackBuilder onBack={() => setPackBuilder(false)} />;
  if (modelBuilder) return <ModelRecipeBuilder onBack={() => setModelBuilder(false)} onBuilt={result => { library.acceptBuilt(result); setModelBuilder(false); }} />;
  if (graphBuilder) return <ComfyRecipeBuilder onBack={() => setGraphBuilder(false)} onBuilt={result => {
    library.acceptBuilt(result); setGraphBuilder(false);
  }} />;
  return <div className="space-y-4">
    <Action onClick={onBack} disabled={busy} className="inline-flex items-center gap-1.5 text-xs text-[var(--vh-text-2)]"><ArrowLeft size={14} />{uiMessages["ui.app.back_to_runs"]()}</Action>
    <RecipePacks onInstalled={onPackInstalled} onRemoved={onPackRemoved} onMakePack={() => { setPackBuilder(true); }} />
    <h3 className="border-t border-[var(--vh-border)] pt-4 text-sm font-semibold">{uiMessages["ui.app.your_own_recipe"]()}</h3>
    <Action disabled={busy} onClick={() => { setGraphBuilder(true); }} className="flex w-full items-center justify-between rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-left text-xs"><span><strong className="block text-sm">{uiMessages["ui.app.import_comfyui_workflow"]()}</strong><span className="mt-1 block text-[var(--vh-text-2)]">{uiMessages["ui.app.choose_graph_inputs_and_an_output_then_build_a_portable_recipe"]()}</span></span><FileJson size={18} className="ml-3 shrink-0" /></Action>
    <Action disabled={busy} onClick={() => setModelBuilder(true)} className="w-full rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-left text-xs"><strong className="block text-sm">Build from an installed model</strong><span className="mt-1 block text-[var(--vh-text-2)]">Create a general or specialized recipe from declared controls and source slots.</span></Action>
    {selected && <section className="rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3">
      <p className="text-xs text-[var(--vh-text-2)]">{uiMessages["ui.app.selected_recipe"]()}</p>
      <p className="mt-1 break-words text-sm font-semibold">{selected.title} <span className="font-normal text-[var(--vh-text-2)]">v{selected.version}</span></p>
      <p className="mt-1 break-words text-xs text-[var(--vh-text-2)]">{selected.id} · {selected.author} · {selected.license}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Action disabled={busy} onClick={fork} className="inline-flex items-center gap-1.5 text-xs"><Copy size={14} />{uiMessages["ui.app.duplicate_edit"]()}</Action>
        {installed && <><Action disabled={busy} onClick={() => edit(JSON.stringify(selected, null, 2))} className="text-xs underline">{uiMessages["ui.app.edit_installed_recipe"]()}</Action><Action disabled={busy} onClick={() => void library.reviewRemoval()} className="text-xs underline">{uiMessages["ui.app.review_removal"]()}</Action></>}
        <Action onClick={() => download(selected)} className="inline-flex items-center gap-1.5 text-xs"><Download size={14} />{uiMessages["ui.app.export_selected_json"]()}</Action>
      </div>
    </section>}
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="recipe-json" className="text-sm font-semibold">{uiMessages["ui.app.recipe_json"]()}</label>
      <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label={uiMessages["ui.app.import_recipe_file"]()} onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} />
      <Action disabled={busy} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 text-xs"><FileJson size={14} />{uiMessages["ui.app.import_json_file"]()}</Action>
    </div>
    <textarea id="recipe-json" value={text} disabled={busy} onChange={event => edit(event.target.value)} spellCheck={false} placeholder={uiMessages["ui.app.paste_a_viral_hit_recipe_manifest_import_a_json_file_or_duplicate_the_selec"]()}
      className="h-52 w-full resize-y rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 font-mono text-xs leading-5 text-[var(--vh-text-1)] outline-none focus:border-[var(--vh-accent)] sm:h-64" />
    <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.json_includes_graph_inputs_prompts_filenames_and_defaults_keep_the_source_a"]()}</p>
    {inspection && <section ref={reviewPanel} aria-label={uiMessages["ui.app.recipe_inspection"]()} className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs">
      <p className="break-words text-sm font-semibold">{inspection.recipe.title}</p>
      <p className="break-words">{inspection.recipe.id} · v{inspection.recipe.version}</p>
      <p className="break-words">{inspection.recipe.author} · {inspection.recipe.license}</p>
      <p>{inspection.nodeCount} {uiMessages["ui.app.steps"]()} {inspection.parameterCount} {uiMessages["ui.app.inputs"]()}</p>
      <p className="break-words">{uiMessages["ui.app.operations"]()} {inspection.operations.join(', ')}</p>
      {inspection.modelRequirements && <RecipeRequirementsReport report={inspection.modelRequirements} />}
      {inspection.unavailableOperations.length > 0 && <p className="text-amber-800">{uiMessages["ui.app.missing_runtime_adapters"]()} {inspection.unavailableOperations.join(', ')}{uiMessages["ui.app.you_can_keep_this_recipe_but_this_runtime_cannot_execute_it_yet"]()}</p>}
      {inspection.update ? <RecipeUpdateReview library={library} /> : inspection.collision === 'reserved' || inspection.collision === 'different' ? <p className="text-amber-800">{uiMessages["ui.app.this_id_already_exists_change_its_id_to_save_a_separate_copy"]()}</p> : inspection.collision === 'same' ? <p>{uiMessages["ui.app.identical_recipe_already_installed"]()}</p> : <p className="text-[var(--color-lime-text)]">{inspection.modelRequirements?.status === 'issues' ? 'Can be saved locally; resolve model requirements before running.' : uiMessages["ui.app.ready_to_install_as_a_new_local_recipe"]()}</p>}
      <p className="text-[var(--vh-text-2)]">{uiMessages["ui.app.structure_and_bindings_checked_models_installed_nodes_and_output_quality_st"]()}</p>
      <Action onClick={() => download(inspection.recipe)} className="inline-flex items-center gap-1.5 underline"><Download size={14} />{uiMessages["ui.app.download_reviewed_json"]()}</Action>
    </section>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{error}</p>}
    <div className={(text.trim() ? 'sticky -bottom-px z-10 ' : '') + 'flex gap-2 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] py-3'}>
      <Action disabled={busy || !text.trim()} onClick={() => void inspect()} className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--vh-border)] px-3 text-xs">{uiMessages["ui.app.inspect_json"]()}</Action>
      <Action disabled={busy || !inspection || inspection.collision === 'reserved' || (inspection.collision === 'different' && (!inspection.update || !library.confirmed))} onClick={() => void install()} className="vh-primary min-w-0 flex-1 text-xs">{busy ? uiMessages["ui.common.working"]() : inspection?.update ? uiMessages["ui.app.update_recipe"]() : inspection?.collision === 'same' ? uiMessages["ui.app.use_installed_recipe"]() : uiMessages["ui.app.install_recipe"]()}</Action>
    </div>
  </div>;
}
