import { useState } from 'react';
import { TextField } from '@seed-design/react';
import { Link2 } from 'lucide-react';
import type { CatalogHandoff } from '@/core/community/contract';
import { Action } from '@/components/base/action';

export function PackLinkForm({ disabled, fetchLink, shared = {} }: { disabled: boolean; fetchLink: (url: string, expectedSha256?: string) => Promise<void>; shared?: CatalogHandoff }) {
  const [url, setUrl] = useState(shared.source ?? '');
  return <form aria-label="Review a shared creative pack" className="space-y-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5" onSubmit={event => { event.preventDefault(); void fetchLink(url, url.trim() === shared.source ? shared.sha256 : undefined); }}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1 space-y-2"><label htmlFor="creative-pack-link" className="block text-xs font-medium">Add from link</label><TextField.Root className="vh-field"><TextField.Input id="creative-pack-link" aria-label="Creative pack link" type="url" placeholder="https://github.com/…/my.viralhit-pack.tar" value={url} maxLength={2000} disabled={disabled} onChange={event => setUrl(event.target.value)} /></TextField.Root></div>
      <Action type="submit" disabled={disabled || !/^https:\/\/\S+$/.test(url.trim())} className="vh-secondary"><Link2 size={16} />Review link</Action>
    </div>
    <p className="text-xs leading-5 text-[var(--vh-text-2)]">Use a public HTTPS file or GitHub download link, up to 512 MB. Review the recipes, full skill instructions and character images before installing.</p>
  </form>;
}
