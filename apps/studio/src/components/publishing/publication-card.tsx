import { m as uiMessages } from '@/paraglide/messages.js';
import { InstalledPublicationCard } from './installed-publication-card';
import { useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PublicationView } from '@/core/publishing/public-view';
import type { PublicationRequest } from '@/core/publishing/requests';

const labels: Record<PublicationView['state'], string> = { get draft() { return uiMessages["ui.publishing.draft"](); }, get approved() { return uiMessages["ui.publishing.queued_for_upload"](); }, get starting() { return uiMessages["ui.publishing.creating_upload_session"](); }, get uploading() { return uiMessages["ui.publishing.uploading"](); }, get accepted() { return uiMessages["ui.publishing.video_received"](); }, get staged() { return uiMessages["ui.publishing.ready_to_publish"](); }, get publishing() { return uiMessages["ui.publishing.publishing_2"](); }, get processing() { return uiMessages["ui.publishing.processing_video"](); }, get ready() { return uiMessages["ui.publishing.ready_on_youtube"](); }, get scheduled() { return uiMessages["ui.publishing.scheduled_on_youtube"](); }, get published() { return uiMessages["ui.publishing.published"](); }, get reconciling() { return uiMessages["ui.publishing.checking_original_upload"](); }, get uncertain() { return uiMessages["ui.publishing.needs_attention"](); }, get failed() { return uiMessages["ui.publishing.delivery_failed"](); }, get canceled() { return uiMessages["ui.publishing.canceled"](); } };
const issues: Record<NonNullable<PublicationView['issue']>, string> = {
  get 'start-unknown'() { return uiMessages["ui.publishing.the_session_response_was_lost_check_your_channel_before_preparing_another_u"](); },
  get 'processing-timeout'() { return uiMessages["ui.publishing.processing_has_not_finished_after_five_checks_check_the_original_upload_to_"](); },
  get 'publish-unknown'() { return uiMessages["ui.publishing.the_final_publication_response_is_unconfirmed_check_the_original_container_"](); },
  get 'upload-unknown'() { return uiMessages["ui.publishing.the_last_response_was_unclear_the_worker_will_check_the_original_remote_ses"](); },
  get 'session-expired'() { return uiMessages["ui.publishing.the_original_upload_session_expired_check_your_channel_before_starting_anot"](); },
  get 'remote-rejected'() { return uiMessages["ui.publishing.the_destination_rejected_this_delivery_review_your_channel_and_video_settin"](); },
  get 'runtime-unavailable'() { return uiMessages["ui.publishing.the_upload_runtime_or_original_channel_is_unavailable_check_connections_app"](); },
  get 'asset-unavailable'() { return uiMessages["ui.publishing.the_retained_video_cannot_be_read_delivery_is_paused_until_the_workspace_op"](); },
  get 'upload-incomplete'() { return uiMessages["ui.publishing.the_original_upload_is_incomplete_review_this_video_to_continue_the_same_se"](); },
  get stopped() { return uiMessages["ui.publishing.local_delivery_stopped_a_request_already_sent_may_still_finish_at_the_desti"](); },
};
function BuiltInPublicationCard({ item, channelTitle, canApprove, pending, change, edit }: {
  item: PublicationView; channelTitle?: string; canApprove: boolean; pending: boolean;
  change: (request: PublicationRequest) => Promise<boolean>; edit: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [confirmed, setConfirmed] = useState(false), [previewReady, setPreviewReady] = useState(false), [previewFailed, setPreviewFailed] = useState(false);
  const selected = { publicationId: item.id, expectedRevision: item.revision }, metadata = item.metadata;
  const instagram = item.instagramMetadata, platform = item.connector === 'instagram' ? 'Instagram' : 'YouTube';
  const title = metadata?.title ?? (instagram ? `Instagram ${instagram.kind === 'reel' ? uiMessages["ui.publishing.reel"]() : uiMessages["ui.publishing.story"]()}` : uiMessages["ui.publishing.unsupported_publication_version"]());
  const instagramScheduled = Boolean(instagram?.publishAt);
  const futureInstagram = instagram?.publishAt && Date.parse(instagram.publishAt) > Date.now();
  const stateLabel = futureInstagram && item.state === 'approved' ? uiMessages["ui.publishing.scheduled_in_studio"]() : futureInstagram && item.state === 'staged' ? uiMessages["ui.publishing.waiting_for_scheduled_time"]() : labels[item.state];
  const review = item.actions.approve || item.actions.resume;
  return <article aria-label={uiMessages["ui.publishing.named_publication"]({ title })} className="overflow-hidden rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)]">
    <div className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="min-w-0 flex-1 break-words text-lg font-semibold [overflow-wrap:anywhere]">{title}</h3><span className="rounded-full bg-[var(--vh-control)] px-3 py-1 text-xs font-medium">{stateLabel}</span></div>
      <div className="space-y-1"><p className="break-words text-sm font-medium">{channelTitle ?? uiMessages["ui.publishing.platform_account"]({ platform })}</p><p className="break-all text-xs text-[var(--vh-text-2)]">{item.destinationId}</p></div>
      {review && item.asset && <div className="space-y-2"><video ref={video} aria-label={uiMessages["ui.publishing.retained_video_title"]({ title })} controls preload="metadata" playsInline className="aspect-video w-full rounded-xl bg-black object-contain" src={`/api/app/projects/${item.projectId}/publications/${item.id}/media?digest=${item.digest}`} onLoadedMetadata={() => { setPreviewReady(true); setPreviewFailed(false); }} onError={() => { setConfirmed(false); setPreviewReady(false); setPreviewFailed(true); }} /><p className="text-xs text-[var(--vh-text-2)]">{previewFailed ? uiMessages["ui.publishing.retained_preview_unavailable_retry_before_approving"]() : uiMessages["ui.publishing.retained_video_the_exact_file_prepared_for_delivery"]()}</p>{previewFailed && <Button variant="outline" onClick={() => { setConfirmed(false); setPreviewReady(false); setPreviewFailed(false); video.current?.load(); }}>{uiMessages["ui.publishing.retry_preview"]()}</Button>}</div>}
      {metadata && <>
        {metadata.description && <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{metadata.description}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div><dt className="text-[var(--vh-text-2)]">{uiMessages["ui.publishing.visibility"]()}</dt><dd className="mt-1 font-medium capitalize">{metadata.privacy}</dd></div>
          <div><dt className="text-[var(--vh-text-2)]">{uiMessages["ui.publishing.made_for_kids"]()}</dt><dd className="mt-1 font-medium">{metadata.madeForKids ? uiMessages["ui.publishing.yes"]() : uiMessages["ui.publishing.no"]()}</dd></div>
          <div><dt className="text-[var(--vh-text-2)]">{uiMessages["ui.publishing.synthetic_content"]()}</dt><dd className="mt-1 font-medium">{metadata.containsSyntheticMedia ? uiMessages["ui.publishing.yes"]() : uiMessages["ui.publishing.no"]()}</dd></div>
          <div><dt className="text-[var(--vh-text-2)]">{uiMessages["ui.publishing.notify_subscribers"]()}</dt><dd className="mt-1 font-medium">{metadata.notifySubscribers ? uiMessages["ui.publishing.yes"]() : uiMessages["ui.publishing.no"]()}</dd></div>
        </dl>
        {metadata.publishAt && <p className="text-sm">{uiMessages["ui.publishing.scheduled"]()} <time dateTime={metadata.publishAt}>{new Date(metadata.publishAt).toLocaleString()}</time></p>}
        <details className="text-xs text-[var(--vh-text-2)]"><summary className="cursor-pointer">{uiMessages["ui.publishing.video_details_revision"]()} {item.revision}</summary><div className="mt-2 space-y-2 break-all"><p>{uiMessages["ui.publishing.category"]()} {metadata.categoryId} {uiMessages["ui.publishing.tags"]()} {metadata.tags.join(', ') || uiMessages["ui.publishing.none"]()}</p><p>{uiMessages["ui.publishing.file"]()} {item.asset?.sizeBytes.toLocaleString()} {uiMessages["ui.publishing.bytes"]()} {item.asset?.contentType}</p><p>SHA-256: {item.asset?.sha256}</p></div></details>
      </>}
      {instagram && <>
        {instagram.kind === 'reel' && instagram.caption && <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{instagram.caption}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><dt className="text-[var(--vh-text-2)]">{uiMessages["ui.publishing.format"]()}</dt><dd className="mt-1 font-medium capitalize">{instagram.kind}</dd></div><div><dt className="text-[var(--vh-text-2)]">{uiMessages["ui.publishing.ai_disclosure"]()}</dt><dd className="mt-1 font-medium">{instagram.isAiGenerated ? uiMessages["ui.publishing.yes"]() : uiMessages["ui.publishing.no"]()}</dd></div></dl>
        {instagram.publishAt ? <div className="space-y-1 text-sm"><p>{uiMessages["ui.publishing.scheduled_for"]()} <time dateTime={instagram.publishAt}>{new Date(instagram.publishAt).toLocaleString()}</time> · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p><p className="text-xs leading-5 text-[var(--vh-text-2)]">{uiMessages["ui.publishing.studio_must_be_running_processing_or_downtime_may_delay_publication_it_will"]()}</p></div> : <p className="text-sm">{uiMessages["ui.publishing.publishes_after_approval_and_processing"]()}</p>}
        <details className="text-xs text-[var(--vh-text-2)]"><summary className="cursor-pointer">{uiMessages["ui.publishing.video_details_revision"]()} {item.revision}</summary><div className="mt-2 space-y-2 break-all"><p>{uiMessages["ui.publishing.file"]()} {item.asset?.sizeBytes.toLocaleString()} {uiMessages["ui.publishing.bytes"]()} {item.asset?.contentType}</p><p>SHA-256: {item.asset?.sha256}</p></div></details>
      </>}
      {item.instagramDelivery && <p className="break-all text-xs leading-5 text-[var(--vh-text-2)]">{uiMessages["ui.publishing.instagram_container"]()} {item.instagramDelivery.containerId} · {item.instagramDelivery.status}{item.instagramDelivery.mediaId ? uiMessages["ui.publishing.media_id"]({ id: item.instagramDelivery.mediaId }) : ''}</p>}
      {item.issue && <p role="status" className="rounded-xl bg-[var(--vh-control)] p-3 text-sm leading-6">{issues[item.issue]}</p>}
      {item.bytesAccepted !== null && item.asset && <p className="text-xs text-[var(--vh-text-2)]">{uiMessages["ui.publishing.transferred"]()} {Math.floor(100 * item.bytesAccepted / item.asset.sizeBytes)}%</p>}
      {item.delivery && <a href={item.delivery.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium underline">{uiMessages["ui.publishing.open_on_youtube"]()} <ExternalLink className="size-4" /></a>}
      {review && <div className="space-y-3 border-t border-[var(--vh-border)] pt-4">
        <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1.5 size-4 shrink-0" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending || !canApprove || !previewReady} /><span>{instagram ? instagramScheduled ? uiMessages["ui.publishing.i_reviewed_this_video_instagram_account_format_ai_disclosure_and_scheduled_"]() : uiMessages["ui.publishing.i_reviewed_this_video_instagram_account_format_and_ai_disclosure_upload_and"]() : uiMessages["ui.publishing.i_reviewed_this_video_channel_visibility_and_details_upload_this_revision_t"]()}</span></label>
        {!canApprove && <p className="text-sm text-[var(--vh-text-2)]">{uiMessages["ui.publishing.a_configured_connected_channel_is_required_before_approval"]()}</p>}
        <Button size="lg" disabled={pending || !canApprove || !confirmed || !previewReady} onClick={() => void change(item.actions.resume ? { action: 'resume', ...selected, confirmed: true } : { action: 'approve', ...selected, expectedDigest: item.digest, confirmed: true })}>{item.actions.resume ? uiMessages["ui.publishing.continue_original_upload"]() : instagram ? instagramScheduled ? uiMessages["ui.publishing.approve_schedule"]() : uiMessages["ui.publishing.approve_publish"]() : uiMessages["ui.publishing.approve_upload"]()}</Button>
      </div>}
      <div className="flex flex-wrap gap-2">
        {item.actions.revise && <Button variant="outline" disabled={pending} onClick={edit}>{uiMessages["ui.publishing.edit_draft"]()}</Button>}
        {item.actions.reconcile && <Button variant="outline" disabled={pending} onClick={() => void change({ action: 'reconcile', ...selected })}>{uiMessages["ui.publishing.check_original_upload"]()}</Button>}
        {item.actions.stop && <Button variant="ghost" disabled={pending} onClick={() => void change({ action: 'stop', ...selected })}>{item.state === 'draft' || item.state === 'approved' ? uiMessages["ui.publishing.cancel_delivery"]() : uiMessages["ui.publishing.stop_local_delivery"]()}</Button>}
      </div>
      <p className="text-xs text-[var(--vh-text-2)]">{uiMessages["ui.publishing.last_recorded"]()} {new Date(item.updatedAt).toLocaleString()}{uiMessages["ui.publishing.stopping_does_not_delete_remote_posts_or_cancel_remote_schedules"]()}</p>
    </div>
  </article>;
}

export function PublicationCard(props: Parameters<typeof BuiltInPublicationCard>[0]) {
  return props.item.external ? <InstalledPublicationCard {...props} /> : <BuiltInPublicationCard {...props} />;
}
