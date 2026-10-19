import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plug } from 'lucide-react';
import { Action } from '@/components/base/action';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { readComfyConnection, checkComfyConnection } from '@/core/harness/comfy-connection';

type Connection = ReturnType<typeof readComfyConnection>;
type Check = Awaited<ReturnType<typeof checkComfyConnection>>;
const endpoint = '/api/app/comfy-connection';
export function ComfyConnectionSettings({ onBack, onChanged }: { onBack: () => void; onChanged: () => Promise<void> }) {
  const [connection, setConnection] = useState<Connection>();
  const [url, setUrl] = useState('');
  const [check, setCheck] = useState<Check>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error || notice || check) feedback.current?.scrollIntoView({ block: 'center' }); }, [error, notice, check]);
  async function load() {
    const current = ++epoch.current; setBusy(true); setError(''); setCheck(undefined); setNotice('');
    try { const result = await apiJsonGet<Connection>(endpoint); if (current === epoch.current) { setConnection(result); setUrl(result.url ?? ''); } }
    catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : 'Could not read connection'); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { epoch.current++; }; }, []);
  async function verify() {
    const current = ++epoch.current; setBusy(true); setError(''); setCheck(undefined); setNotice('');
    try { const result = await apiJsonPost<Check>(endpoint, { action: 'check', url }); if (current === epoch.current) setCheck(result); }
    catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : 'Connection check failed'); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function save(next: string | null) {
    if (!connection) return;
    const current = ++epoch.current; setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiJsonPost<Connection>(endpoint, { action: 'save', url: next, expectedRevision: connection.revision });
      if (current !== epoch.current) return;
      setConnection(result); setUrl(result.url ?? ''); setCheck(undefined);
      setNotice(result.url ? 'Connection saved for this workspace. No jobs started.' : 'Workspace connection disconnected. Existing jobs and assets are retained.');
      await onChanged();
    } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : 'Could not save connection'); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  return <div className="space-y-4">
    <Action disabled={busy} onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-[var(--vh-text-2)]"><ArrowLeft size={14} />Back to runs</Action>
    <section className="space-y-4 rounded-xl border border-[var(--vh-border)] p-4">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--vh-control)] p-3"><Plug size={20} /></span><div><h3 className="text-sm font-semibold">Your ComfyUI server</h3><p className="mt-1 text-xs text-[var(--vh-text-2)]">Use your own models and native workflows.</p></div></div>
      <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">Connect a server reachable from Viral Hit. The connection is shared across projects in this workspace. Selected images and graph inputs go to this server when you queue a workflow.</p>
      <div className="rounded-lg bg-[var(--vh-control)] p-3 text-xs" role="status">{!connection ? 'Loading connection…' : connection.source === 'environment' ? 'Managed by VIRAL_HIT_COMFYUI_URL on the server and worker.' : connection.url ? `Workspace connection · revision ${connection.revision}` : 'No native server connected.'}</div>
      {connection?.error && <p role="alert" className="text-xs text-red-800">{connection.error}</p>}
      <label className="block space-y-2 text-xs"><span>ComfyUI server URL</span><input aria-label="ComfyUI server URL" type="url" inputMode="url" spellCheck={false} autoComplete="off" placeholder="http://127.0.0.1:8188" value={url} disabled={busy || !connection?.editable} onChange={event => { setUrl(event.target.value); setCheck(undefined); setError(''); setNotice(''); }} maxLength={2000} className="h-11 w-full min-w-0 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-3 text-sm disabled:opacity-70" /></label>
      <p className="text-[11px] leading-relaxed text-[var(--vh-text-2)]">Use an HTTP(S) address without credentials, query or fragment. Authentication and automatic node/model installation are not supported yet. A connection check reads server status; it does not test a model or start a job.</p>
      <div className="flex flex-wrap items-center gap-4"><Action disabled={busy || !url.trim()} onClick={() => void verify()} className="text-xs underline">Check connection</Action><Action disabled={busy} onClick={() => void load()} className="text-xs text-[var(--vh-text-2)] underline">Reload settings</Action></div>
      <div ref={feedback} role="region" aria-label="Connection feedback" className="scroll-mb-24 space-y-3">
        {check && <div role="status" className="rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs"><p className="font-medium text-[var(--color-lime-text)]">Server responded</p><p className="mt-1 break-all">{check.url}</p><p className="mt-1">ComfyUI {check.version ?? 'version not reported'} · {check.devices.join(', ') || 'no devices reported'}</p><p className="mt-2 text-[var(--vh-text-2)]">Checked {new Date(check.checkedAt).toLocaleTimeString()}. This check does not save the connection.</p></div>}
        {error && <p role="alert" className="break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-[var(--vh-control)] p-3 text-xs">{notice}</p>}
      </div>
    </section>
    <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">Changing the address prevents existing native jobs from using a different server. Restore the original address to recover them. Server and worker must share the same workspace data directory; workspace changes are read without a restart.</p>
    {connection?.editable && <div className="sticky -bottom-px flex flex-wrap gap-3 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] py-3">
      {connection.url && <Action disabled={busy} onClick={() => void save(null)} className="vh-secondary flex-1 text-xs">Disconnect server</Action>}
      <Action disabled={busy || !url.trim() || url === connection.url} onClick={() => void save(url)} className="vh-primary flex-1 text-xs">{busy ? 'Working…' : 'Save connection'}</Action>
    </div>}
  </div>;
}
