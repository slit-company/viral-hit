import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { Link } from '@/core/i18n/navigation';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import type { InstagramInbox } from './use-instagram-inbox';

function status(inbox?: InstagramInbox) {
  const check = inbox?.check;
  if (check?.requestedAt) return uiMessages["ui.inbox.check_queued"]();
  if (!check?.outcome || !check.checkedAt) return uiMessages["ui.inbox.not_checked"]();
  if (check.outcome === 'ok') return uiMessages["ui.inbox.last_checked"]({ time: new Date(check.checkedAt).toLocaleString(), count: check.imported }) + (check.failed ? ' ' + uiMessages["ui.inbox.failed"]({ count: check.failed }) : '');
  return check.outcome === 'permission-missing' ? uiMessages["ui.inbox.permission_missing"]() : check.outcome === 'reconnect' ? uiMessages["ui.inbox.reconnect"]()
    : check.outcome === 'no-project' ? uiMessages["ui.inbox.no_project"]() : uiMessages["ui.inbox.unavailable"]();
}

/** Where DM videos for one account go, and whether they are collected automatically. */
export function InstagramInboxPanel({ accountId, inbox, projects, pending, change }: {
  accountId: string; inbox?: InstagramInbox; projects: { id: string; name: string }[]; pending: boolean; change: (request: Record<string, unknown>) => Promise<boolean>;
}) {
  const saved = inbox?.settings ?? null;
  const [projectId, setProjectId] = useState(saved?.projectId ?? ''), [enabled, setEnabled] = useState(saved?.enabled ?? true);
  const dirty = !saved || saved.projectId !== projectId || saved.enabled !== enabled;
  return <section aria-label={uiMessages["ui.inbox.title"]()} className="space-y-3 border-t border-[var(--vh-border)] pt-4">
    <div><h4 className="text-sm font-semibold">{uiMessages["ui.inbox.title"]()}</h4><p className="mt-1 text-xs leading-5 text-[var(--vh-text-2)]">{uiMessages["ui.inbox.description"]()}</p></div>
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <NativeSelect aria-label={uiMessages["ui.inbox.project"]()} value={projectId} disabled={pending} onChange={event => setProjectId(event.target.value)}><option value="">{uiMessages["ui.inbox.choose_project"]()}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</NativeSelect>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={enabled} disabled={pending} onChange={event => setEnabled(event.target.checked)} />{uiMessages["ui.inbox.every_15_minutes"]()}</label>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending || !projectId || !dirty} onClick={() => void change({ action: 'configure', accountId, projectId, enabled, expectedRevision: saved?.revision ?? 0 })}>{uiMessages["ui.agent.memory_save"]()}</Button>
      <Button size="sm" variant="ghost" disabled={pending || !saved || Boolean(inbox?.check.requestedAt)} onClick={() => void change({ action: 'check', accountId })}>{uiMessages["ui.inbox.check_now"]()}</Button>
    </div>
    <p role="status" className="text-xs leading-5 text-[var(--vh-text-2)]">{status(inbox)}</p>
    {!!inbox?.recent.length && saved && <div className="space-y-1 text-xs text-[var(--vh-text-2)]">
      <p className="font-medium text-[var(--vh-text)]">{uiMessages["ui.inbox.recently_saved"]()} · <Link href={`/assets/${saved.projectId}`} className="underline">{uiMessages["ui.publishing.assets"]()}</Link></p>
      <ul className="space-y-0.5">{inbox.recent.map(item => <li key={item.messageId + ':' + item.index}>@{item.senderUsername ?? '—'} · {item.kind === 'reel' ? uiMessages["ui.publishing.reel"]() : uiMessages["ui.agent.kind_video"]()} · {new Date(item.updatedAt).toLocaleString()}</li>)}</ul>
    </div>}
  </section>;
}
