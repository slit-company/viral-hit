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
import type { InstagramFrame, InstagramKind } from '@/core/publishing/instagram-contract';
import { InstagramCarouselPicker } from './instagram-carousel-picker';
import { instagramKindLabel, instagramKinds, isMp4, isPublishableImage } from './instagram-labels';
import type { PublicationVideo } from './use-publications';

const muted = 'text-xs leading-5 text-[var(--vh-text-2)]';
function initialAltTexts(editing?: PublicationView) {
  const metadata = editing?.instagramMetadata, ids = editing?.assets.map(asset => asset.assetId) ?? [];
  if (metadata?.kind === 'image' && metadata.altText && ids[0]) return { [ids[0]]: metadata.altText };
  if (metadata?.kind === 'carousel') return Object.fromEntries(ids.map((id, index) => [id, metadata.altTexts?.[index] ?? '']));
  return {};
}

export function InstagramPublicationForm({ projectId, accounts, mediaAssets, imageHosting, pending, editing, change, done }: {
  projectId: string; accounts: InstagramAccount[]; mediaAssets: PublicationVideo[]; imageHosting: boolean; pending: boolean; editing?: PublicationView;
  change: (request: PublicationRequest) => Promise<boolean>; done: () => void;
}) {
  const original = editing?.instagramMetadata;
  const [accountId, setAccount] = useState(editing?.accountId ?? ''), [kind, setKind] = useState<InstagramKind>(original?.kind ?? 'reel');
  const [items, setItems] = useState<string[]>(editing?.assets.map(asset => asset.assetId) ?? []), [altTexts, setAltTexts] = useState<Record<string, string>>(() => initialAltTexts(editing));
  const [frame, setFrame] = useState<InstagramFrame>(original && 'frame' in original && original.frame ? original.frame : original?.kind === 'story' ? 'fit' : 'fill'), frameChosen = useRef(Boolean(original && 'frame' in original && original.frame));
  const [schedule, setSchedule] = useState(localPublicationDate(original?.publishAt));
  const [caption, setCaption] = useState(original && 'caption' in original ? original.caption : '');
  const [synthetic, setSynthetic] = useState(original ? String(original.isAiGenerated) : '');
  const [error, setError] = useState<string | null>(null), identity = useRef({ body: '', key: '' });
  const available = accounts.filter(account => account.status === 'connected'), selectedAccount = available.find(account => account.id === accountId);
  const eligible = mediaAssets.filter(item => kind === 'reel' ? isMp4(item) : kind === 'image' ? isPublishableImage(item) : isPublishableImage(item) || isMp4(item));
  const chosen = kind === 'carousel' ? items.filter(id => eligible.some(item => item.id === id)) : items.slice(0, 1).filter(id => eligible.some(item => item.id === id));
  const hasImage = chosen.some(id => isPublishableImage(mediaAssets.find(item => item.id === id))) || kind === 'image';
  function chooseKind(next: InstagramKind) { setKind(next); if (!frameChosen.current) setFrame(next === 'story' ? 'fit' : 'fill'); }
  async function submit() {
    setError(null);
    if (!synthetic) { setError(uiMessages["ui.publishing.choose_the_ai_disclosure_before_saving"]()); return; }
    if (schedule && (!Number.isFinite(Date.parse(schedule)) || Date.parse(schedule) <= Date.now())) { setError(uiMessages["ui.publishing.choose_a_future_scheduled_publication_time"]()); return; }
    if (kind === 'carousel' && (chosen.length < 2 || chosen.length > 20)) { setError(uiMessages["ui.publishing.carousel_limits"]()); return; }
    const alt = chosen.map(id => altTexts[id]?.trim() ?? '');
    const metadata = { kind, isAiGenerated: synthetic === 'true', ...(schedule ? { publishAt: new Date(schedule).toISOString() } : {}), ...(kind !== 'story' ? { caption } : {}),
      ...(hasImage && kind !== 'reel' ? { frame } : {}), ...(kind === 'image' && alt[0] ? { altText: alt[0] } : {}), ...(kind === 'carousel' && alt.some(Boolean) ? { altTexts: alt } : {}) };
    const fields = { connector: 'instagram', accountId, ...(kind === 'carousel' ? { assetIds: chosen } : { assetId: chosen[0] ?? '' }), metadata };
    const body = JSON.stringify(fields);
    if (identity.current.body !== body) identity.current = { body, key: crypto.randomUUID() };
    const parsed = publicationRequest.safeParse(editing ? { ...fields, action: 'revise', publicationId: editing.id, expectedRevision: editing.revision } : { ...fields, action: 'create', requestKey: identity.current.key });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? uiMessages["ui.publishing.review_the_draft_fields"]()); return; }
    if (await change(parsed.data)) done();
  }
  const limits = kind === 'reel' ? `${uiMessages["ui.publishing.reel_limits"]()} ${uiMessages["ui.publishing.h_264_or_hevc_23_60_fps_portrait_9_16_is_recommended_video_specifications_a"]()}`
    : kind === 'story' ? uiMessages["ui.publishing.story_image_limits"]() : kind === 'image' ? uiMessages["ui.publishing.image_post_limits"]() : uiMessages["ui.publishing.carousel_limits"]();
  return <section aria-labelledby="publication-form-heading" className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-6">
    <h2 id="publication-form-heading" className="text-lg font-semibold">{editing ? uiMessages["ui.publishing.edit_instagram_draft"]() : uiMessages["ui.publishing.prepare_for_instagram"]()}</h2>
    <p className="mt-1 text-sm leading-6 text-[var(--vh-text-2)]">{uiMessages["ui.publishing.instagram_form_intro"]()}</p>
    {!available.length && <p className="mt-4 rounded-xl bg-[var(--vh-control)] p-3 text-sm">{uiMessages["ui.publishing.connect_a_professional_instagram_account_in"]()} <Link href="/connections" className="underline">{uiMessages["ui.app.connections"]()}</Link> {uiMessages["ui.publishing.to_prepare_a_draft"]()}</p>}
    {!eligible.length && (kind === 'reel'
      ? <p className="mt-3 text-sm">{uiMessages["ui.publishing.add_an_mp4_in"]()} <Link href={`/assets/${projectId}`} className="underline">{uiMessages["ui.publishing.assets"]()}</Link>{uiMessages["ui.publishing.or_export_your_timeline_in"]()} <Link href={`/editor/${projectId}`} className="underline">{uiMessages["ui.publishing.editor"]()}</Link>{uiMessages["ui.publishing.open_editor_end"]()}</p>
      : <p className="mt-3 text-sm">{uiMessages["ui.publishing.no_matching_media"]()} <Link href={`/assets/${projectId}`} className="underline">{uiMessages["ui.publishing.assets"]()}</Link></p>)}
    <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.instagram_account"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.instagram_account"]()} value={accountId} onChange={event => setAccount(event.target.value)} required><option value="">{uiMessages["ui.publishing.choose_an_account"]()}</option>{available.map(account => <option key={account.id} value={account.id}>@{account.username} · {account.pageName}</option>)}</NativeSelect></label>
        {selectedAccount && <p className={`break-all ${muted}`}>{uiMessages["ui.publishing.instagram_id"]()} {selectedAccount.instagramId}<br />{uiMessages["ui.publishing.page_id"]()} {selectedAccount.pageId}</p>}
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.format"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.instagram_format"]()} value={kind} onChange={event => chooseKind(event.target.value as InstagramKind)}>{instagramKinds.map(value => <option key={value} value={value}>{instagramKindLabel(value)}</option>)}</NativeSelect></label>
        {kind === 'carousel'
          ? <InstagramCarouselPicker media={eligible} items={chosen} altTexts={altTexts} onItems={setItems} onAlt={(id, text) => setAltTexts(previous => ({ ...previous, [id]: text }))} />
          : <label className="block space-y-2 text-sm font-medium"><span>{kind === 'reel' ? uiMessages["ui.publishing.project_video"]() : uiMessages["ui.publishing.project_media"]()}</span><NativeSelect aria-label={kind === 'reel' ? uiMessages["ui.publishing.project_video"]() : uiMessages["ui.publishing.project_media"]()} value={chosen[0] ?? ''} onChange={event => setItems(event.target.value ? [event.target.value] : [])} required><option value="">{kind === 'reel' ? uiMessages["ui.publishing.choose_an_mp4"]() : uiMessages["ui.publishing.choose_media"]()}</option>{eligible.map(item => <option key={item.id} value={item.id}>{item.filename || item.id}</option>)}</NativeSelect></label>}
        <p className={muted}>{limits}</p>
        {hasImage && kind !== 'reel' && <>
          <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.image_framing"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.image_framing"]()} value={frame} onChange={event => { frameChosen.current = true; setFrame(event.target.value as InstagramFrame); }}><option value="fill">{uiMessages["ui.publishing.frame_fill"]()}</option><option value="fit">{uiMessages["ui.publishing.frame_fit"]()}</option></NativeSelect></label>
          <p role={imageHosting ? undefined : 'status'} className={imageHosting ? muted : 'rounded-xl bg-[var(--vh-control)] p-3 text-sm leading-6'}>{imageHosting ? uiMessages["ui.publishing.image_storage_copy"]() : uiMessages["ui.publishing.image_storage_required"]()}</p>
        </>}
        {kind !== 'story' && <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.caption"]()}</span><Textarea aria-label={uiMessages["ui.publishing.caption"]()} rows={4} value={caption} onChange={event => setCaption(event.target.value)} maxLength={2200} /><span className="block text-xs font-normal text-[var(--vh-text-2)]">{caption.length}{uiMessages["ui.publishing.2_200_characters"]()}</span></label>}
        {kind === 'image' && chosen[0] && <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.alt_text"]()}</span><Input aria-label={uiMessages["ui.publishing.alt_text"]()} maxLength={1000} value={altTexts[chosen[0]] ?? ''} onChange={event => setAltTexts(previous => ({ ...previous, [chosen[0]]: event.target.value }))} /></label>}
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.ai_generated_content"]()}</span><NativeSelect aria-label={uiMessages["ui.publishing.ai_generated_content"]()} value={synthetic} onChange={event => setSynthetic(event.target.value)} required><option value="">{uiMessages["ui.publishing.choose_disclosure"]()}</option><option value="true">{uiMessages["ui.publishing.yes"]()}</option><option value="false">{uiMessages["ui.publishing.no"]()}</option></NativeSelect></label>
        <label className="block space-y-2 text-sm font-medium"><span>{uiMessages["ui.publishing.scheduled_publication"]()}</span><Input aria-label={uiMessages["ui.publishing.scheduled_publication"]()} type="datetime-local" value={schedule} onChange={event => setSchedule(event.target.value)} /><span className="block text-xs font-normal text-[var(--vh-text-2)]">{uiMessages["ui.publishing.optional"]()} {Intl.DateTimeFormat().resolvedOptions().timeZone}{uiMessages["ui.publishing.leave_empty_to_publish_after_approval_and_processing"]()}</span></label>
        {schedule && <p className="rounded-xl bg-[var(--vh-control)] p-3 text-sm leading-6">{uiMessages["ui.publishing.keep_the_studio_running_upload_preparation_starts_up_to_10_minutes_before_y"]()}</p>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="lg" disabled={pending || !available.length || !eligible.length}>{pending ? uiMessages["ui.publishing.checking_video"]() : editing ? uiMessages["ui.publishing.save_new_revision"]() : uiMessages["ui.publishing.save_draft"]()}</Button>{editing && <Button type="button" variant="outline" disabled={pending} onClick={done}>{uiMessages["ui.publishing.cancel_edit"]()}</Button>}</div>
    </form>
  </section>;
}
