import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { Job } from '@/core/harness/durable';

type Run = { id: string; created_at: number; jobs: Job[]; events: { sequence: number; event: string; at: number }[] };
type Result = { configured: boolean; runs: Run[] };
export function HarnessDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Result>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
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
  async function act(body: unknown) {
    setBusy(true); setError('');
    try { await apiJsonPost(endpoint, body); await refresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); return false; }
    finally { setBusy(false); }
  }
  async function generate() {
    requestKey.current ||= crypto.randomUUID();
    if (await act({ action: 'enqueue', requestKey: requestKey.current, nodes: [{
      id: 'image', operation: 'comfy.router', version: '1', cache: false,
      input: { model: 'bfl/flux-2-pro', body: { prompt: prompt.trim() } },
    }] })) { setPrompt(''); requestKey.current = ''; }
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
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Create an image</h3><span className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-white/60">FLUX.2 Pro</span></div>
          <label htmlFor="comfy-prompt" className="block text-xs text-white/70">Describe your frame</label>
          <textarea id="comfy-prompt" value={prompt} onChange={e => { setPrompt(e.target.value); requestKey.current = ''; }} maxLength={16000} placeholder="A paper observatory on a volcanic island at sunrise…" className="min-h-36 w-full resize-y rounded-lg border border-white/15 bg-black/20 p-3 text-sm outline-none focus:border-[#c7f36b]" />
          <p className="text-xs leading-relaxed text-white/60">{data ? data.configured ? 'Uses your Comfy credits. Final usage appears on the provider receipt.' : 'Connect Comfy with COMFY_API_KEY in the server environment, then restart the studio.' : 'Checking Comfy connection…'}</p>
          <button disabled={!data?.configured || !prompt.trim() || busy} onClick={() => void generate()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#c7f36b] px-4 py-2.5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">Queue generation <ArrowUpRight size={15} /></button>
          <p className="text-[11px] leading-relaxed text-amber-200/80">Preview integration: this route saves the provider receipt. Automatic media import into Assets is still being built.</p>
        </section>
        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Recent runs</h3><button aria-label="Refresh runs" onClick={() => void refresh().catch(e => setError(String(e)))} className="rounded-md p-1.5 hover:bg-white/10"><RefreshCw size={14} /></button></div>
          {data?.runs.length === 0 && <div className="rounded-xl border border-dashed border-white/15 px-5 py-10 text-center"><Activity className="mx-auto mb-3 text-white/30" size={24} /><p className="text-sm">No generations yet</p><p className="mt-2 text-xs leading-relaxed text-white/50">Queue a frame to track progress and keep its generation history here.</p></div>}
          {data?.runs.map(run => <article key={run.id} className="rounded-xl border border-white/10 p-3">
            <div className="mb-2 flex items-center justify-between text-[10px] text-white/50"><span>{run.id.slice(0, 8)}</span><time>{new Date(run.created_at).toLocaleString()}</time></div>
            {run.jobs.map(job => <div key={job.id} className="my-2 rounded-lg bg-black/20 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2"><span className="truncate">{job.node_id}</span><span className={job.state === 'succeeded' ? 'text-[#c7f36b]' : 'text-white/60'}>{job.state === 'succeeded' ? 'Receipt ready' : job.state}</span></div>
              {job.cancel_requested === 1 && <p className="mt-1 text-amber-200">Cancellation requested{job.state === 'succeeded' ? '; result arrived before cancellation completed' : ''}</p>}
              {job.error && <p className="mt-2 break-words text-amber-200">{job.error}</p>}
              {job.output_json && <details className="mt-2 text-white/60"><summary className="cursor-pointer">Provider receipt</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(JSON.parse(job.output_json), null, 2)}</pre></details>}
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
