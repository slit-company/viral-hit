import { useEffect, useState } from 'react';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RuntimeDefinition } from './runtime-definition';
import type { useRuntimePackages } from './use-runtime-packages';

export function RuntimeReview({ library }: { library: ReturnType<typeof useRuntimePackages> }) {
  const { view } = library, [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [view, library.error]);
  if (!view) return null;
  const inspection = view.kind === 'review' ? view.inspection : undefined;
  const removal = view.kind === 'remove' ? view.review : undefined;
  const pkg = inspection?.package ?? removal?.current;
  const title = inspection ? inspection.current ? 'Review runtime update' : 'Review runtime installation' : removal ? 'Review runtime removal' : 'Retained runtime releases';
  return <Dialog open onOpenChange={open => { if (!open) library.close(); }}>
    <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-3xl">
      <DialogHeader className="pr-7"><DialogTitle>{title}</DialogTitle><DialogDescription>Review the exact version and source before changing this studio.</DialogDescription></DialogHeader>
      {inspection && <>
        <ul className="space-y-2 text-sm" aria-label="Runtime changes">{inspection.changes.map(change => <li key={change.key} className="break-words"><strong>{change.change}</strong> · {change.key}</li>)}</ul>
        {inspection.current && <RuntimeDefinition key={'current:' + inspection.stateDigest} pkg={inspection.current} label="Installed definition" />}
        <RuntimeDefinition key={'incoming:' + inspection.digest} pkg={inspection.package} label="Incoming definition" />
        <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">{inspection.trust}</p>
        {inspection.blocking.length > 0 && <ul role="alert" className="space-y-2 text-sm text-red-800">{inspection.blocking.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      </>}
      {removal && <><RuntimeDefinition pkg={removal.current} label="Installed definition" /><p className="text-sm leading-6">This removes the installed package. Retained releases, projects, jobs and delivery receipts remain. Running processes keep their loaded code until restarted.</p></>}
      {view.kind === 'history' && <section aria-label="Runtime release history" className="space-y-4">
        <p className="break-all font-mono text-xs">{view.history.id}</p>
        {view.history.releases.map(release => <article key={release.digest} className="space-y-3 rounded-xl border border-[var(--vh-border)] p-4">
          <h3 className="break-words font-semibold">{release.title} · v{release.version}</h3><p className="text-xs">{release.digest === view.history.currentDigest ? 'Installed version' : 'Retained version'}</p>
          <p className="break-all font-mono text-[11px] text-[var(--vh-text-2)]">{release.digest}</p>
          <div className="flex flex-wrap gap-2"><Action className="vh-secondary" disabled={library.busy} onClick={() => void library.release(release.id, release.digest, false)} aria-label={'Download v' + release.version + ' ' + release.digest}>Download</Action><Action className="vh-secondary" disabled={library.busy} onClick={() => void library.release(release.id, release.digest, true)} aria-label={'Review restoration of v' + release.version + ' ' + release.digest}>Review restoration</Action></div>
        </article>)}
      </section>}
      {(inspection || removal) && <p className="text-sm leading-6 text-[var(--vh-text-2)]">{inspection?.restart ?? removal?.restart}</p>}
      {library.error && <p role="alert" className="whitespace-pre-wrap break-words rounded-xl bg-red-500/10 p-3 text-sm text-red-800">{library.error}</p>}
      <footer className="space-y-4 border-t border-[var(--vh-border)] pt-4">
        {pkg && <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1.5" checked={confirmed} disabled={library.busy || library.stale} onChange={event => setConfirmed(event.target.checked)} /><span className="min-w-0 break-words">{inspection ? 'I reviewed and trust the source in ' : 'Remove the installed package '}<strong>{pkg.id}</strong>{inspection ? ' to run with this server’s filesystem, environment and network access.' : '. I understand loaded processes change only after restart.'}</span></label>}
        {library.stale && !library.busy && <p className="text-sm">Review the current state again before another change.</p>}
        <div className="flex flex-wrap gap-3"><Action className="vh-secondary" disabled={library.busy} onClick={library.close}>{pkg ? 'Cancel' : 'Done'}</Action>
          {pkg && <Action className="vh-secondary" disabled={library.busy} onClick={() => void library.reviewAgain()}>Review again</Action>}
          {pkg && <Action className="vh-primary" disabled={library.busy || library.stale || !confirmed || !!inspection?.blocking.length} onClick={() => void library.apply()}>{library.busy ? 'Saving…' : removal ? 'Remove package' : inspection?.current ? 'Update package' : 'Install package'}</Action>}
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}
