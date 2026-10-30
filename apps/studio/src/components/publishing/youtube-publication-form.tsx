import { m as uiMessages } from '@/paraglide/messages.js';
import { useRef, useState } from 'react';
import { Link } from '@/core/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { publicationRequest, type PublicationRequest } from '@/core/publishing/requests';
import type { PublicationView } from '@/core/publishing/public-view';
import type { PublicationAccount } from '@/core/publishing/account-contract';
import type { PublicationVideo } from './use-publications';

import { localPublicationDate } from './publication-time';

export function YouTubePublicationForm({ projectId, accounts, videos, pending, editing, change, done }: {
  projectId: string; accounts: PublicationAccount[]; videos: PublicationVideo[]; pending: boolean; editing?: PublicationView;
  change: (request: PublicationRequest) => Promise<boolean>; done: () => void;
}) {
  const original = editing?.metadata;
  const [accountId, setAccount] = useState(editing?.accountId ?? ''), [assetId, setAsset] = useState(editing?.asset?.assetId ?? '');
  const [title, setTitle] = useState(original?.title ?? ''), [description, setDescription] = useState(original?.description ?? '');
  const [privacy, setPrivacy] = useState(original?.privacy ?? 'private'), [tags, setTags] = useState(original?.tags.join(', ') ?? '');
  const [category, setCategory] = useState(original?.categoryId ?? '22');
  const [kids, setKids] = useState(original ? String(original.madeForKids) : ''), [synthetic, setSynthetic] = useState(original ? String(original.containsSyntheticMedia) : '');
  const [notify, setNotify] = useState(original?.notifySubscribers ?? false), [schedule, setSchedule] = useState(localPublicationDate(original?.publishAt));
  const [error, setError] = useState<string | null>(null);
  const identity = useRef({ body: '', key: '' });
  const available = accounts.filter(account => account.status === 'connected');
  const submit = async () => {
    setError(null);
    if (!kids || !synthetic) { setError(uiMessages["ui.publishing.choose_the_audience_and_synthetic_content_disclosure_before_saving"]()); return; }
    if (schedule && !Number.isFinite(Date.parse(schedule))) { setError(uiMessages["ui.publishing.choose_a_valid_scheduled_publication_time"]()); return; }
    const fields = { connector: 'youtube', accountId, assetId, metadata: { title, description, categoryId: category, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), privacy,
      madeForKids: kids === 'true', containsSyntheticMedia: synthetic === 'true', notifySubscribers: notify, ...(schedule ? { publishAt: new Date(schedule).toISOString() } : {}) } };
    const body = JSON.stringify(fields);
    if (identity.current.body !== body) identity.current = { body, key: crypto.randomUUID() };
    const parsed = publicationRequest.safeParse(editing ? { ...fields, action: 'revise', publicationId: editing.id, expectedRevision: editing.revision } : { ...fields, action: 'create', requestKey: identity.current.key });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? uiMessages["ui.publishing.review_the_draft_fields_2"]()); return; }
    if (await change(parsed.data)) done();
  };
  return <section aria-labelledby="publication-form-heading" className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-6">
    <h2 id="publication-form-heading" className="text-lg font-semibold">{editing ? uiMessages["ui.publishing.edit_draft"]() : uiMessages["ui.publishing.prepare_a_video"]()}</h2>
    <p className="mt-1 text-sm leading-6 text-[var(--vh-text-2)]">{uiMessages["ui.publishing.save_a_draft_watch_the_retained_video_then_approve_delivery"]()}</p>
    {!available.length && <p className="mt-4 rounded-xl bg-[var(--vh-control)] p-3 text-sm">{uiMessages["ui.publishing.connect_a_youtube_channel_in"]()} <Link href="/connections" className="underline">{uiMessages["ui.publishing.connections"]()}</Link> {uiMessages["ui.publishing.to_prepare_a_draft"]()}</p>}
    {!videos.length && <p className="mt-3 text-sm">{uiMessages["ui.publishing.add_a_local_mp4_or_webm_in"]()} <Link href={`/assets/${projectId}`} className="underline">{uiMessages["ui.publishing.assets"]()}</Link>{uiMessages["ui.publishing.or_export_your_timeline_in_2"]()} <Link href={`/editor/${projectId}`} className="underline">{uiMessages["ui.publishing.editor"]()}</Link>{uiMessages["ui.publishing.open_editor_end"]()}</p>}
    <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.youtube_channel"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.youtube_channel"]()} value={accountId} onChange={event => setAccount(event.target.value)} required><option value="">{uiMessages["ui.publishing.choose_a_channel"]()}</option>{available.map(account => <option key={account.id} value={account.id}>{account.channelTitle} · {account.channelId}</option>)}</NativeSelect></label>
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.project_video"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.project_video"]()} value={assetId} onChange={event => setAsset(event.target.value)} required><option value="">{uiMessages["ui.publishing.choose_a_video"]()}</option>{videos.map(video => <option key={video.id} value={video.id}>{video.filename || video.id}</option>)}</NativeSelect></label>
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.video_title"]()}</span><Input className="h-10" value={title} onChange={event => setTitle(event.target.value)} required maxLength={100} placeholder={uiMessages["ui.publishing.a_title_worth_watching"]()} /></label>
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.creative-packs.description"]()}</span><Textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} maxLength={5000} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.visibility"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.visibility"]()} value={privacy} onChange={event => setPrivacy(event.target.value as typeof privacy)}><option value="private">{uiMessages["ui.publishing.private"]()}</option><option value="unlisted">{uiMessages["ui.publishing.unlisted"]()}</option><option value="public">{uiMessages["ui.publishing.public"]()}</option></NativeSelect></label>
          <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.made_for_kids_2"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.made_for_kids_2"]()} value={kids} onChange={event => setKids(event.target.value)} required><option value="">{uiMessages["ui.publishing.choose_audience"]()}</option><option value="false">{uiMessages["ui.publishing.no"]()}</option><option value="true">{uiMessages["ui.publishing.yes"]()}</option></NativeSelect></label>
        </div>
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.realistic_altered_or_synthetic_content"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.realistic_altered_or_synthetic_content"]()} value={synthetic} onChange={event => setSynthetic(event.target.value)} required><option value="">{uiMessages["ui.publishing.choose_disclosure_2"]()}</option><option value="true">{uiMessages["ui.publishing.yes"]()}</option><option value="false">{uiMessages["ui.publishing.no"]()}</option></NativeSelect></label>
        <details className="rounded-xl border border-[var(--vh-border)] p-3 text-sm"><summary className="cursor-pointer font-medium">{uiMessages["ui.publishing.schedule_and_details"]()}</summary><div className="mt-4 space-y-4">
          <label className="block space-y-2"><span>{uiMessages["ui.publishing.scheduled_publication_2"]()}</span><Input aria-label={uiMessages["ui.publishing.scheduled_publication_2"]()} type="datetime-local" value={schedule} onChange={event => setSchedule(event.target.value)} /><span className="block text-xs text-[var(--vh-text-2)]">{uiMessages["ui.publishing.optional_2"]()} {Intl.DateTimeFormat().resolvedOptions().timeZone}{uiMessages["ui.publishing.use_private_visibility_and_a_future_time"]()}</span></label>
          <label className="block space-y-2"><span>{uiMessages["ui.publishing.tags_separated_by_commas"]()}</span><Input value={tags} onChange={event => setTags(event.target.value)} /></label>
          <label className="block space-y-2"><span>{uiMessages["ui.publishing.youtube_category_id"]()}</span><Input inputMode="numeric" value={category} onChange={event => setCategory(event.target.value)} required /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={notify} onChange={event => setNotify(event.target.checked)} /> {uiMessages["ui.publishing.notify_subscribers"]()}</label>
        </div></details>
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="lg" disabled={pending || !available.length || !videos.length}>{pending ? uiMessages["ui.common.saving"]() : editing ? uiMessages["ui.publishing.save_new_revision_2"]() : uiMessages["ui.publishing.save_draft"]()}</Button>{editing && <Button type="button" variant="outline" disabled={pending} onClick={done}>{uiMessages["ui.publishing.cancel_edit"]()}</Button>}</div>
    </form>
  </section>;
}
