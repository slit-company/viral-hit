import { useEffect, useRef, useState } from 'react';
import { FileUp, RefreshCw } from 'lucide-react';
import { Action } from '@/components/base/action';
import { ProductShell } from '@/components/marketing/product-shell';
import { Link } from '@/core/i18n/navigation';
import type { CatalogHandoff } from '@/core/community/contract';
import { RuntimeLinkForm } from './runtime-link-form';
import { RuntimeReview } from './runtime-review';
import { useRuntimePackages } from './use-runtime-packages';

export function RuntimePackagesPage({ locale, shared = {} }: { locale: string; shared?: CatalogHandoff }) {
  const library = useRuntimePackages(), input = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null), returnTo = useRef<HTMLButtonElement | null>(null), wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !library.view;
    wasOpen.current = !!library.view;
    // Async inspection disables the launcher before the dialog can remember it.
    if (closed) {
      const frame = requestAnimationFrame(() => (returnTo.current?.isConnected ? returnTo.current : importButton.current)?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [library.view]);
  const [scope, setScope] = useState<'all' | 'general' | 'specialized'>('all');
  const catalog = library.catalog;
  const packages = catalog ? [...catalog.installed, ...catalog.removed].filter(pkg => scope === 'all' || pkg.scope === scope) : undefined;
  return <ProductShell active="extensions" locale={locale}><main onClickCapture={event => { if (!library.view && event.target instanceof Element) returnTo.current = event.target.closest('button'); }} className="mx-auto w-full max-w-[1120px] space-y-7 px-5 pb-12 pt-14 sm:px-6">
    <header className="space-y-5"><Link href="/extensions" className="text-sm underline underline-offset-4">Extension status</Link><p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]">RUNTIME PACKAGES</p>
      <h1 className="vh-product-display text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.04em]">Bring your own engines.</h1>
      <p className="max-w-2xl text-[15px] leading-6 text-[var(--vh-text-2)]">Add independent models, workflow steps and publishing destinations. Use a general toolkit or a package made for a specific job.</p>
      <div className="flex flex-wrap gap-3"><Action ref={importButton} className="vh-primary" disabled={library.busy || !catalog} onClick={() => input.current?.click()}><FileUp size={16} />Import runtime file</Action><Action className="vh-secondary" disabled={library.busy} onClick={() => void library.refresh()}><RefreshCw size={16} />Refresh packages</Action></div>
      <input ref={input} hidden type="file" accept=".json,application/json" aria-label="Runtime package file" onChange={event => { void library.importFile(event.target.files?.[0]); event.target.value = ''; }} />
    </header>
    <p className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4 text-sm leading-6 text-[var(--vh-text-2)]">Runtime files contain executable source. Importing opens a review; installation requires trusting that source. Packages do not install dependencies or start generation. Activate changes by restarting the studio, MCP and workers together.</p>
    <RuntimeLinkForm library={library} shared={shared} />
    {library.notice && <p role="status" className="break-words rounded-xl bg-[var(--color-brand-lime-soft)] p-4 text-sm leading-6 text-[var(--color-lime-text)]">{library.notice}</p>}
    {library.error && !library.view && <p role="alert" className="whitespace-pre-wrap break-words rounded-xl bg-red-500/10 p-4 text-sm text-red-800">{library.error}</p>}
    {catalog?.restartRequired && <p role="status" className="rounded-xl bg-amber-100 p-4 text-sm leading-6 text-amber-950">Restart pending. The installed set differs from what this studio process loaded. Restart the studio, MCP and workers together. Refreshing this page does not activate code.</p>}
    <section aria-label="Runtime package library" className="space-y-5">
      <div role="group" aria-label="Filter runtime packages" className="flex flex-wrap gap-2">{(['all', 'general', 'specialized'] as const).map(value => <Action key={value} disabled={!catalog || library.busy} aria-pressed={scope === value} onClick={() => setScope(value)} className={'rounded-full border px-4 py-2 text-xs ' + (scope === value ? 'border-[var(--vh-text-1)] bg-[var(--vh-text-1)] text-[var(--vh-bg)]' : 'border-[var(--vh-border)]')}>{value === 'all' ? 'All packages' : value === 'general' ? 'General' : 'For a specific job'}</Action>)}</div>
      {!packages && <p role="status">Loading runtime packages…</p>}
      {packages?.length === 0 && <p className="rounded-2xl border border-dashed border-[var(--vh-border)] p-8 text-sm leading-6 text-[var(--vh-text-2)]">No runtime packages in this group. Add a link or import a runtime JSON file to review its complete source and setup requirements.</p>}
      <ul className="grid items-start gap-4 md:grid-cols-2">{packages?.map(pkg => {
        const installed = catalog!.installed.some(item => item.id === pkg.id), loaded = catalog!.loaded.find(item => item.id === pkg.id);
        return <li key={pkg.id} className="min-w-0 space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5">
          <p className="text-xs text-[var(--vh-text-2)]">{pkg.scope === 'general' ? 'General purpose' : 'For a specific job'} · {installed ? 'Installed' : 'Removed; releases retained'}</p>
          <h2 className="break-words text-lg font-semibold">{pkg.title}</h2><p className="break-all font-mono text-xs">{pkg.id} · v{pkg.version}</p><p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--vh-text-2)]">{pkg.description}</p>
          <p className="rounded-lg bg-[var(--vh-control)] p-3 text-xs leading-5">{loaded ? 'Studio loaded v' + loaded.version + (installed && loaded.digest === pkg.digest ? ' · matches installed release' : ' · restart pending') : installed ? 'Not loaded in this studio process · restart pending' : 'Not loaded in this studio process'}</p>
          <ul className="space-y-2 text-xs text-[var(--vh-text-2)]">{pkg.entries.map(entry => <li key={entry.kind + ':' + entry.id} className="break-words">{entry.kind} · {entry.label}<span className="block break-all font-mono">{entry.id}</span></li>)}</ul>
          <div className="flex flex-wrap gap-3"><Action className="vh-secondary" disabled={library.busy} aria-label={'History for ' + pkg.id} onClick={() => void library.history(pkg.id)}>Versions & downloads</Action>{installed && <Action className="vh-secondary" disabled={library.busy} aria-label={'Review removal of ' + pkg.id} onClick={() => void library.reviewRemoval(pkg.id)}>Remove…</Action>}</div>
        </li>;
      })}</ul>
    </section>
    <RuntimeReview library={library} />
  </main></ProductShell>;
}
