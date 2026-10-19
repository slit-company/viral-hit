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
    if (!synthetic) { setError('Choose the AI disclosure before saving.'); return; }
    if (schedule && (!Number.isFinite(Date.parse(schedule)) || Date.parse(schedule) <= Date.now())) { setError('Choose a future scheduled publication time.'); return; }
    const fields = { connector: 'instagram', accountId, assetId, metadata: { kind, isAiGenerated: synthetic === 'true', ...(schedule ? { publishAt: new Date(schedule).toISOString() } : {}), ...(kind === 'reel' ? { caption } : {}) } };
    const body = JSON.stringify(fields);
    if (identity.current.body !== body) identity.current = { body, key: crypto.randomUUID() };
    const parsed = publicationRequest.safeParse(editing ? { ...fields, action: 'revise', publicationId: editing.id, expectedRevision: editing.revision } : { ...fields, action: 'create', requestKey: identity.current.key });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Review the draft fields.'); return; }
    if (await change(parsed.data)) done();
  }
  return <section aria-labelledby="publication-form-heading" className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-6">
    <h2 id="publication-form-heading" className="text-lg font-semibold">{editing ? 'Edit Instagram draft' : 'Prepare an Instagram video'}</h2>
    <p className="mt-1 text-sm leading-6 text-[var(--vh-text-2)]">Review your retained video, then approve upload and publication to Instagram.</p>
    {!available.length && <p className="mt-4 rounded-xl bg-[var(--vh-control)] p-3 text-sm">Connect a professional Instagram account in <Link href="/connections" className="underline">Connections</Link> to prepare a draft.</p>}
    {!media.length && <p className="mt-3 text-sm">Add an MP4 in <Link href={`/assets/${projectId}`} className="underline">Assets</Link>, or export your timeline in <Link href={`/editor/${projectId}`} className="underline">Editor</Link>.</p>}
    <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
        <label className="block space-y-2 text-sm font-medium"><span>Instagram account</span><NativeSelect aria-label="Instagram account" value={accountId} onChange={event => setAccount(event.target.value)} required><option value="">Choose an account</option>{available.map(account => <option key={account.id} value={account.id}>@{account.username} · {account.pageName}</option>)}</NativeSelect></label>
        {selected && <p className="break-all text-xs leading-5 text-[var(--vh-text-2)]">Instagram ID {selected.instagramId}<br />Page ID {selected.pageId}</p>}
        <label className="block space-y-2 text-sm font-medium"><span>Format</span><NativeSelect aria-label="Instagram format" value={kind} onChange={event => setKind(event.target.value as 'reel' | 'story')}><option value="reel">Reel</option><option value="story">Story</option></NativeSelect></label>
        <label className="block space-y-2 text-sm font-medium"><span>Project video</span><NativeSelect aria-label="Project video" value={assetId} onChange={event => setAsset(event.target.value)} required><option value="">Choose an MP4</option>{media.map(video => <option key={video.id} value={video.id}>{video.filename || video.id}</option>)}</NativeSelect></label>
        <p className="text-xs leading-5 text-[var(--vh-text-2)]">{kind === 'story' ? '3–60 seconds · up to 100 MB' : '3 seconds–15 minutes · up to 300 MB'} · H.264 or HEVC · 23–60 FPS. Portrait 9:16 is recommended. Video specifications are checked when you save.</p>
        {kind === 'reel' && <label className="block space-y-2 text-sm font-medium"><span>Caption</span><Textarea aria-label="Caption" rows={4} value={caption} onChange={event => setCaption(event.target.value)} maxLength={2200} /><span className="block text-xs font-normal text-[var(--vh-text-2)]">{caption.length}/2,200 characters</span></label>}
        <label className="block space-y-2 text-sm font-medium"><span>AI-generated content?</span><NativeSelect aria-label="AI-generated content?" value={synthetic} onChange={event => setSynthetic(event.target.value)} required><option value="">Choose disclosure</option><option value="true">Yes</option><option value="false">No</option></NativeSelect></label>
        <label className="block space-y-2 text-sm font-medium"><span>Scheduled publication</span><Input aria-label="Scheduled publication" type="datetime-local" value={schedule} onChange={event => setSchedule(event.target.value)} /><span className="block text-xs font-normal text-[var(--vh-text-2)]">Optional · {Intl.DateTimeFormat().resolvedOptions().timeZone}. Leave empty to publish after approval and processing.</span></label>
        {schedule && <p className="rounded-xl bg-[var(--vh-control)] p-3 text-sm leading-6">Keep the studio running. Upload preparation starts up to 10 minutes before your chosen time. Publishes at or after that time; processing or downtime can delay delivery. You can edit the schedule until uploading starts.</p>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="lg" disabled={pending || !available.length || !media.length}>{pending ? 'Checking video…' : editing ? 'Save new revision' : 'Save draft'}</Button>{editing && <Button type="button" variant="outline" disabled={pending} onClick={done}>Cancel edit</Button>}</div>
    </form>
  </section>;
}
