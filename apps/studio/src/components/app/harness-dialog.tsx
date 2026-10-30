import { RecipeRequirementsReport } from './recipe-requirements-report';
import { SceneResult } from './scene-result';
import { TranscriptResult } from './transcript-result';
import { m as uiMessages } from '@/paraglide/messages.js';
import type { RecipeCatalog } from '@/core/harness/recipe-library-contract';
import { isAssetJob } from '@/core/harness/asset-operations';
import { ReferenceResult } from './reference-result';
import { InspectionResult } from './inspection-result';
import { eligibleRecipeAssets, type RecipeInputAsset, type AssetCapability } from '@/core/harness/recipe-assets';
import { ComfyConnectionSettings } from './comfy-connection-settings';
import { RecipeLibrary } from './recipe-library';
import { RecipeParameterForm } from './recipe-parameter-form';
import { useRecipeLink } from './use-recipe-link';
import { Action } from '@/components/base/action';
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { Job } from '@/core/harness/durable';
import type { Recipe } from '@/core/harness/recipes';
import type { InstalledPack, PackSummary } from '@/core/harness/recipe-packs';
import { packScopeLabel } from './pack-labels';
import type { TimelineDocument } from '@/core/editor/timeline-document';
import type { RecipePreflight } from '@/core/harness/recipe-preflight.server';

type Run = { id: string; created_at: number; jobs: Job[]; events: { sequence: number; event: string; at: number }[] };
type Capability = AssetCapability & { operation: string; configured: boolean; label: string; configuration: string | null; generation: boolean; reconciliation: boolean; external?: boolean; version?: string; author?: string; license?: string };
type Result = { configured: boolean; capabilities: Capability[]; runs: Run[] };
type InputAsset = RecipeInputAsset;
export function HarnessDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [libraryNotice, setLibraryNotice] = useState('');
  const [data, setData] = useState<Result>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<RecipePreflight>();
  const checkEpoch = useRef(0);
  const dialogContent = useRef<HTMLDivElement>(null);
  const dialogBody = useRef<HTMLDivElement>(null);
  function invalidateCheck() { checkEpoch.current++; setCheck(undefined); }
  const [takeTarget, setTakeTarget] = useState<{ jobId: string; timeline: TimelineDocument; version: number; clipId: string }>();
  const [takeNotice, setTakeNotice] = useState('');
  const [attached, setAttached] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<RecipeCatalog>({ recipes: [], installedIds: [], recipeDigests: {} });
  const { recipes, installedIds, recipeDigests } = catalog;
  const [packs, setPacks] = useState<InstalledPack[]>([]);
  const packed = new Set(packs.flatMap(pack => pack.recipeIds));
  const [inputAssets, setInputAssets] = useState<InputAsset[]>([]);
  const [recipeId, setRecipeId] = useState('open-frame');
  const linkedRecipe = useRecipeLink(id => { setRecipeId(id); setOpen(true); });
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const selected = recipes.find(recipe => recipe.id === recipeId) ?? recipes[0];
  const remoteOperations = [...new Set(selected?.nodes.filter(node => !['asset.materialize', 'editor.sequence'].includes(node.operation)).map(node => node.operation) ?? [])];
  const generationOperations = remoteOperations.filter(operation => data?.capabilities?.find(capability => capability.operation === operation)?.generation ?? operation !== 'comfy.upload');
  const externalCapabilities = data?.capabilities.filter(capability => capability.external && remoteOperations.includes(capability.operation)) ?? [];
  const needsGeneration = generationOperations.length > 0;
  const hasSequence = selected?.nodes.some(node => node.operation === 'editor.sequence');
  const hasScenes = remoteOperations.includes('reference.scenes');
  const hasReferences = remoteOperations.some(operation => operation === 'reference.youtube' || operation === 'reference.sample' || operation === 'reference.scenes');
  const missingCapabilities = remoteOperations.filter(operation => !data?.capabilities?.some(capability => capability.operation === operation && capability.configured));
  const configurationMessage = missingCapabilities.map(operation => data?.capabilities?.find(capability => capability.operation === operation)?.configuration ?? operation).join(', ');
  const ready = selected?.parameters.every(parameter => parameter.type === 'asset' ? eligibleRecipeAssets(selected, parameter, inputAssets, data?.capabilities ?? []).some(asset => asset.id === (values[parameter.id] ?? parameter.default)) : values[parameter.id] !== undefined ? parameter.type !== 'string' || String(values[parameter.id]).trim().length >= (parameter.minLength ?? 1) : parameter.default !== undefined);
  const requestKey = useRef('');
  const endpoint = `/api/app/projects/${projectId}/runs`;
  const materializedInputs = data?.runs.flatMap(run => run.jobs).filter(job => isAssetJob(job) && job.state === 'succeeded').map(job => job.id).sort().join(',') ?? '';

  useEffect(() => { checkEpoch.current++; setCheck(undefined); setChecking(false); setTakeTarget(undefined); setTakeNotice(''); setLibraryOpen(false); setConnectionsOpen(false); setLibraryNotice(''); }, [open, projectId]);
  async function checkServer() {
    if (!selected) return;
    const epoch = ++checkEpoch.current; setChecking(true); setCheck(undefined); setError('');
    try {
      const result = await apiJsonPost<RecipePreflight>(`/api/app/projects/${projectId}/preflight`, { recipeId: selected.id, values, expectedRecipeDigest: recipeDigests[selected.id] });
      if (epoch === checkEpoch.current) { setCheck(result); requestAnimationFrame(() => { if (epoch === checkEpoch.current) dialogBody.current?.scrollTo({ top: 0 }); }); }
    } catch (e) { if (epoch === checkEpoch.current) setError(e instanceof Error ? e.message : uiMessages["ui.app.server_check_failed"]()); }
    finally { if (epoch === checkEpoch.current) setChecking(false); }
  }
  async function refresh() { setData(await apiJsonGet<Result>(endpoint)); }
  useEffect(() => {
    if (!open) return;
    let active = true;
    const load = async () => {
      try { const result = await apiJsonGet<Result>(endpoint); if (active) setData(result); }
      catch (e) { if (active) setError(e instanceof Error ? e.message : uiMessages["ui.app.could_not_load_runs"]()); }
    };
    void load(); const interval = setInterval(() => void load(), 2500);
    return () => { active = false; clearInterval(interval); };
  }, [open, endpoint]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void apiJsonGet<RecipeCatalog & { packs?: InstalledPack[] }>('/api/app/recipes').then(result => { if (active) { setCatalog(result); setPacks(result.packs ?? []); if (linkedRecipe && !result.recipes.some(recipe => recipe.id === linkedRecipe)) setError('Recipe ' + linkedRecipe + ' is not installed in this workspace. Choose another recipe or install it from Packs.'); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : uiMessages["ui.app.recipes_unavailable"]()); });
    return () => { active = false; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setInputAssets([]);
    void apiJsonGet<{ assets: InputAsset[] }>(`/api/app/projects/${projectId}/assets`).then(result => { if (active) setInputAssets(result.assets); }).catch(e => { if (active) setError(e instanceof Error ? e.message : uiMessages["ui.app.project_media_unavailable"]()); });
    return () => { active = false; };
  }, [open, projectId, materializedInputs]);
  async function act(body: unknown) {
    setBusy(true); setError('');
    try { await apiJsonPost(endpoint, body); await refresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : uiMessages["ui.app.request_failed"]()); return false; }
    finally { setBusy(false); }
  }
  async function generate() {
    if (!selected) return;
    requestKey.current ||= crypto.randomUUID();
    if (await act({ action: 'recipe', recipeId: selected.id, expectedRecipeDigest: recipeDigests[selected.id], values, requestKey: requestKey.current })) { setValues({}); requestKey.current = ''; invalidateCheck(); }
  }
  async function attach(runId: string, jobId: string) {
    try {
      const result = await apiJsonGet<{ timeline: { version: number } | null }>(`/api/app/projects/${projectId}/timeline`);
      if (await act({ action: 'attach', runId, jobId, expectedRevision: result.timeline?.version ?? 0 })) setAttached(current => [...current, jobId]);
    } catch (e) { setError(e instanceof Error ? e.message : uiMessages["ui.app.could_not_attach_media"]()); }
  }
  async function chooseTake(job: Job) {
    setBusy(true); setError(''); setTakeNotice(''); setTakeTarget(undefined);
    try {
      const { timeline } = await apiJsonGet<{ timeline: { document: TimelineDocument; version: number } | null }>(`/api/app/projects/${projectId}/timeline`);
      if (!timeline) throw new Error(uiMessages["ui.app.add_a_clip_to_the_timeline_first"]());
      const kind = JSON.parse(job.output_json ?? '{}').kind;
      const tracks = timeline.document.tracks.filter(track => !track.locked).map(track => ({ ...track, clips: track.clips.filter(clip => clip.sourceType === kind && !clip.takes.some(take => take.sourceGenerationId === job.id)) }));
      if (!tracks.some(track => track.clips.length)) throw new Error(uiMessages["ui.app.no_unlocked_clips_of_this_media_kind_remain_previously_added_takes_can_be_s"]());
      setTakeTarget({ jobId: job.id, timeline: { ...timeline.document, tracks }, version: timeline.version, clipId: '' });
    } catch (e) { setError(e instanceof Error ? e.message : uiMessages["ui.app.could_not_load_target_clips"]()); }
    finally { setBusy(false); }
  }
  async function applyTake(runId: string) {
    if (!takeTarget?.clipId) return;
    if (await act({ action: 'take', runId, jobId: takeTarget.jobId, clipId: takeTarget.clipId, expectedRevision: takeTarget.version })) {
      setTakeTarget(undefined); setTakeNotice(uiMessages["ui.app.take_applied_close_this_window_and_use_clip_take_in_the_editor_to_restore_t"]());
    }
  }
  async function recipeInstalled(recipe: Pick<Recipe, 'id' | 'title'>, notice = uiMessages["ui.app.recipe_installed"]({ name: recipe.title })) {
    const result = await apiJsonGet<RecipeCatalog & { packs?: InstalledPack[] }>('/api/app/recipes');
    setCatalog(result); setPacks(result.packs ?? []); setRecipeId(recipe.id); setValues({}); requestKey.current = ''; invalidateCheck();
    setLibraryOpen(false); setLibraryNotice(notice);
    dialogBody.current?.scrollTo({ top: 0 });
  }
  async function packInstalled(pack: PackSummary) {
    await recipeInstalled({ id: pack.recipeIds[0], title: pack.title }, uiMessages["ui.app.pack_installed"]({ name: pack.title, count: pack.recipeIds.length }));
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--vh-border)] px-2.5 text-xs hover:bg-[var(--vh-control)]" aria-label={uiMessages["ui.app.generation_runs"]()}>
      <Activity size={14} /><span className="hidden lg:inline">{uiMessages["ui.app.runs"]()}</span>
    </DialogTrigger>
    <DialogContent ref={dialogContent} className="max-h-[85vh] overflow-hidden border border-[var(--vh-border)] bg-[var(--vh-surface)] text-[var(--vh-text-1)] sm:max-w-3xl grid-rows-[auto_minmax(0,1fr)]">
      <div className="pr-8">
        <p className="mb-2 text-[10px] font-semibold tracking-[0.2em] text-[var(--color-lime-text)]">{uiMessages["ui.app.viral_hit_execution"]()}</p>
        <DialogTitle className="text-xl">{connectionsOpen ? uiMessages["ui.publishing.connections"]() : libraryOpen ? uiMessages["ui.app.recipe_library"]() : uiMessages["ui.app.project_runs"]()}</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-[var(--vh-text-2)]">{connectionsOpen ? uiMessages["ui.app.choose_where_your_native_workflows_run"]() : libraryOpen ? uiMessages["ui.app.add_a_ready_made_pack_bring_your_own_workflow_or_share_a_copy_installing_ne"]() : uiMessages["ui.app.your_project_s_workflows_and_source_imports_closing_this_window_keeps_queue"]()}</DialogDescription>
      </div>
      <div ref={dialogBody} className="min-h-0 overflow-y-auto" data-testid="runs-body">
      {connectionsOpen ? <ComfyConnectionSettings onBack={() => { setConnectionsOpen(false); dialogBody.current?.scrollTo({ top: 0 }); }} onChanged={async () => { invalidateCheck(); setChecking(false); requestKey.current = ''; await refresh(); }} /> : libraryOpen ? <RecipeLibrary selected={selected} installed={installedIds.includes(selected?.id ?? '')} onRemoved={recipe => recipeInstalled({ id: '', title: recipe.title }, uiMessages["ui.app.recipe_removed"]({ name: recipe.title }))} onInstalled={recipe => recipeInstalled(recipe)} onPackInstalled={packInstalled} onPackRemoved={pack => recipeInstalled({ id: '', title: pack.title }, uiMessages["ui.app.pack_removed"]({ name: pack.title }))} onBack={() => { setLibraryOpen(false); dialogBody.current?.scrollTo({ top: 0 }); }} /> : <>
      {libraryNotice && <p role="status" className="mb-3 rounded-lg bg-[var(--vh-control)] p-3 text-xs">{libraryNotice}</p>}
      <div className="grid gap-5 sm:grid-cols-[1fr_1.15fr]">
        <section className="space-y-3 rounded-xl border border-[var(--vh-border)] p-4">
          <div className="flex items-center justify-between gap-2"><label htmlFor="run-recipe" className="block text-xs text-[var(--vh-text-2)]">{uiMessages["ui.app.creative_recipe"]()}</label><Action onClick={() => { setLibraryOpen(true); setError(''); dialogBody.current?.scrollTo({ top: 0 }); }} className="text-xs text-[var(--color-lime-text)]">{uiMessages["ui.app.recipe_library"]()}</Action></div>
          <select id="run-recipe" value={selected?.id ?? ''} onChange={e => { setRecipeId(e.target.value); setValues({}); requestKey.current = ''; invalidateCheck(); setChecking(false); }} className="w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)] p-2.5 text-sm">
            {!recipes.length && <option value="">{uiMessages["ui.app.no_recipes_available"]()}</option>}
            {packs.length ? <>
              <optgroup label={uiMessages["ui.creative-packs.recipes"]()}>{recipes.filter(recipe => !packed.has(recipe.id)).map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}</optgroup>
              {packs.map(pack => <optgroup key={pack.id} label={`${pack.title} · ${packScopeLabel[pack.scope]}`}>{pack.recipeIds.flatMap(id => recipes.filter(recipe => recipe.id === id)).map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}</optgroup>)}
            </> : recipes.map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}
          </select>
          {selected && <>
            <details className="text-xs text-[var(--vh-text-2)]"><summary className="cursor-pointer">{uiMessages["ui.app.recipe_details"]()}</summary><p className="mt-2 leading-relaxed">{selected.description}</p><p className="mt-2 text-[10px]">{selected.author} · {selected.license} · v{selected.version}</p></details>
            <RecipeParameterForm
              recipe={selected} values={values} assets={inputAssets}
              capabilities={data?.capabilities ?? []} projectId={projectId} hasCheck={Boolean(check)}
              onChange={(parameterId, value) => {
                setValues(current => ({ ...current, [parameterId]: value }));
                requestKey.current = ''; invalidateCheck(); setChecking(false);
              }}
            />
          </>}
          <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">{!remoteOperations.length ? uiMessages["ui.app.this_recipe_runs_local_processing_without_a_generation_request"]() : !data ? uiMessages["ui.app.checking_runtime_configuration"]() : missingCapabilities.length ? missingCapabilities.every(operation => operation === 'comfy.workflow' || operation === 'comfy.upload') ? uiMessages["ui.app.choose_your_comfyui_server_in_connections_to_run_this_recipe"]() : `Configure ${configurationMessage} in the server environment, then restart the studio.` : externalCapabilities.length ? `Uses installed adapters: ${externalCapabilities.map(capability => `${capability.label} v${capability.version}`).join(', ')}. Compute and provider charges depend on these adapters.` : !needsGeneration ? hasScenes ? 'Analyzes visual changes in the selected video locally and prepares editable ranges.' : hasReferences ? uiMessages["ui.app.collects_source_media_and_reference_frames_locally_no_generation_or_publish"]() : uiMessages["ui.app.transfers_selected_images_to_your_comfyui_server_without_running_a_workflow"]() : generationOperations.includes('generation.model') ? 'Uses the installed models selected in this recipe. Compute and provider charges depend on those models.' : generationOperations.includes('comfy.workflow') ? uiMessages["ui.app.uses_your_comfyui_server_and_its_installed_nodes_compute_and_any_provider_c"]() : uiMessages["ui.app.uses_your_comfy_credits_final_usage_appears_on_the_provider_receipt"]()}</p>
          {check && <RecipeRequirementsReport report={check} />}
          <div className="sticky bottom-0 z-10 flex gap-2 bg-[var(--vh-surface)] py-3">
          {(generationOperations.includes('comfy.workflow') || generationOperations.includes('generation.model')) && <Action disabled={busy || checking} onClick={() => void checkServer()} className="h-11 min-w-0 flex-1 rounded-lg border border-[var(--vh-border)] px-3 text-xs">{checking ? uiMessages["ui.app.checking_server"]() : generationOperations.includes('generation.model') ? 'Check requirements' : 'Check server'}</Action>}
          <Action disabled={Boolean(check?.models?.length && check.status === 'issues') || missingCapabilities.length > 0 || !ready || busy || checking} onClick={() => void generate()} className="vh-primary min-w-0 flex-1 text-xs">{needsGeneration ? uiMessages["ui.app.queue_generation"]() : externalCapabilities.length || hasReferences || hasSequence ? 'Queue workflow' : 'Queue import'} {!generationOperations.includes('comfy.workflow') && <ArrowUpRight size={15} />}</Action>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.media_import_steps_save_verified_files_in_assets_add_each_completed_asset_t"]()}</p>
        </section>
        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{uiMessages["ui.app.recent_runs"]()}</h3><Action onClick={() => { setConnectionsOpen(true); setError(''); dialogBody.current?.scrollTo({ top: 0 }); }} className="text-xs text-[var(--color-lime-text)]">{uiMessages["ui.app.connections"]()}</Action><Action aria-label={uiMessages["ui.app.refresh_runs"]()} onClick={() => void refresh().catch(e => setError(String(e)))} className="rounded-md p-1.5 hover:bg-[var(--vh-control)]"><RefreshCw size={14} /></Action></div>
          {data?.runs.length === 0 && <div className="rounded-xl border border-dashed border-[var(--vh-border)] px-5 py-10 text-center"><Activity className="mx-auto mb-3 text-[var(--vh-text-2)]" size={24} /><p className="text-sm">{uiMessages["ui.app.no_runs_yet"]()}</p><p className="mt-2 text-xs leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.queue_a_creative_recipe_to_keep_its_progress_and_output_history_here"]()}</p></div>}
          {data?.runs.map(run => <article key={run.id} className="rounded-xl border border-[var(--vh-border)] p-3">
            <div className="mb-2 flex items-center justify-between text-[10px] text-[var(--vh-text-2)]"><span>{run.id.slice(0, 8)}</span><time>{new Date(run.created_at).toLocaleString()}</time></div>
            {run.jobs.map(job => <div key={job.id} className="my-2 rounded-lg bg-[var(--vh-control)] p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2"><span className="truncate">{job.node_id}</span><span className={job.state === 'succeeded' ? 'text-[var(--color-lime-text)]' : 'text-[var(--vh-text-2)]'}>{job.state === 'succeeded' ? job.operation === 'reference.scenes' ? 'Scenes ready' : isAssetJob(job) ? 'Asset ready' : job.operation === 'editor.sequence' ? 'Edit ready' : job.operation === 'comfy.upload' ? 'Input ready' : 'Receipt ready' : job.state}</span></div>
              {job.cancel_requested === 1 && <p className="mt-1 text-amber-800">{uiMessages["ui.app.cancellation_requested"]()}{job.state === 'succeeded' ? uiMessages["ui.app.cancel_result_arrived"]() : ''}</p>}
              {job.error && <p className="mt-2 break-words text-amber-800">{job.error}</p>}
              {job.state === 'succeeded' && <><ReferenceResult projectId={projectId} output={job.output_json} /><SceneResult projectId={projectId} output={job.output_json} /><TranscriptResult projectId={projectId} output={job.output_json} /><InspectionResult projectId={projectId} output={job.output_json} /></>}
              {isAssetJob(job) && job.operation !== 'reference.scenes' && job.state === 'succeeded' && !job.cancel_requested && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2"><Action disabled={busy || attached.includes(job.id)} onClick={() => void attach(run.id, job.id)} className="text-[var(--color-lime-text)]">{attached.includes(job.id) ? uiMessages["ui.app.added_to_timeline"]() : uiMessages["ui.app.add_to_timeline"]()}</Action><Action disabled={busy} onClick={() => void chooseTake(job)} className="text-[var(--color-lime-text)]">{uiMessages["ui.app.use_as_take"]()}</Action><a href={`/assets/${projectId}`} className="text-[var(--vh-text-2)] underline">{uiMessages["ui.app.view_assets"]()}</a></div>}
              {job.operation === 'editor.sequence' && job.state === 'succeeded' && !job.cancel_requested && <div className="mt-3 space-y-2"><p>{uiMessages["ui.app.separate_tracks_for_editing_appends_after_your_current_timeline"]()}</p><Action disabled={busy || attached.includes(job.id)} onClick={() => void attach(run.id, job.id)} className="text-[var(--color-lime-text)]">{attached.includes(job.id) ? uiMessages["ui.app.added_to_timeline"]() : uiMessages["ui.app.add_editable_sequence"]()}</Action></div>}
              {takeTarget?.jobId === job.id && <div className="mt-3 space-y-2 border-t border-[var(--vh-border)] pt-3">
                <label className="block" htmlFor={`take-${job.id}`}>{uiMessages["ui.app.target_clip"]()}</label>
                <select id={`take-${job.id}`} value={takeTarget.clipId} onChange={event => setTakeTarget({ ...takeTarget, clipId: event.target.value })} className="h-10 w-full min-w-0 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)] px-2">
                  <option value="">{uiMessages["ui.app.choose_a_clip"]()}</option>
                  {takeTarget.timeline.tracks.flatMap(track => track.clips.map(clip => <option key={clip.id} value={clip.id}>{clip.name} · {clip.startTime.toFixed(1)}{uiMessages["ui.app.s"]()} {clip.duration.toFixed(1)}{uiMessages["ui.app.s_long"]()}</option>))}
                </select>
                <p className="text-[11px] leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.keeps_timing_effects_and_the_original_the_new_take_starts_at_source_time_ze"]()}</p>
                <div className="flex gap-2"><Action disabled={busy || !takeTarget.clipId} onClick={() => void applyTake(run.id)} className="vh-primary flex-1 text-xs">{uiMessages["ui.app.apply_take"]()}</Action><Action disabled={busy} onClick={() => setTakeTarget(undefined)} className="px-2">{uiMessages["product.history.cancel"]()}</Action></div>
              </div>}
              {job.output_json && <details className="mt-2 text-[var(--vh-text-2)]"><summary className="cursor-pointer">{job.operation === 'reference.scenes' ? 'Analysis record' : isAssetJob(job) ? uiMessages["ui.app.local_asset_record"]() : job.operation === 'editor.sequence' ? 'Edit summary' : uiMessages["ui.app.provider_receipt"]()}</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(JSON.parse(job.output_json), null, 2)}</pre></details>}
            </div>)}
            <div className="flex gap-3 text-xs">
              {run.jobs.some(j => ['queued', 'submitting', 'running'].includes(j.state)) && <Action disabled={busy} onClick={() => void act({ action: 'cancel', runId: run.id })} className="text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]">{uiMessages["ui.app.request_cancel"]()}</Action>}
              {run.jobs.some(j => j.state === 'uncertain' && data.capabilities?.some(capability => capability.operation === j.operation && capability.reconciliation)) && <Action disabled={busy} onClick={() => void act({ action: 'reconcile', runId: run.id })} className="text-[var(--color-lime-text)]">{uiMessages["ui.app.find_original_job"]()}</Action>}
              {run.jobs.some(j => j.state === 'failed' && !j.cancel_requested) && <Action disabled={busy} onClick={() => void act({ action: 'retry', runId: run.id })} className="text-[var(--color-lime-text)]">{uiMessages["ui.app.retry_failed_work"]()}</Action>}
            </div>
          </article>)}
        </section>
      </div>
      {takeNotice && <p role="status" className="rounded-lg bg-[var(--vh-control)] p-3 text-sm">{takeNotice}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-800">{error}</p>}
      </>}
      </div>
    </DialogContent>
  </Dialog>;
}
