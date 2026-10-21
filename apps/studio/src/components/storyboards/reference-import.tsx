import { useState } from 'react';
import { Action } from '@/components/base/action';
import type { StoryboardController } from './use-storyboards';
import { Field, SelectField, panel } from './fields';

export function ReferenceImport({ controller: c, onPrepared }: { controller: StoryboardController; onPrepared: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [sceneId, setSceneId] = useState(''), [transcriptId, setTranscriptId] = useState('');
  const [first, setFirst] = useState(1), [last, setLast] = useState(1), [title, setTitle] = useState('Reference shot plan');
  const [intent, setIntent] = useState(''), [scope, setScope] = useState<'general' | 'specialized'>('general');
  const sources = c.catalog?.referenceSources.sources ?? [], scenes = sources.filter(item => item.kind === 'scenes');
  const selected = scenes.find(item => item.jobId === sceneId);
  const transcripts = sources.filter(item => item.kind === 'transcript' && item.assetId === selected?.assetId && item.sha256 === selected?.sha256);
  const transcript = transcripts.find(item => item.jobId === transcriptId);
  const blocked = c.busy || c.dirty || !!c.pending;
  const valid = selected && first >= 1 && last >= first && last <= selected.count && last - first < 16 && title.trim() && intent.trim();
  const name = (assetId: string) => c.catalog?.assets.find(asset => asset.id === assetId)?.filename || assetId;
  return <details className={panel} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">Start from analyzed video</summary>
    <p className="text-sm leading-6 text-[var(--vh-text-2)]">Choose completed scene detection and optional speech recognition. Their source ranges become a reviewable shot plan for any creative use. Describe what you want to make, then review each shot.</p>
    {!scenes.length ? <p className="text-sm">No completed scene analysis yet. Run Detect video scenes on project footage, then refresh status here.</p> : <fieldset disabled={blocked} className="min-w-0 space-y-4 disabled:opacity-60">
      <SelectField label="Analyzed video" value={sceneId} onChange={id => { setSceneId(id); setTranscriptId(''); setFirst(1); setLast(Math.min(16, scenes.find(item => item.jobId === id)?.count ?? 1)); }}>
        <option value="">Choose scene analysis…</option>{scenes.map(item => <option key={item.jobId} value={item.jobId}>{name(item.assetId)} · {item.count} scenes · {item.runId.slice(0, 8)}</option>)}
      </SelectField>
      <SelectField label="Speech context" value={transcriptId} onChange={setTranscriptId}><option value="">No transcript</option>{transcripts.map(item => <option key={item.jobId} value={item.jobId}>{item.label} · {item.start}–{item.end}s · {item.runId.slice(0, 8)}</option>)}</SelectField>
      <p className="text-xs leading-5 text-[var(--vh-text-2)]">Only transcripts of the same original video are listed. Speech is reference context; caption text and shot direction remain yours to author.</p>
      {selected && <p className="text-sm">{selected.count} detected scenes available. Select up to 16 consecutive scenes; omitted scenes are not imported.</p>}
      <div className="grid grid-cols-2 gap-3"><Field label="First scene" numeric min={1} max={selected?.count ?? 64} value={first} onChange={value => setFirst(Math.floor(Number(value)))} /><Field label="Last scene" numeric min={1} max={selected?.count ?? 64} value={last} onChange={value => setLast(Math.floor(Number(value)))} /></div>
      <Field label="Reference plan title" value={title} maxLength={120} onChange={setTitle} />
      <SelectField label="Reference plan use case" value={scope} onChange={value => setScope(value as typeof scope)}><option value="general">General purpose</option><option value="specialized">For a specific job</option></SelectField>
      <Field label="Reference plan intent" value={intent} onChange={setIntent} multiline />
      <Action className="vh-primary" disabled={!valid} onClick={() => { if (selected) void c.prepareReference({ action: 'prepare-reference', scenes: selected, ...(transcript ? { transcript } : {}), firstScene: first - 1, lastScene: last - 1, title, intent, scope }).then(prepared => { if (prepared) { setExpanded(false); onPrepared(); } }); }}>Prepare reference draft</Action>
    </fieldset>}
    {blocked && <p className="text-xs">Finish or discard the current draft and resolve pending requests before preparing another plan.</p>}
    {!!c.catalog?.referenceSources.omitted && <p className="text-xs">Showing 100 recent analyses. Older analysis IDs remain available through the shared API.</p>}
  </details>;
}
