import { useState } from 'react';
import { Action } from '@/components/base/action';
import type { StoryboardController } from './use-storyboards';
import { Field, SelectField, panel } from './fields';

export function AnalysisImport({ controller: c, onPrepared }: { controller: StoryboardController; onPrepared: () => void }) {
  const [expanded, setExpanded] = useState(false), [selectedId, setSelectedId] = useState('');
  const [first, setFirst] = useState(1), [last, setLast] = useState(1);
  const [title, setTitle] = useState('Analysis shot plan'), [intent, setIntent] = useState('');
  const [scope, setScope] = useState<'general' | 'specialized'>('general');
  const sources = c.catalog?.analysisSources.sources ?? [];
  const selected = sources.find(source => source.generationId === selectedId);
  const blocked = c.busy || c.dirty || !!c.pending;
  const valid = selected && first >= 1 && last >= first && last <= selected.observations.length && last - first < 16 && title.trim() && intent.trim();
  const name = (assetId: string) => c.catalog?.assets.find(asset => asset.id === assetId)?.filename || assetId;
  return <details className={panel} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">Start from a model report</summary>
    <p className="text-sm leading-6 text-[var(--vh-text-2)]">Use a completed structured report to prepare editable observations and shot suggestions. Choose what serves your project, then review the original footage and proposed directions.</p>
    {!sources.length ? <p className="text-sm">No structured reports with a verified local video yet. Run a compatible analysis provider in Canvas, then refresh status here. Text-only reports remain in your generation history.</p> : <fieldset disabled={blocked} className="min-w-0 space-y-4 disabled:opacity-60">
      <SelectField label="Model analysis report" value={selectedId} onChange={id => { setSelectedId(id); setFirst(1); setLast(Math.min(16, sources.find(source => source.generationId === id)?.observations.length ?? 1)); }}>
        <option value="">Choose a report…</option>{sources.map(source => <option key={source.generationId} value={source.generationId}>{name(source.assetId)} · {source.model} · {source.generationId.slice(0, 8)}</option>)}
      </SelectField>
      {selected && <div className="min-w-0 space-y-2 rounded-xl bg-[var(--vh-surface-2)] p-3 text-sm leading-6">
        <div className="space-y-1 text-xs leading-5 sm:hidden"><p className="break-words">Source: {name(selected.assetId)}</p><p className="break-all">Model: {selected.model}</p><p>Report: {selected.generationId.slice(0, 8)}</p></div>
        <p className="whitespace-pre-wrap break-words">{selected.summary}</p>
        <p>{selected.observations.length} {selected.observations.length === 1 ? 'observation' : 'observations'} available. Select up to 16; the remaining observations stay in the report.</p>
        <ol aria-label="Report observations" className="max-h-48 space-y-1 overflow-auto">{selected.observations.map((item, i) => <li key={item.id} className="break-words">{i + 1}. {item.title} · {item.start}–{item.end}s</li>)}</ol>
      </div>}
      <div className="grid grid-cols-2 gap-3"><Field label="First observation" numeric min={1} max={selected?.observations.length ?? 64} value={first} onChange={value => setFirst(Math.floor(Number(value)))} /><Field label="Last observation" numeric min={1} max={selected?.observations.length ?? 64} value={last} onChange={value => setLast(Math.floor(Number(value)))} /></div>
      <Field label="Analysis plan title" value={title} maxLength={120} onChange={setTitle} />
      <SelectField label="Analysis plan use case" value={scope} onChange={value => setScope(value as typeof scope)}><option value="general">General purpose</option><option value="specialized">For a specific job</option></SelectField>
      <Field label="Analysis plan intent" value={intent} multiline onChange={setIntent} />
      <Action className="vh-primary" disabled={!valid} onClick={() => { if (selected) void c.prepareFromAnalysis({ action: 'prepare-analysis', analysis: { generationId: selected.generationId, outputSha256: selected.outputSha256 }, observationIds: selected.observations.slice(first - 1, last).map(item => item.id), title, intent, scope }).then(prepared => { if (prepared) { setExpanded(false); onPrepared(); } }); }}>Prepare analysis draft</Action>
    </fieldset>}
    {blocked && <p className="text-xs">Finish or discard the current draft and resolve pending requests before preparing another plan.</p>}
    {c.catalog?.analysisSources.hasOlder && <p className="text-xs">Showing reports from the latest 100 completed generations. Older report IDs remain available through the shared API.</p>}
  </details>;
}
