import { useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PublicationView } from '@/core/publishing/public-view';
import type { PublicationRequest } from '@/core/publishing/requests';

const labels: Record<PublicationView['state'], string> = { draft: 'Draft', approved: 'Queued for upload', starting: 'Creating upload session', uploading: 'Uploading', accepted: 'Video received', staged: 'Ready to publish', publishing: 'Publishing', processing: 'YouTube processing', ready: 'Ready on YouTube', scheduled: 'Scheduled on YouTube', published: 'Public on YouTube', reconciling: 'Checking original upload', uncertain: 'Needs attention', failed: 'Delivery failed', canceled: 'Canceled' };
const issues: Record<NonNullable<PublicationView['issue']>, string> = {
  'start-unknown': 'The session response was lost. Check your channel before preparing another upload; this job will not create a second session.',
  'publish-unknown': 'The final publication response is unconfirmed. Check the original container; this job will not automatically publish again.',
  'upload-unknown': 'The last response was unclear. The worker will check the original remote session before sending more bytes.',
  'session-expired': 'The original upload session expired. Check your channel before starting another draft.',
  'remote-rejected': 'YouTube rejected this delivery. Review your channel and video settings.',
  'runtime-unavailable': 'The upload runtime or original channel is unavailable. Check Connections; approved work waits until it is available.',
  'asset-unavailable': 'The retained video cannot be read. Delivery is paused until the workspace operator restores it.',
  'upload-incomplete': 'The original upload is incomplete. Review this video to continue the same session.',
  stopped: 'Local delivery stopped. A request already sent may still finish on YouTube. Check the original upload to reconcile its status.',
};
export function PublicationCard({ item, channelTitle, canApprove, pending, change, edit }: {
  item: PublicationView; channelTitle?: string; canApprove: boolean; pending: boolean;
  change: (request: PublicationRequest) => Promise<boolean>; edit: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [confirmed, setConfirmed] = useState(false), [previewReady, setPreviewReady] = useState(false), [previewFailed, setPreviewFailed] = useState(false);
  const selected = { publicationId: item.id, expectedRevision: item.revision }, metadata = item.metadata;
  const review = item.actions.approve || item.actions.resume;
  return <article aria-label={`Publication ${metadata?.title ?? item.id}`} className="overflow-hidden rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)]">
    <div className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="min-w-0 flex-1 break-words text-lg font-semibold [overflow-wrap:anywhere]">{metadata?.title ?? 'Unsupported publication version'}</h3><span className="rounded-full bg-[var(--vh-control)] px-3 py-1 text-xs font-medium">{labels[item.state]}</span></div>
      <div className="space-y-1"><p className="break-words text-sm font-medium">{channelTitle ?? 'YouTube channel'}</p><p className="break-all text-xs text-[var(--vh-text-2)]">{item.destinationId}</p></div>
      {review && item.asset && <div className="space-y-2"><video ref={video} aria-label={`Retained video for ${metadata?.title}`} controls preload="metadata" playsInline className="aspect-video w-full rounded-xl bg-black object-contain" src={`/api/app/projects/${item.projectId}/publications/${item.id}/media?digest=${item.digest}`} onLoadedMetadata={() => { setPreviewReady(true); setPreviewFailed(false); }} onError={() => { setConfirmed(false); setPreviewReady(false); setPreviewFailed(true); }} /><p className="text-xs text-[var(--vh-text-2)]">{previewFailed ? 'Retained preview unavailable. Retry before approving.' : 'Retained video · the exact file prepared for delivery'}</p>{previewFailed && <Button variant="outline" onClick={() => { setConfirmed(false); setPreviewReady(false); setPreviewFailed(false); video.current?.load(); }}>Retry preview</Button>}</div>}
      {metadata && <>
        {metadata.description && <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{metadata.description}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div><dt className="text-[var(--vh-text-2)]">Visibility</dt><dd className="mt-1 font-medium capitalize">{metadata.privacy}</dd></div>
          <div><dt className="text-[var(--vh-text-2)]">Made for kids</dt><dd className="mt-1 font-medium">{metadata.madeForKids ? 'Yes' : 'No'}</dd></div>
          <div><dt className="text-[var(--vh-text-2)]">Synthetic content</dt><dd className="mt-1 font-medium">{metadata.containsSyntheticMedia ? 'Yes' : 'No'}</dd></div>
          <div><dt className="text-[var(--vh-text-2)]">Notify subscribers</dt><dd className="mt-1 font-medium">{metadata.notifySubscribers ? 'Yes' : 'No'}</dd></div>
        </dl>
        {metadata.publishAt && <p className="text-sm">Scheduled: <time dateTime={metadata.publishAt}>{new Date(metadata.publishAt).toLocaleString()}</time></p>}
        <details className="text-xs text-[var(--vh-text-2)]"><summary className="cursor-pointer">Video details · revision {item.revision}</summary><div className="mt-2 space-y-2 break-all"><p>Category: {metadata.categoryId} · Tags: {metadata.tags.join(', ') || 'None'}</p><p>File: {item.asset?.sizeBytes.toLocaleString()} bytes · {item.asset?.contentType}</p><p>SHA-256: {item.asset?.sha256}</p></div></details>
      </>}
      {item.issue && <p role="status" className="rounded-xl bg-[var(--vh-control)] p-3 text-sm leading-6">{issues[item.issue]}</p>}
      {item.bytesAccepted !== null && item.asset && <p className="text-xs text-[var(--vh-text-2)]">Transferred: {Math.floor(100 * item.bytesAccepted / item.asset.sizeBytes)}%</p>}
      {item.delivery && <a href={item.delivery.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium underline">Open on YouTube <ExternalLink className="size-4" /></a>}
      {review && <div className="space-y-3 border-t border-[var(--vh-border)] pt-4">
        <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1.5 size-4 shrink-0" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending || !canApprove || !previewReady} /><span>I reviewed this video, channel, visibility and details. Upload this revision to YouTube.</span></label>
        {!canApprove && <p className="text-sm text-[var(--vh-text-2)]">A configured, connected channel is required before approval.</p>}
        <Button size="lg" disabled={pending || !canApprove || !confirmed || !previewReady} onClick={() => void change(item.actions.resume ? { action: 'resume', ...selected, confirmed: true } : { action: 'approve', ...selected, expectedDigest: item.digest, confirmed: true })}>{item.actions.resume ? 'Continue original upload' : 'Approve upload'}</Button>
      </div>}
      <div className="flex flex-wrap gap-2">
        {item.actions.revise && <Button variant="outline" disabled={pending} onClick={edit}>Edit draft</Button>}
        {item.actions.reconcile && <Button variant="outline" disabled={pending} onClick={() => void change({ action: 'reconcile', ...selected })}>Check original upload</Button>}
        {item.actions.stop && <Button variant="ghost" disabled={pending} onClick={() => void change({ action: 'stop', ...selected })}>{item.state === 'draft' || item.state === 'approved' ? 'Cancel delivery' : 'Stop local delivery'}</Button>}
      </div>
      <p className="text-xs text-[var(--vh-text-2)]">Last recorded: {new Date(item.updatedAt).toLocaleString()}. Stopping does not delete a video or cancel a schedule on YouTube.</p>
    </div>
  </article>;
}
