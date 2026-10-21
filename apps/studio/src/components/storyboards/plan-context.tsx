import { Action } from '@/components/base/action';
import type { StoryboardPlan } from '@/core/storyboards/contract';
import type { BoardAsset } from './use-storyboards';
import { Field, SelectField, MediaPreview, seconds, panel } from './fields';

export function PlanContext({ plan, assets, change }: { plan: StoryboardPlan; assets: BoardAsset[]; change: (plan: StoryboardPlan) => void }) {
  const owned = assets.filter(asset => asset.storageProvider === 'local' && asset.sha256);
  const reference = (index: number, patch: Partial<StoryboardPlan['references'][number]>) =>
    change({ ...plan, references: plan.references.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const audio = (index: number, patch: Partial<StoryboardPlan['audio'][number]>) =>
    change({ ...plan, audio: plan.audio.map((item, i) => i === index ? { ...item, ...patch } : item) });
  return <div className="space-y-5">
    <section className={panel} aria-label="Creative intent">
      <h2 className="font-semibold">The plan</h2>
      <Field label="Storyboard title" value={plan.title} maxLength={120} onChange={title => change({ ...plan, title })} />
      <SelectField label="Use case" value={plan.scope} onChange={scope => change({ ...plan, scope: scope as StoryboardPlan['scope'] })}><option value="general">General purpose</option><option value="specialized">For a specific job</option></SelectField>
      <Field label="Creative intent" value={plan.intent} multiline onChange={intent => change({ ...plan, intent })} />
    </section>
    <section className={panel} aria-label="Reference observations">
      <h2 className="font-semibold">Reference observations</h2>
      <p className="text-sm leading-6 text-[var(--vh-text-2)]">Describe what you observed, inferred or propose. Assign these observations to individual shots.</p>
      <SelectField label="Add reference media" value="" onChange={id => {
        const asset = owned.find(item => item.id === id); if (!asset || plan.references.length >= 32) return;
        change({ ...plan, references: [...plan.references, { id: 'ref-' + crypto.randomUUID().slice(0, 8), assetId: id, sha256: asset.sha256!, observation: '', basis: 'proposed' }] });
      }}><option value="">Choose project media…</option>{owned.map(asset => <option key={asset.id} value={asset.id}>{asset.filename || asset.type} · {asset.id}</option>)}</SelectField>
      {plan.references.map((item, i) => <div key={item.id} className="space-y-4 border-t border-[var(--vh-border)] pt-4" aria-label={'Reference ' + (i + 1)}>
        <p className="break-all font-mono text-xs">{item.id}</p>
        <MediaPreview asset={owned.find(asset => asset.id === item.assetId)} startTime={item.startTime} duration={item.endTime !== undefined ? item.endTime - (item.startTime ?? 0) : undefined} />
        {item.evidence && <p className="break-words text-xs leading-5 text-[var(--vh-text-2)]">Machine source: {item.evidence.engine} · {item.evidence.kind}. Receipt fingerprint {item.evidence.outputSha256.slice(0, 12)}. This source record is retained when the plan is shared.</p>}
        <SelectField label={'Observation basis ' + (i + 1)} value={item.basis} onChange={basis => reference(i, { basis: basis as typeof item.basis })}>{['observed', 'inferred', 'proposed'].map(basis => <option key={basis}>{basis}</option>)}</SelectField>
        <Field label={'Observation ' + (i + 1)} value={item.observation} multiline onChange={observation => reference(i, { observation })} />
        {owned.find(asset => asset.id === item.assetId)?.type !== 'image' && <div className="grid grid-cols-2 gap-3">
          <Field label={'Reference start ' + (i + 1)} numeric value={item.startTime ?? ''} onChange={value => reference(i, { startTime: value === '' ? undefined : seconds(value) })} />
          <Field label={'Reference end ' + (i + 1)} numeric value={item.endTime ?? ''} onChange={value => reference(i, { endTime: value === '' ? undefined : seconds(value) })} />
        </div>}
        <Action className="vh-secondary" onClick={() => change({ ...plan, references: plan.references.filter((_, index) => index !== i), shots: plan.shots.map(shot => ({ ...shot, references: shot.references.filter(id => id !== item.id) })) })}>Remove reference {i + 1}</Action>
      </div>)}
    </section>
    <section className={panel} aria-label="Soundtrack">
      <h2 className="font-semibold">Soundtrack</h2>
      <SelectField label="Add audio" value="" onChange={id => {
        const asset = owned.find(item => item.id === id); if (!asset || plan.audio.length >= 8) return;
        change({ ...plan, audio: [...plan.audio, { id: 'audio-' + crypto.randomUUID().slice(0, 8), assetId: id, sha256: asset.sha256!, role: 'music', startTime: 0, duration: Math.max(.01, (asset.durationMs ?? 3000) / 1000), inPoint: 0, volume: 1 }] });
      }}><option value="">Choose project audio…</option>{owned.filter(asset => asset.type === 'audio').map(asset => <option key={asset.id} value={asset.id}>{asset.filename || 'Audio'} · {asset.id}</option>)}</SelectField>
      {plan.audio.map((item, i) => <div key={item.id} className="space-y-4 border-t border-[var(--vh-border)] pt-4" aria-label={'Audio ' + (i + 1)}>
        <MediaPreview asset={owned.find(asset => asset.id === item.assetId)} />
        <SelectField label={'Audio role ' + (i + 1)} value={item.role} onChange={role => audio(i, { role: role as typeof item.role })}>{['music', 'voice', 'sfx', 'source'].map(role => <option key={role}>{role}</option>)}</SelectField>
        <div className="grid grid-cols-2 gap-3">{(['startTime', 'duration', 'inPoint', 'volume'] as const).map(key => <Field key={key} label={key + ' ' + (i + 1)} numeric min={key === 'duration' ? .01 : 0} max={key === 'volume' ? 4 : 3600} value={item[key]} onChange={value => audio(i, { [key]: key === 'volume' ? Math.min(4, seconds(value)) : seconds(value, key === 'duration' ? .01 : 0) })} />)}</div>
        <Action className="vh-secondary" onClick={() => change({ ...plan, audio: plan.audio.filter((_, index) => index !== i) })}>Remove audio {i + 1}</Action>
      </div>)}
    </section>
  </div>;
}
