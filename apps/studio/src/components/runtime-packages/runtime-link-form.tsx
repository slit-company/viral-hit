import { useRef, useState } from 'react';
import { TextField } from '@seed-design/react';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import type { CatalogHandoff } from '@/core/community/contract';
import type { useRuntimePackages } from './use-runtime-packages';

export function RuntimeLinkForm({ library, shared }: { library: ReturnType<typeof useRuntimePackages>; shared: CatalogHandoff }) {
  const sequence = useRef(0);
  const [link, setLink] = useState(shared.source ?? '');
  const [fetching, setFetching] = useState(false);
  const pinned = !!shared.sha256 && link.trim() === shared.source;
  return <section aria-label="Runtime package link" className="scroll-mt-24 space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Add from a link</h2><Link href="/community" className="text-sm underline underline-offset-4">Browse community</Link></div>
    <p className="text-sm leading-6 text-[var(--vh-text-2)]">Open a public HTTPS or GitHub runtime JSON file, up to 12 MB. Downloading opens a source review.</p>
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={event => {
      event.preventDefault(); if (library.busy) return; const current = ++sequence.current; setFetching(true);
      void library.fetchLink(link, pinned ? shared.sha256 : undefined).finally(() => { if (current === sequence.current) setFetching(false); });
    }}>
      <div className="min-w-0 flex-1 space-y-2"><label htmlFor="runtime-link" className="text-sm">Runtime package URL</label><TextField.Root className="vh-field"><TextField.Input id="runtime-link" aria-label="Runtime package URL" value={link} type="url" maxLength={2000} required disabled={library.busy} placeholder="https://example.com/engine.json" onChange={event => setLink(event.target.value)} /></TextField.Root></div>
      <Action type="submit" className="vh-primary" disabled={library.busy || !library.catalog || !link.trim()}>{fetching ? 'Downloading…' : 'Review link'}</Action>
      {fetching && <Action type="button" className="vh-secondary" onClick={() => { sequence.current++; library.cancelDownload(); setFetching(false); }}>Cancel download</Action>}
    </form>
    {pinned ? <p className="break-words text-xs leading-5 text-[var(--vh-text-2)]">Selected from a catalog. The file must match its published SHA-256 before review.</p>
      : shared.sha256 && <p className="text-xs leading-5 text-[var(--vh-text-2)]">This URL differs from the catalog selection. It will be reviewed as a separate download.</p>}
  </section>;
}
