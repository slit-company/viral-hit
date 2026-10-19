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

function localDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

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
  const [notify, setNotify] = useState(original?.notifySubscribers ?? false), [schedule, setSchedule] = useState(localDate(original?.publishAt));
  const [error, setError] = useState<string | null>(null);
  const identity = useRef({ body: '', key: '' });
  const available = accounts.filter(account => account.status === 'connected');
  const submit = async () => {
    setError(null);
    if (!kids || !synthetic) { setError('Choose the audience and synthetic content disclosure before saving.'); return; }
    if (schedule && !Number.isFinite(Date.parse(schedule))) { setError('Choose a valid scheduled publication time.'); return; }
    const fields = { connector: 'youtube', accountId, assetId, metadata: { title, description, categoryId: category, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), privacy,
      madeForKids: kids === 'true', containsSyntheticMedia: synthetic === 'true', notifySubscribers: notify, ...(schedule ? { publishAt: new Date(schedule).toISOString() } : {}) } };
    const body = JSON.stringify(fields);
    if (identity.current.body !== body) identity.current = { body, key: crypto.randomUUID() };
    const parsed = publicationRequest.safeParse(editing ? { ...fields, action: 'revise', publicationId: editing.id, expectedRevision: editing.revision } : { ...fields, action: 'create', requestKey: identity.current.key });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Review the draft fields.'); return; }
    if (await change(parsed.data)) done();
  };
  return <section aria-labelledby="publication-form-heading" className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-6">
    <h2 id="publication-form-heading" className="text-lg font-semibold">{editing ? 'Edit draft' : 'Prepare a video'}</h2>
    <p className="mt-1 text-sm leading-6 text-[var(--vh-text-2)]">Save a draft, watch the retained video, then approve delivery.</p>
    {!available.length && <p className="mt-4 rounded-xl bg-[var(--vh-control)] p-3 text-sm">Connect a YouTube channel in <Link href="/connections" className="underline">Connections</Link> to prepare a draft.</p>}
    {!videos.length && <p className="mt-3 text-sm">Add a local MP4 or WebM in <Link href={`/assets/${projectId}`} className="underline">Assets</Link>, or export your timeline in <Link href={`/editor/${projectId}`} className="underline">Editor</Link>.</p>}
    <form className="mt-5 space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
        <label className="block space-y-2 text-sm font-medium"><span>YouTube channel</span><NativeSelect aria-label="YouTube channel" value={accountId} onChange={event => setAccount(event.target.value)} required><option value="">Choose a channel</option>{available.map(account => <option key={account.id} value={account.id}>{account.channelTitle} · {account.channelId}</option>)}</NativeSelect></label>
        <label className="block space-y-2 text-sm font-medium"><span>Project video</span><NativeSelect aria-label="Project video" value={assetId} onChange={event => setAsset(event.target.value)} required><option value="">Choose a video</option>{videos.map(video => <option key={video.id} value={video.id}>{video.filename || video.id}</option>)}</NativeSelect></label>
        <label className="block space-y-2 text-sm font-medium"><span>Video title</span><Input className="h-10" value={title} onChange={event => setTitle(event.target.value)} required maxLength={100} placeholder="A title worth watching" /></label>
        <label className="block space-y-2 text-sm font-medium"><span>Description</span><Textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} maxLength={5000} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2 text-sm font-medium"><span>Visibility</span><NativeSelect aria-label="Visibility" value={privacy} onChange={event => setPrivacy(event.target.value as typeof privacy)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></NativeSelect></label>
          <label className="block space-y-2 text-sm font-medium"><span>Made for kids?</span><NativeSelect aria-label="Made for kids?" value={kids} onChange={event => setKids(event.target.value)} required><option value="">Choose audience</option><option value="false">No</option><option value="true">Yes</option></NativeSelect></label>
        </div>
        <label className="block space-y-2 text-sm font-medium"><span>Realistic altered or synthetic content?</span><NativeSelect aria-label="Realistic altered or synthetic content?" value={synthetic} onChange={event => setSynthetic(event.target.value)} required><option value="">Choose disclosure</option><option value="true">Yes</option><option value="false">No</option></NativeSelect></label>
        <details className="rounded-xl border border-[var(--vh-border)] p-3 text-sm"><summary className="cursor-pointer font-medium">Schedule and details</summary><div className="mt-4 space-y-4">
          <label className="block space-y-2"><span>Scheduled publication</span><Input aria-label="Scheduled publication" type="datetime-local" value={schedule} onChange={event => setSchedule(event.target.value)} /><span className="block text-xs text-[var(--vh-text-2)]">Optional · {Intl.DateTimeFormat().resolvedOptions().timeZone}. Use Private visibility and a future time.</span></label>
          <label className="block space-y-2"><span>Tags, separated by commas</span><Input value={tags} onChange={event => setTags(event.target.value)} /></label>
          <label className="block space-y-2"><span>YouTube category ID</span><Input inputMode="numeric" value={category} onChange={event => setCategory(event.target.value)} required /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={notify} onChange={event => setNotify(event.target.checked)} /> Notify subscribers</label>
        </div></details>
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="lg" disabled={pending || !available.length || !videos.length}>{pending ? 'Saving…' : editing ? 'Save new revision' : 'Save draft'}</Button>{editing && <Button type="button" variant="outline" disabled={pending} onClick={done}>Cancel edit</Button>}</div>
    </form>
  </section>;
}
