import { useState } from 'react';
import { Action } from '@/components/base/action';
import type { StoryboardController } from './use-storyboards';
import { Field, SelectField, MediaPreview, seconds } from './fields';

export function ShotReview({ controller: c, shotId }: { controller: StoryboardController; shotId: string }) {
  const [choice, setChoice] = useState(''), [inPoint, setInPoint] = useState(0), [notes, setNotes] = useState('');
  const accepted = c.view?.accepted[shotId];
  const duration = c.draft?.plan.shots.find(shot => shot.id === shotId)?.duration;
  const attempts = c.view?.actions.filter(item => item.kind === 'generate' && item.shotId === shotId) ?? [];
  const chosen = attempts.find(action => choice === 'run:' + action.requestId);
  const assets = c.catalog?.assets.filter(asset => asset.storageProvider === 'local' && asset.sha256 && ['image', 'video'].includes(asset.type)) ?? [];
  const asset = assets.find(asset => chosen ? asset.id === chosen.output?.assetId && asset.sha256 === chosen.output.sha256 : choice === 'asset:' + asset.id);
  const source = chosen ? { kind: 'generation' as const, requestId: chosen.requestId } : asset ? { kind: 'asset' as const, assetId: asset.id, sha256: asset.sha256! } : undefined;
  return <section className="scroll-mt-28 space-y-4 border-t border-[var(--vh-border)] pt-5" aria-label="Review shot result">
    <h3 className="font-semibold">Review & accept</h3>
    {accepted && <div className="space-y-3 rounded-xl bg-[var(--color-brand-lime-soft)] p-3 text-sm text-[var(--color-lime-text)]"><p>{c.dirty ? 'Accepted in the saved revision. Saving changed shot inputs may clear acceptance.' : 'Accepted result'}</p>{!choice && <MediaPreview asset={assets.find(asset => asset.id === accepted.assetId && asset.sha256 === accepted.sha256)} startTime={accepted.inPoint} duration={c.view?.plan.shots.find(shot => shot.id === shotId)?.duration} />}<p className="break-words">{accepted.notes}</p></div>}
    <SelectField label="Result to review" value={choice} onChange={value => { setChoice(value); setNotes(''); setInPoint(0); }}>
      <option value="">Choose a result…</option>
      {attempts.filter(action => action.output).map(action => <option key={action.requestId} value={'run:' + action.requestId}>Generated attempt · {action.requestId}</option>)}
      {assets.map(asset => <option key={asset.id} value={'asset:' + asset.id}>{asset.filename || asset.type} · {asset.id}</option>)}
    </SelectField>
    {choice && <><MediaPreview asset={asset} startTime={inPoint} duration={duration} />
      {asset?.type === 'video' && <Field label="Result in point (seconds)" numeric value={inPoint} onChange={value => setInPoint(seconds(value))} />}
      <Field label="Review notes" value={notes} multiline onChange={setNotes} />
      <Action className="vh-primary" disabled={c.busy || c.dirty || !!c.pending || !source || !notes.trim()} onClick={() => source && void c.accept(shotId, source, inPoint, notes)}>Accept this result</Action>
    </>}
    {!!attempts.length && <details className="text-xs leading-6"><summary className="cursor-pointer font-medium">Generation attempts ({attempts.length})</summary><ul className="mt-3 space-y-3">{attempts.map(action => <li key={action.requestId} className="break-words rounded-lg border border-[var(--vh-border)] p-3"><p className="break-all font-mono">{action.requestId}</p><p>Plan revision {action.revision}</p>{action.jobs.map(job => <p key={job.id}>{job.nodeId}: {job.state}{job.error ? ' · ' + job.error : ''}</p>)}</li>)}</ul></details>}
  </section>;
}
