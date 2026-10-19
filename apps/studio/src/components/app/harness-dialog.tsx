import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { Job } from '@/core/harness/durable';
import type { Recipe } from '@/core/harness/recipes';

type Run = { id: string; created_at: number; jobs: Job[]; events: { sequence: number; event: string; at: number }[] };
type Result = { configured: boolean; runs: Run[] };
export function HarnessDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Result>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attached, setAttached] = useState<string[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeId, setRecipeId] = useState('open-frame');
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const selected = recipes.find(recipe => recipe.id === recipeId) ?? recipes[0];
  const needsComfy = selected?.nodes.some(node => node.operation === 'comfy.router');
  const ready = selected?.parameters.every(parameter => values[parameter.id] !== undefined ? parameter.type !== 'string' || String(values[parameter.id]).trim().length >= (parameter.minLength ?? 1) : parameter.default !== undefined);
  const requestKey = useRef('');
  const endpoint = `/api/app/projects/${projectId}/runs`;
  async function refresh() { setData(await apiJsonGet<Result>(endpoint)); }
  useEffect(() => {
    if (!open) return;
    let active = true;
    const load = async () => {
      try { const result = await apiJsonGet<Result>(endpoint); if (active) setData(result); }
      catch (e) { if (active) setError(e instanceof Error ? e.message : 'Could not load runs'); }
    };
    void load(); const interval = setInterval(() => void load(), 2500);
    return () => { active = false; clearInterval(interval); };
  }, [open, endpoint]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void apiJsonGet<{ recipes: Recipe[] }>('/api/app/recipes').then(result => { if (active) setRecipes(result.recipes); }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Recipes unavailable'); });
    return () => { active = false; };
  }, [open]);
  async function act(body: unknown) {
    setBusy(true); setError('');
    try { await apiJsonPost(endpoint, body); await refresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); return false; }
    finally { setBusy(false); }
  }
  async function generate() {
    if (!selected) return;
    requestKey.current ||= crypto.randomUUID();
    if (await act({ action: 'recipe', recipeId: selected.id, values, requestKey: requestKey.current })) { setValues({}); requestKey.current = ''; }
  }
  async function attach(runId: string, jobId: string) {
    try {
      const result = await apiJsonGet<{ timeline: { version: number } | null }>(`/api/app/projects/${projectId}/timeline`);
      if (await act({ action: 'attach', runId, jobId, expectedRevision: result.timeline?.version ?? 0 })) setAttached(current => [...current, jobId]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not attach media'); }
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs hover:bg-white/10" aria-label="Generation runs">
      <Activity size={14} /><span className="hidden lg:inline">Runs</span>
    </DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto border border-white/10 bg-[#141719] text-white sm:max-w-3xl">
      <div className="pr-8">
        <p className="mb-2 text-[10px] font-semibold tracking-[0.2em] text-[#c7f36b]">VIRAL HIT / EXECUTION</p>
        <DialogTitle className="text-xl">Generation runs</DialogTitle>
        <DialogDescription className="mt-2 text-sm text-white/60">Your project’s generation history. Closing this window keeps queued work in the local worker.</DialogDescription>
      </div>
      <div className="grid gap-5 sm:grid-cols-[1fr_1.15fr]">
        <section className="space-y-3 rounded-xl border border-white/10 p-4">
          <label htmlFor="run-recipe" className="block text-xs text-white/70">Creative recipe</label>
          <select id="run-recipe" value={selected?.id ?? ''} onChange={e => { setRecipeId(e.target.value); setValues({}); requestKey.current = ''; }} className="w-full rounded-lg border border-white/15 bg-[#1b1e20] p-2.5 text-sm">
            {!recipes.length && <option value="">No recipes available</option>}
            {recipes.map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}
          </select>
          {selected && <>
            <details className="text-xs text-white/60"><summary className="cursor-pointer">{selected.nodes.filter(node => node.operation === 'comfy.router').length} generation · {selected.nodes.filter(node => node.operation !== 'comfy.router').length} local steps · Recipe details</summary><p className="mt-2 leading-relaxed">{selected.description}</p><p className="mt-2 text-[10px]">{selected.author} · {selected.license} · v{selected.version}</p></details>
            <div className="max-h-[28vh] sm:max-h-[min(28rem,calc(85vh-26rem))] space-y-4 overflow-y-auto pr-1" aria-label="Recipe parameters">
            {selected.parameters.map(parameter => {
              const id = `recipe-${parameter.id}`;
              const value = values[parameter.id] ?? parameter.default ?? '';
              const change = (value: string | number | boolean) => { setValues(current => ({ ...current, [parameter.id]: value })); requestKey.current = ''; };
              const fieldClass = 'w-full rounded-lg border border-white/15 bg-black/20 p-3 text-sm outline-none focus:border-[#c7f36b]';
              return <div key={id} className="space-y-2"><label htmlFor={id} className="block text-xs text-white/70">{parameter.label}</label>
                {parameter.type === 'string' && parameter.multiline === false ? <input id={id} type="text" value={String(value)} onChange={e => change(e.target.value)} maxLength={parameter.maxLength ?? 16000} className={fieldClass} />
                  : parameter.type === 'string' ? <textarea id={id} value={String(value)} onChange={e => change(e.target.value)} maxLength={parameter.maxLength ?? 16000} className={`${fieldClass} min-h-28 resize-y`} />
                  : parameter.type === 'number' ? <input id={id} type="number" value={String(value)} min={parameter.min} max={parameter.max} step={parameter.integer ? 1 : 'any'} onChange={e => change(e.target.value === '' ? '' : Number(e.target.value))} className={fieldClass} />
                  : parameter.type === 'boolean' ? <input id={id} type="checkbox" checked={Boolean(value)} onChange={e => change(e.target.checked)} />
                  : <select id={id} value={String(value)} onChange={e => change(e.target.value)} className={fieldClass}><option value="" disabled>Select…</option>{parameter.options.map(option => <option key={option} value={option}>{option}</option>)}</select>}
                {parameter.description && <p className="text-[11px] text-white/50">{parameter.description}</p>}
              </div>;
            })}
            </div>
          </>}
          <p className="text-xs leading-relaxed text-white/60">{!needsComfy ? 'This recipe runs local processing without a generation request.' : data ? data.configured ? 'Uses your Comfy credits. Final usage appears on the provider receipt.' : 'Connect Comfy with COMFY_API_KEY in the server environment, then restart the studio.' : 'Checking Comfy connection…'}</p>
          <button disabled={(needsComfy && !data?.configured) || !ready || busy} onClick={() => void generate()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#c7f36b] px-4 py-2.5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">{needsComfy ? 'Queue generation' : 'Queue import'} <ArrowUpRight size={15} /></button>
          <p className="text-[11px] leading-relaxed text-white/50">Media import steps save verified files in Assets. Add each completed asset to your timeline when it is ready.</p>
        </section>
        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Recent runs</h3><button aria-label="Refresh runs" onClick={() => void refresh().catch(e => setError(String(e)))} className="rounded-md p-1.5 hover:bg-white/10"><RefreshCw size={14} /></button></div>
          {data?.runs.length === 0 && <div className="rounded-xl border border-dashed border-white/15 px-5 py-10 text-center"><Activity className="mx-auto mb-3 text-white/30" size={24} /><p className="text-sm">No runs yet</p><p className="mt-2 text-xs leading-relaxed text-white/50">Queue a creative recipe to keep its progress and output history here.</p></div>}
          {data?.runs.map(run => <article key={run.id} className="rounded-xl border border-white/10 p-3">
            <div className="mb-2 flex items-center justify-between text-[10px] text-white/50"><span>{run.id.slice(0, 8)}</span><time>{new Date(run.created_at).toLocaleString()}</time></div>
            {run.jobs.map(job => <div key={job.id} className="my-2 rounded-lg bg-black/20 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2"><span className="truncate">{job.node_id}</span><span className={job.state === 'succeeded' ? 'text-[#c7f36b]' : 'text-white/60'}>{job.state === 'succeeded' ? job.operation === 'asset.materialize' ? 'Asset ready' : 'Receipt ready' : job.state}</span></div>
              {job.cancel_requested === 1 && <p className="mt-1 text-amber-200">Cancellation requested{job.state === 'succeeded' ? '; result arrived before cancellation completed' : ''}</p>}
              {job.error && <p className="mt-2 break-words text-amber-200">{job.error}</p>}
              {job.operation === 'asset.materialize' && job.state === 'succeeded' && !job.cancel_requested && <div className="mt-3 flex gap-4"><button disabled={busy || attached.includes(job.id)} onClick={() => void attach(run.id, job.id)} className="text-[#c7f36b]">{attached.includes(job.id) ? 'Added to timeline' : 'Add to timeline'}</button><a href={`/assets/${projectId}`} className="text-white/60 underline">View assets</a></div>}
              {job.output_json && <details className="mt-2 text-white/60"><summary className="cursor-pointer">{job.operation === 'asset.materialize' ? 'Local asset record' : 'Provider receipt'}</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(JSON.parse(job.output_json), null, 2)}</pre></details>}
            </div>)}
            <div className="flex gap-3 text-xs">
              {run.jobs.some(j => ['queued', 'submitting', 'running'].includes(j.state)) && <button disabled={busy} onClick={() => void act({ action: 'cancel', runId: run.id })} className="text-white/70 hover:text-white">Request cancel</button>}
              {run.jobs.some(j => j.state === 'failed' && !j.cancel_requested) && <button disabled={busy} onClick={() => void act({ action: 'retry', runId: run.id })} className="text-[#c7f36b]">Retry failed work</button>}
            </div>
          </article>)}
        </section>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
    </DialogContent>
  </Dialog>;
}
