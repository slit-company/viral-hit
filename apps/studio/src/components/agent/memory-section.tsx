import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { MEMORY_TEXT_LIMIT, type AgentAction, type MemoryEntry } from '@/core/agent/contract';
import { apiJsonGet } from '@/lib/api-client';
import { formatAgentTime } from './approval-card';

type Change = (action: AgentAction) => Promise<boolean>;

function MemoryItem({ entry, busy, onChange }: { entry: MemoryEntry; busy: boolean; onChange: Change }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) return <li className="p-4">
    <form className="space-y-2" onSubmit={async (event) => { event.preventDefault(); if (await onChange({ action: 'remember', id: entry.id, text: draft, projectId: entry.projectId })) setDraft(null); }}>
      <Textarea aria-label={m['ui.agent.memory_edit']()} value={draft} maxLength={MEMORY_TEXT_LIMIT} onChange={(event) => setDraft(event.target.value)} />
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy || !draft.trim()}>{m['ui.agent.memory_save']()}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>{m['ui.agent.memory_cancel']()}</Button></div>
    </form>
  </li>;
  return <li className="flex items-start justify-between gap-3 p-4">
    <div className="min-w-0 flex-1">
      <p className="whitespace-pre-wrap break-words text-sm">{entry.text}</p>
      <p className="mt-1 text-xs text-[var(--vh-text-2)]">{entry.source === 'person' ? m['ui.agent.source_person']() : m['ui.agent.source_agent']()} · <time dateTime={entry.updatedAt}>{formatAgentTime(entry.updatedAt)}</time></p>
    </div>
    <div className="flex shrink-0 gap-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(entry.text)}>{m['ui.agent.memory_edit']()}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onChange({ action: 'forget', id: entry.id })}>{m['ui.agent.memory_forget']()}</Button>
    </div>
  </li>;
}

/** What agents should remember, for the whole workspace or one project. */
export function MemorySection({ memory, busy, onChange }: { memory: MemoryEntry[]; busy: boolean; onChange: Change }) {
  const projects = useQuery({ queryKey: ['sidebar-projects'], queryFn: () => apiJsonGet<{ projects: Array<{ id: string; name: string }> }>('/api/app/projects'), staleTime: 30_000 });
  const [text, setText] = useState('');
  const [scope, setScope] = useState('workspace');
  const groups = useMemo(() => {
    const byScope = new Map<string, { title: string; entries: MemoryEntry[] }>();
    for (const entry of [...memory].sort((left, right) => Number(left.projectId !== null) - Number(right.projectId !== null))) {
      const key = entry.projectId ?? 'workspace';
      const title = entry.projectId ? entry.projectName ?? m['ui.agent.unknown_project']() : m['ui.agent.memory_workspace']();
      byScope.set(key, { title, entries: [...(byScope.get(key)?.entries ?? []), entry] });
    }
    return [...byScope.entries()];
  }, [memory]);
  return <section aria-labelledby="agent-memory" className="space-y-3">
    <div className="space-y-1">
      <h2 id="agent-memory" className="text-xl font-semibold">{m['ui.agent.memory_title']()}</h2>
      <p className="max-w-xl text-sm leading-6 text-[var(--vh-text-2)]">{m['ui.agent.memory_body']()}</p>
    </div>
    <form className="space-y-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4" onSubmit={async (event) => {
      event.preventDefault();
      if (await onChange({ action: 'remember', text, projectId: scope === 'workspace' ? null : scope })) setText('');
    }}>
      <Textarea aria-label={m['ui.agent.memory_new']()} value={text} maxLength={MEMORY_TEXT_LIMIT} placeholder={m['ui.agent.memory_placeholder']()} onChange={(event) => setText(event.target.value)} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1 text-xs text-[var(--vh-text-2)]">{m['ui.agent.memory_scope']()}
          <NativeSelect className="mt-1" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="workspace">{m['ui.agent.memory_workspace']()}</option>
            {(projects.data?.projects ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </NativeSelect>
        </label>
        <Button type="submit" className="h-10" disabled={busy || !text.trim()}><Plus aria-hidden="true" /> {m['ui.agent.memory_add']()}</Button>
      </div>
    </form>
    {groups.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--vh-border)] p-6 text-center text-sm text-[var(--vh-text-2)]">{m['ui.agent.memory_empty']()}</p>
      : groups.map(([key, group]) => <div key={key} className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--vh-text-3)]">{group.title}</h3>
        <ul className="divide-y divide-[var(--vh-border)] rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)]">
          {group.entries.map((entry) => <MemoryItem key={entry.id} entry={entry} busy={busy} onChange={onChange} />)}
        </ul>
      </div>)}
  </section>;
}
