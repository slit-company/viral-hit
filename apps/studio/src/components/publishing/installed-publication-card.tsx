import { useEffect, useState } from 'react';
import { Action } from '@/components/base/action';
import type { PublicationView } from '@/core/publishing/public-view';
import type { PublicationRequest } from '@/core/publishing/requests';
import { RetainedMediaReview } from './retained-media-review';

export function InstalledPublicationCard({ item, pending, change, edit }: {
  item: PublicationView; pending: boolean; change: (request: PublicationRequest) => Promise<boolean>; edit: () => void;
}) {
  const external = item.external!, selected = { publicationId: item.id, expectedRevision: item.revision };
  const [ready, setReady] = useState(false), [confirmed, setConfirmed] = useState(false);
  useEffect(() => { if (!ready) setConfirmed(false); }, [ready]);
  const review = item.actions.approve || item.actions.resume;
  return <article aria-label={'Publication ' + external.title} className="space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-6">
    <div className="flex flex-wrap justify-between gap-3"><h3 className="min-w-0 flex-1 break-words text-lg font-semibold">{external.title}</h3><span className="rounded-full bg-[var(--vh-control)] px-3 py-1 text-xs capitalize">{item.state === 'approved' ? 'Queued for delivery' : item.state}</span></div>
    <p className="break-words text-sm font-medium">{external.label} · {item.destinationId}</p>
    {review && <RetainedMediaReview projectId={item.projectId} publicationId={item.id} digest={item.digest} assets={external.assets} onReady={setReady} />}
    <section className="space-y-2"><h4 className="text-sm font-medium">Delivery details</h4><dl className="space-y-2 text-sm">{Object.entries(external.metadata as Record<string, unknown>).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3"><dt className="break-words text-[var(--vh-text-2)]">{key}</dt><dd className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</dd></div>)}</dl></section>
    {!external.available && <p role="status" className="rounded-xl bg-[var(--vh-control)] p-3 text-sm leading-6">The original connector or configuration is unavailable or changed. Delivery is paused. Restore it to continue the original session, or review a new draft.</p>}
    {external.delivery && <p className="break-words text-sm">{external.delivery.url ? <a href={external.delivery.url} target="_blank" rel="noreferrer" className="font-medium underline">{external.delivery.label ?? "Open delivery"}</a> : external.delivery.label ?? "Delivery receipt"} · {external.delivery.id}</p>}
    {item.issue && <p role="status" className="rounded-xl bg-[var(--vh-control)] p-3 text-sm leading-6">{item.issue === 'runtime-unavailable' ? 'Waiting for the original connector and destination.' : item.issue === 'start-unknown' || item.issue === 'publish-unknown' ? 'The last write is unconfirmed. Check the original delivery; this job will not publish again automatically.' : 'Delivery needs attention: ' + item.issue.replaceAll('-', ' ') + '.'}</p>}
    {review && <div className="space-y-3 border-t border-[var(--vh-border)] pt-4"><label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1.5" checked={confirmed} disabled={pending || !ready || !external.available} onChange={event => setConfirmed(event.target.checked)} /><span>I reviewed all retained files, the destination and delivery details. Deliver this exact revision.</span></label><Action className="vh-primary" disabled={pending || !ready || !confirmed || !external.available} onClick={() => void change(item.actions.resume ? { action: 'resume', ...selected, confirmed: true } : { action: 'approve', ...selected, expectedDigest: item.digest, confirmed: true })}>{item.actions.resume ? 'Continue original upload' : 'Approve delivery'}</Action></div>}
    <div className="flex flex-wrap gap-2">{item.actions.revise && <Action className="vh-secondary" disabled={pending} onClick={edit}>Edit draft</Action>}{item.actions.reconcile && <Action className="vh-secondary" disabled={pending} onClick={() => void change({ action: 'reconcile', ...selected })}>Check original upload</Action>}{item.actions.stop && <Action className="vh-secondary" disabled={pending} onClick={() => void change({ action: 'stop', ...selected })}>{['draft', 'approved'].includes(item.state) ? 'Cancel delivery' : 'Stop local delivery'}</Action>}</div>
    <details className="text-xs text-[var(--vh-text-2)]"><summary className="cursor-pointer">Media details · revision {item.revision}</summary>{external.assets.map(asset => <p className="mt-2 break-all" key={asset.assetId}>{asset.contentType} · {asset.sizeBytes.toLocaleString()} bytes · SHA-256 {asset.sha256}</p>)}</details>
  </article>;
}
