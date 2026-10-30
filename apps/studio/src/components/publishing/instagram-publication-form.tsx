import { m as uiMessages } from '@/paraglide/messages.js';
import { useRef, useState } from 'react';
import { Link } from '@/core/i18n/navigation';
import { Input } from '@/components/ui/input';
import { localPublicationDate } from './publication-time';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { publicationRequest, type PublicationRequest } from '@/core/publishing/requests';
import type { PublicationView } from '@/core/publishing/public-view';
import type { InstagramAccount } from '@/core/publishing/instagram-accounts-contract';
import type { PublicationVideo } from './use-publications';

export function InstagramPublicationForm({ projectId, accounts, videos, pending, editing, change, done }: {
  projectId: string; accounts: InstagramAccount[]; videos: PublicationVideo[]; pending: boolean; editing?: PublicationView;
  change: (request: PublicationRequest) => Promise<boolean>; done: () => void;
}) {
  const original = editing?.instagramMetadata;
  const [accountId, setAccount] = useState(editing?.accountId ?? ''), [assetId, setAsset] = useState(editing?.asset?.assetId ?? '');
  const [kind, setKind] = useState<'reel' | 'story'>(original?.kind ?? 'reel');
  const [schedule, setSchedule] = useState(localPublicationDate(original?.publishAt));
  const [caption, setCaption] = useState(original?.kind === 'reel' ? original.caption : '');
  const [synthetic, setSynthetic] = useState(original ? String(original.isAiGenerated) : '');
  const [error, setError] = useState<string | null>(null), identity = useRef({ body: '', key: '' });
  const available = accounts.filter(account => account.status === 'connected'), media = videos.filter(video => video.mimeType === 'video/mp4');
  const selected = available.find(account => account.id === accountId);
  async function submit() {
    setError(null);
    if (!synthetic) { setError(uiMessages["ui.publishing.choose_the_ai_disclosure_before_saving"]()); return; }
    if (schedule && (!Number.isFinite(Date.parse(schedule)) || Date.parse(schedule) <= Date.now())) { setError(uiMessages["ui.publishing.choose_a_future_scheduled_publication_time"]()); return; }
    const fields = { connector: 'instagram', accountId, assetId, metadata: { kind, isAiGenerated: synthetic === 'true', ...(schedule ? { publishAt: new Date(schedule).toISOString() } : {}), ...(kind === 'reel' ? { caption } : {}) } };
    const body = JSON.stringify(fields);
    if (identity.current.body !== body) identity.current = { body, key: crypto.randomUUID() };
    const parsed = publicationRequest.safeParse(editing ? { ...fields, action: 'revise', publicationId: editing.id, expectedRevision: editing.revision } : { ...fields, action: 'create', requestKey: identity.current.key });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? uiMessages["ui.publishing.review_the_draft_fields"]()); return; }
    if (await change(parsed.data)) done();
  }
  return <section aria-labelledby="publication-form-heading" className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-6">
    <h2 id="publication-form-heading" className="text-lg font-semibold">{editing ? uiMessages["ui.publishing.edit_instagram_draft"]() : uiMessages["ui.publishing.prepare_an_instagram_video"]()}</h2>
    <p className="mt-1 text-sm leading-6 text-[var(--vh-text-2)]">{uiMessages["ui.publishing.review_your_retained_video_then_approve_upload_and_publication_to_instagram"]()}</p>
    {!available.length && <p className="mt-4 rounded-xl bg-[var(--vh-control)] p-3 text-sm">{uiMessages["ui.publishing.connect_a_professional_instagram_account_in"]()} <Link href="/connections" className="underline">{uiMessages["ui.app.connections"]()}</Link> {uiMessages["ui.publishing.to_prepare_a_draft"]()}</p>}
    {!media.length && <p className="mt-3 text-sm">{uiMessages["ui.publishing.add_an_mp4_in"]()} <Link href={`/assets/${projectId}`} className="underline">{uiMessages["ui.publishing.assets"]()}</Link>{uiMessages["ui.publishing.or_export_your_timeline_in"]()} <Link href={`/editor/${projectId}`} className="underline">{uiMessages["ui.publishing.editor"]()}</Link>{uiMessages["ui.publishing.open_editor_end"]()}</p>}
    <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.instagram_account"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.instagram_account"]()} value={accountId} onChange={event => setAccount(event.target.value)} required><option value="">{uiMessages["ui.publishing.choose_an_account"]()}</option>{available.map(account => <option key={account.id} value={account.id}>@{account.username} · {account.pageName}</option>)}</NativeSelect></label>
        {selected && <p className="break-all text-xs leading-5 text-[var(--vh-text-2)]">{uiMessages["ui.publishing.instagram_id"]()} {selected.instagramId}<br />{uiMessages["ui.publishing.page_id"]()} {selected.pageId}</p>}
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.format"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.instagram_format"]()} value={kind} onChange={event => setKind(event.target.value as 'reel' | 'story')}><option value="reel">{uiMessages["ui.publishing.reel"]()}</option><option value="story">{uiMessages["ui.publishing.story"]()}</option></NativeSelect></label>
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.project_video"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.project_video"]()} value={assetId} onChange={event => setAsset(event.target.value)} required><option value="">{uiMessages["ui.publishing.choose_an_mp4"]()}</option>{media.map(video => <option key={video.id} value={video.id}>{video.filename || video.id}</option>)}</NativeSelect></label>
        <p className="text-xs leading-5 text-[var(--vh-text-2)]">{kind === 'story' ? uiMessages["ui.publishing.story_limits"]() : uiMessages["ui.publishing.reel_limits"]()} {uiMessages["ui.publishing.h_264_or_hevc_23_60_fps_portrait_9_16_is_recommended_video_specifications_a"]()}</p>
        {kind === 'reel' && <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.caption"]()}</span><Textarea aria-label={uiMessages["ui.publishing.caption"]()} rows={4} value={caption} onChange={event => setCaption(event.target.value)} maxLength={2200} /><span className="block text-xs font-normal text-[var(--vh-text-2)]">{caption.length}{uiMessages["ui.publishing.2_200_characters"]()}</span></label>}
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.ai_generated_content"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.ai_generated_content"]()} value={synthetic} onChange={event => setSynthetic(event.target.value)} required><option value="">{uiMessages["ui.publishing.choose_disclosure"]()}</option><option value="true">{uiMessages["ui.publishing.yes"]()}</option><option value="false">{uiMessages["ui.publishing.no"]()}</option></NativeSelect></label>
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.scheduled_publication"]()}</span><Input aria-label={uiMessages["ui.publishing.scheduled_publication"]()} type="datetime-local" value={schedule} onChange={event => setSchedule(event.target.value)} /><span className="block text-xs font-normal text-[var(--vh-text-2)]">{uiMessages["ui.publishing.optional"]()} {Intl.DateTimeFormat().resolvedOptions().timeZone}{uiMessages["ui.publishing.leave_empty_to_publish_after_approval_and_processing"]()}</span></label>
        {schedule && <p className="rounded-xl bg-[var(--vh-control)] p-3 text-sm leading-6">{uiMessages["ui.publishing.keep_the_studio_running_upload_preparation_starts_up_to_10_minutes_before_y"]()}</p>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="lg" disabled={pending || !available.length || !media.length}>{pending ? uiMessages["ui.publishing.checking_video"]() : editing ? uiMessages["ui.publishing.save_new_revision"]() : uiMessages["ui.publishing.save_draft"]()}</Button>{editing && <Button type="button" variant="outline" disabled={pending} onClick={done}>{uiMessages["ui.publishing.cancel_edit"]()}</Button>}</div>
    </form>
  </section>;
}
