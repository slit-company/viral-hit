import { useEffect, useRef, useState } from 'react';
import { FileUp, Download, PackagePlus } from 'lucide-react';
import { Action } from '@/components/base/action';
import { ProductShell } from '@/components/marketing/product-shell';
import { useCreativePacks } from './use-creative-packs';
import { CreativePackBuilder } from './pack-builder';
import { CreativePackReview } from './pack-review';
import { PackLinkForm } from './pack-link-form';
import { packContentsLabel } from './pack-labels';

export function CreativePacksPage({ locale }: { locale: string }) {
  const library = useCreativePacks(), input = useRef<HTMLInputElement>(null), review = useRef<HTMLDivElement>(null);
  const [building, setBuilding] = useState(false);
  useEffect(() => { if (library.review) { setBuilding(false); review.current?.scrollIntoView({ block: 'start' }); } }, [library.review]);
  return <ProductShell active="packs" locale={locale}><main className="mx-auto w-full max-w-[1120px] space-y-8 px-5 pb-12 pt-14 sm:px-6">
    <header className="space-y-5"><p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]">CREATIVE PACKS</p><h1 className="vh-product-display text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.04em]">Share a way to create.</h1><p className="max-w-2xl text-[15px] leading-6 text-[var(--vh-text-2)]">Bring recipes, agent skills and characters together. Build a general toolkit or a setup for one particular job, then share one file.</p><div className="flex flex-wrap gap-3"><Action disabled={!library.catalog || library.busy} onClick={() => { library.dismiss(); setBuilding(value => !value); }} className="vh-primary"><PackagePlus size={16} />{building ? 'Close builder' : 'Make a creative pack'}</Action><Action disabled={!library.catalog || library.busy} onClick={() => input.current?.click()} className="vh-secondary"><FileUp size={16} />Import creative pack</Action></div><input ref={input} type="file" accept=".tar,application/x-tar" aria-label="Import creative pack file" className="hidden" onChange={event => { void library.inspect(event.target.files?.[0]); event.target.value = ''; }} /></header>
    {!building && !library.review && <PackLinkForm disabled={!library.catalog || library.busy} fetchLink={library.fetchLink} />}
    {library.notice && <p role="status" className="rounded-xl bg-[var(--color-brand-lime-soft)] p-4 text-sm text-[var(--color-lime-text)]">{library.notice}</p>}
    {library.error && !library.review && <p role="alert" className="break-words rounded-xl bg-red-500/10 p-4 text-sm text-red-800">{library.error}</p>}
    {library.busy && !library.review && <div className="flex flex-wrap items-center gap-3"><p role="status" className="text-sm text-[var(--vh-text-2)]">{library.activity}</p>{library.canCancel && <Action className="vh-secondary" onClick={library.cancelRead}>Cancel review</Action>}</div>}
    {building && library.catalog && <section className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-7"><h2 className="mb-6 text-xl font-semibold">Choose what travels with the pack.</h2><CreativePackBuilder catalog={library.catalog} busy={library.busy} build={pack => library.download({ action: 'build', pack })} /></section>}
    <div ref={review} className="scroll-mt-24">{library.review && <CreativePackReview key={library.review.pack.digest} library={library} />}</div>
    {!building && !library.review && <section aria-label="Installed creative packs" className="space-y-4"><h2 className="text-lg font-semibold">Your creative packs</h2>{!library.catalog ? <p className="text-sm">Loading packs…</p> : !library.catalog.installed.length ? <div className="rounded-2xl border border-dashed border-[var(--vh-border)] p-8 text-sm leading-6 text-[var(--vh-text-2)]">No creative packs installed yet. Add a shared file to review its recipes, full skill instructions and character images before installation.</div> : <ul className="grid gap-4 sm:grid-cols-2">{library.catalog.installed.map(pack => <li key={pack.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5"><span className="text-xs text-[var(--vh-text-2)]">{pack.scope === 'general' ? 'General' : 'For a specific job'} · v{pack.version}</span><h3 className="break-words font-semibold">{pack.title}</h3><p className="break-all font-mono text-[11px] text-[var(--vh-text-2)]">{pack.id}</p><p className="text-sm leading-6 text-[var(--vh-text-2)]">{pack.description}</p><p className="text-xs">{packContentsLabel(pack)}</p><Action aria-label={'Download ' + pack.title + ' (' + pack.id + ')'} disabled={library.busy} onClick={() => void library.download({ action: 'export', id: pack.id })} className="vh-secondary mt-auto self-start text-xs"><Download size={14} />Download pack</Action></li>)}</ul>}</section>}
  </main></ProductShell>;
}
