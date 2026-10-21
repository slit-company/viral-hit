import { useState } from 'react';
import { RefreshCw, Puzzle } from 'lucide-react';
import { Action } from '@/components/base/action';
import { ProductShell } from '@/components/marketing/product-shell';
import type { ExtensionKind } from '@/core/extensions/contract';
import { useExtensionDiagnostics } from './use-extension-diagnostics';
import { Link } from '@/core/i18n/navigation';
import { ExtensionCard } from './extension-card';

const categories: { kind: ExtensionKind; title: string; description: string; empty: string }[] = [
  { kind: 'providers', title: 'Models', description: 'Image and video models installed by the operator. Built-in model services are not included here.', empty: 'No extra model providers. Add a provider folder on the server, then restart the app, MCP server and workers.' },
  { kind: 'adapters', title: 'Workflow steps', description: 'Additional processing and generation steps available to the execution harness.', empty: 'No extra workflow adapters. Add a checked adapter manifest and module, then restart the app, MCP server and workers.' },
  { kind: 'publishing', title: 'Publishing', description: 'Installed destinations for delivering finished media. Manage built-in social accounts in Connections.', empty: 'No extra publishing connectors. Add a connector folder on the server, then refresh this page.' },
  { kind: 'skills', title: 'Agent skills', description: 'General toolkits and instructions for specific creative jobs. Compatibility checks available tool names, not execution quality.', empty: 'No skills could be loaded. Check the server skill folders and refresh this page.' },
];

export function ExtensionsPage({ locale }: { locale: string }) {
  const status = useExtensionDiagnostics(), [selected, setSelected] = useState<ExtensionKind>('providers');
  const category = categories.find(item => item.kind === selected)!, group = status.data?.groups.find(item => item.kind === selected);
  return <ProductShell active="extensions" locale={locale}><main className="mx-auto w-full max-w-[1120px] space-y-8 px-5 pb-12 pt-14 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-5"><div className="max-w-2xl space-y-4"><p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]">EXTENSIONS</p><h1 className="vh-product-display text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.04em]">Know what’s connected.</h1><p className="text-[15px] leading-6 text-[var(--vh-text-2)]">Inspect the models, workflow steps and skills added to your studio. See what loaded and what needs setup.</p></div><Action className="vh-secondary" disabled={status.busy} onClick={() => void status.refresh()}><RefreshCw size={16} />{status.busy ? 'Checking…' : 'Refresh status'}</Action></header>
    <Link href="/community" className="inline-block text-sm underline underline-offset-4">Browse community catalogs</Link>
    <div className="flex items-start gap-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4 text-sm leading-6 text-[var(--vh-text-2)]"><Puzzle size={18} className="mt-1 shrink-0 text-[var(--vh-text-1)]" /><p><strong className="font-semibold text-[var(--vh-text-1)]">Execution is not tested here.</strong> Metadata and setting presence do not verify credentials or output quality. Refresh does not run extensions or contact providers.</p></div>
    {status.data?.restartRequired && <p role="status" className="scroll-mt-24 rounded-xl bg-amber-100 p-4 text-sm leading-6 text-amber-950">Managed runtime changes are pending. Restart studio, MCP and workers together to activate them.</p>}
    {status.error && <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-sm text-red-800">{status.error} {status.data && 'Showing the previous check.'}</p>}
    <div role="group" aria-label="Extension categories" className="grid grid-cols-2 gap-3 sm:grid-cols-4">{categories.map(item => {
      const result = status.data?.groups.find(group => group.kind === item.kind), issues = result ? result.problems.length + result.items.filter(entry => entry.state === 'needs-setup').length : 0;
      return <Action key={item.kind} disabled={!status.data} aria-pressed={selected === item.kind} onClick={() => setSelected(item.kind)} className={'flex min-h-24 min-w-0 flex-col items-start gap-2 rounded-2xl border p-4 text-left ' + (selected === item.kind ? 'border-[var(--vh-text-1)] bg-[var(--vh-surface)]' : 'border-[var(--vh-border)] bg-transparent')}><span className="text-sm font-semibold">{item.title}</span><span className="text-xs text-[var(--vh-text-2)]">{result ? result.items.length + ' found' + (issues ? ' · ' + issues + ' to review' : '') : 'Loading…'}</span></Action>;
    })}</div>
    <section aria-label={category.title + ' status'} aria-busy={status.busy} className="space-y-5"><div className="space-y-2"><h2 className="text-xl font-semibold">{category.title}</h2><p className="text-sm leading-6 text-[var(--vh-text-2)]">{category.description}</p>{group && <p className="text-xs leading-5 text-[var(--vh-text-2)]">{group.refresh === 'restart' ? 'After changing files or server settings, restart the app, MCP server and workers. Refresh keeps the loaded definitions.' : selected === 'publishing' ? 'Metadata is read again on refresh. Changed publishing configuration requires a new delivery review.' : 'Skills are read again on refresh. Compatibility is checked against this app version and available tools.'}</p>}</div>
      {group?.sourceChanged && <p role="status" className="rounded-xl bg-amber-100 p-4 text-sm text-amber-950">Provider files changed. Restart the app, MCP server and workers to load the changes.</p>}
      {!!group?.problems.length && <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-5"><h3 className="font-semibold text-amber-950">Could not load</h3><ul className="space-y-2 text-sm text-amber-950">{group.problems.map(problem => <li key={problem.location} className="break-words"><strong>{problem.location}</strong> — {problem.message}</li>)}</ul></div>}
      {!group ? <p role="status" className="text-sm text-[var(--vh-text-2)]">Loading extension metadata…</p> : group.items.length ? <div className="grid items-start gap-4 md:grid-cols-2">{group.items.map(item => <ExtensionCard key={item.id} item={item} />)}</div> : <p className="rounded-2xl border border-dashed border-[var(--vh-border)] p-6 text-sm leading-6 text-[var(--vh-text-2)]">{category.empty}</p>}
    </section>
    {status.data && <p role="status" className="text-xs text-[var(--vh-text-2)]">Last checked {new Date(status.data.checkedAt).toLocaleTimeString(locale)}</p>}
  </main></ProductShell>;
}
