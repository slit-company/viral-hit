import { m as uiMessages } from '@/paraglide/messages.js';
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
    catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : uiMessages["ui.app.could_not_read_connection"]()); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { epoch.current++; }; }, []);
  async function verify() {
    const current = ++epoch.current; setBusy(true); setError(''); setCheck(undefined); setNotice('');
    try { const result = await apiJsonPost<Check>(endpoint, { action: 'check', url }); if (current === epoch.current) setCheck(result); }
    catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : uiMessages["ui.app.connection_check_failed"]()); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function save(next: string | null) {
    if (!connection) return;
    const current = ++epoch.current; setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiJsonPost<Connection>(endpoint, { action: 'save', url: next, expectedRevision: connection.revision });
      if (current !== epoch.current) return;
      setConnection(result); setUrl(result.url ?? ''); setCheck(undefined);
      setNotice(result.url ? uiMessages["ui.app.connection_saved_for_this_workspace_no_jobs_started"]() : uiMessages["ui.app.workspace_connection_disconnected_existing_jobs_and_assets_are_retained"]());
      await onChanged();
    } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : uiMessages["ui.app.could_not_save_connection"]()); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  return <div className="space-y-4">
    <Action disabled={busy} onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-[var(--vh-text-2)]"><ArrowLeft size={14} />{uiMessages["ui.app.back_to_runs"]()}</Action>
    <section className="space-y-4 rounded-xl border border-[var(--vh-border)] p-4">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--vh-control)] p-3"><Plug size={20} /></span><div><h3 className="text-sm font-semibold">{uiMessages["ui.app.your_comfyui_server"]()}</h3><p className="mt-1 text-xs text-[var(--vh-text-2)]">{uiMessages["ui.app.use_your_own_models_and_native_workflows"]()}</p></div></div>
      <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.connect_a_server_reachable_from_viral_hit_the_connection_is_shared_across_p"]()}</p>
      <div className="rounded-lg bg-[var(--vh-control)] p-3 text-xs" role="status">{!connection ? uiMessages["ui.app.loading_connection"]() : connection.source === 'environment' ? uiMessages["ui.app.managed_by_viral_hit_comfyui_url_on_the_server_and_worker"]() : connection.url ? uiMessages["ui.app.connection_revision"]({ revision: connection.revision }) : uiMessages["ui.app.no_native_server_connected"]()}</div>
      {connection?.error && <p role="alert" className="text-xs text-red-800">{connection.error}</p>}
      <label className="block space-y-2 text-xs"><span>{uiMessages["ui.app.comfyui_server_url"]()}</span><input aria-label={uiMessages["ui.app.comfyui_server_url"]()} type="url" inputMode="url" spellCheck={false} autoComplete="off" placeholder="http://127.0.0.1:8188" value={url} disabled={busy || !connection?.editable} onChange={event => { setUrl(event.target.value); setCheck(undefined); setError(''); setNotice(''); }} maxLength={2000} className="h-11 w-full min-w-0 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-3 text-sm disabled:opacity-70" /></label>
      <p className="text-[11px] leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.use_an_http_s_address_without_credentials_query_or_fragment_authentication_"]()}</p>
      <div className="flex flex-wrap items-center gap-4"><Action disabled={busy || !url.trim()} onClick={() => void verify()} className="text-xs underline">{uiMessages["ui.app.check_connection"]()}</Action><Action disabled={busy} onClick={() => void load()} className="text-xs text-[var(--vh-text-2)] underline">{uiMessages["ui.app.reload_settings"]()}</Action></div>
      <div ref={feedback} role="region" aria-label={uiMessages["ui.app.connection_feedback"]()} className="scroll-mb-24 space-y-3">
        {check && <div role="status" className="rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-xs"><p className="font-medium text-[var(--color-lime-text)]">{uiMessages["ui.app.server_responded"]()}</p><p className="mt-1 break-all">{check.url}</p><p className="mt-1">ComfyUI {check.version ?? uiMessages["ui.app.version_unreported"]()} · {check.devices.join(', ') || uiMessages["ui.app.devices_unreported"]()}</p><p className="mt-2 text-[var(--vh-text-2)]">{uiMessages["ui.app.checked"]()} {new Date(check.checkedAt).toLocaleTimeString()}{uiMessages["ui.app.this_check_does_not_save_the_connection"]()}</p></div>}
        {error && <p role="alert" className="break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-[var(--vh-control)] p-3 text-xs">{notice}</p>}
      </div>
    </section>
    <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.app.changing_the_address_prevents_existing_native_jobs_from_using_a_different_s"]()}</p>
    {connection?.editable && <div className="sticky -bottom-px flex flex-wrap gap-3 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] py-3">
      {connection.url && <Action disabled={busy} onClick={() => void save(null)} className="vh-secondary flex-1 text-xs">{uiMessages["ui.app.disconnect_server"]()}</Action>}
      <Action disabled={busy || !url.trim() || url === connection.url} onClick={() => void save(url)} className="vh-primary flex-1 text-xs">{busy ? uiMessages["ui.common.working"]() : uiMessages["ui.app.save_connection"]()}</Action>
    </div>}
  </div>;
}
