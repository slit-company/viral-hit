import { useState } from 'react';
import type { RuntimePackage } from '@/core/runtime-packages/contract';
import { Action } from '@/components/base/action';
import { downloadRuntimePackage } from './use-runtime-packages';

/** Long source strings are rendered only when the operator opens that entry. */
export function RuntimeDefinition({ pkg, label }: { pkg: RuntimePackage; label: string }) {
  const [expanded, setExpanded] = useState<string>();
  return <section aria-label={label} className="min-w-0 space-y-3 rounded-xl border border-[var(--vh-border)] p-4">
    <h3 className="font-semibold">{label} · v{pkg.version}</h3>
    <p className="break-words font-medium">{pkg.title}</p>
    <p className="break-all font-mono text-xs">{pkg.id}</p>
    <p className="text-xs text-[var(--vh-text-2)]">{pkg.scope === 'general' ? 'General purpose' : 'For a specific job'} · {pkg.author} · {pkg.license}</p>
    <p className="whitespace-pre-wrap break-words text-sm leading-6">{pkg.description}</p>
    {pkg.requirements && <p className="whitespace-pre-wrap break-words text-sm leading-6"><strong>Requirements: </strong>{pkg.requirements}</p>}
    {pkg.entries.map((entry, index) => {
      const id = String(entry.kind === 'adapter' ? entry.manifest.operation : entry.manifest.id), key = entry.kind + ':' + id;
      return <details key={key} open={expanded === key} onToggle={event => { if (event.currentTarget.open) setExpanded(key); else setExpanded(value => value === key ? undefined : value); }} className="min-w-0 rounded-lg bg-[var(--vh-control)] p-3">
        <summary className="cursor-pointer break-words text-sm font-medium">{entry.kind} · {id} · source and manifest</summary>
        {expanded === key && <div className="mt-3 space-y-3">
          <h4 className="text-xs font-semibold">Full manifest</h4><pre tabIndex={0} aria-label={label + ' manifest ' + index} className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs leading-5">{JSON.stringify(entry.manifest, null, 2)}</pre>
          <h4 className="text-xs font-semibold">Full source</h4><pre tabIndex={0} aria-label={label + ' source ' + index} className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs leading-5">{entry.source}</pre>
        </div>}
      </details>;
    })}
    <Action className="vh-secondary text-xs" onClick={() => downloadRuntimePackage(pkg)}>Download {label.toLowerCase()}</Action>
  </section>;
}
