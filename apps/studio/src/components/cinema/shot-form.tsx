import type { ReactNode } from 'react';
import { Action } from '@/components/base/action';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { shotGroups, type ShotGroup } from '@/core/creative-canvas/shot-line';
import { CAMERA_MOVES } from '@/core/shot-harness/camera-moves';
import { SHOT_ASPECT_RATIOS } from '@/core/shot-harness/spec';
import { useWorkspaceModels } from '@/core/workspace-hooks/use-workspace-metadata';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { cn } from '@/lib/utils';
import { CameraMovePreview } from './camera-move-preview';
import { ProjectImagePicker } from './project-image-picker';
import type { CinemaDraft } from './use-cinema';

const DURATIONS = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];
const LOOK_GROUPS: ShotGroup[] = ['size', 'angle', 'lens', 'light', 'look'];
const DRAFT_KEY: Record<string, 'framing' | 'angle' | 'lens' | 'light' | 'look'> = { size: 'framing', angle: 'angle', lens: 'lens', light: 'light', look: 'look' };
const chip = (selected: boolean) => cn('rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
  selected ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white' : 'border-[var(--vh-border)] bg-[var(--vh-surface)] text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]');

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return <div className={cn('space-y-1.5', className)}><div className="text-xs font-semibold">{label}</div>{children}{hint && <p className="text-[11px] leading-4 text-[var(--vh-text-3)]">{hint}</p>}</div>;
}

function CameraMoves({ value, disabled, onChange }: { value: string[]; disabled: boolean; onChange: (moves: string[]) => void }) {
  const t = useTranslations('AppShell.cinema');
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(item => item !== id) : [...value, id].slice(-2));
  return <div role="group" aria-label={t('camera')} className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
    {CAMERA_MOVES.map(move => {
      const order = value.indexOf(move.id);
      return <Action key={move.id} type="button" disabled={disabled} aria-pressed={order >= 0} onClick={() => toggle(move.id)}
        className={cn('group relative overflow-hidden rounded-xl border p-1 text-left transition', order >= 0 ? 'border-[var(--vh-text-1)] bg-[var(--vh-control)]' : 'border-[var(--vh-border)] hover:border-[var(--vh-text-3)]')}>
        <span className="block aspect-[16/10] overflow-hidden rounded-lg"><CameraMovePreview move={move.id} /></span>
        <span className="mt-1 block truncate px-0.5 text-[11px] font-medium">{t('moves.' + move.id)}</span>
        {order >= 0 && <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-[var(--vh-text-1)] text-[9px] font-bold text-white">{order + 1}</span>}
      </Action>;
    })}
  </div>;
}

/** Everything a director decides about one shot; the plan beside it shows what the harness will do. */
export function ShotForm({ projectId, draft, disabled, onChange }: { projectId: string; draft: CinemaDraft; disabled: boolean; onChange: (patch: Partial<CinemaDraft>) => void }) {
  const t = useTranslations('AppShell.cinema'), shotT = useTranslations('AppShell.studio.canvas.shot');
  const models = useWorkspaceModels().data?.models ?? [];
  const visual = models.filter(model => (model.workspaceType === 'ai-image' || model.workspaceType === 'ai-video') && model.available !== false && model.providerId && model.providerId !== 'cloud-api');
  const providers = [...new Map(visual.map(model => [model.providerId!, model.providerLabel ?? model.providerId!])).entries()];
  const inProvider = (type: string) => visual.filter(model => model.workspaceType === type && (draft.provider === 'any' || model.providerId === draft.provider));
  const text = (key: 'subject' | 'action' | 'setting', rows: number) =>
    <Textarea aria-label={t(key)} placeholder={t(key + 'Hint')} rows={rows} value={draft[key] ?? ''} disabled={disabled} onChange={event => onChange({ [key]: event.target.value.slice(0, 800) })} className="min-h-0 resize-y text-sm leading-6" />;
  return <div className="space-y-5">
    <Field label={t('subject')}>{text('subject', 2)}</Field>
    <Field label={t('action')}>{text('action', 2)}</Field>
    <Field label={t('setting')}>{text('setting', 2)}</Field>
    <Field label={t('camera')} hint={t('cameraHint')}><CameraMoves value={draft.moves} disabled={disabled} onChange={moves => onChange({ moves })} /></Field>
    <Field label={t('look')}>
      <div className="space-y-2.5">{LOOK_GROUPS.map(group => {
        const key = DRAFT_KEY[group];
        return <div key={group} role="group" aria-label={shotT('groups.' + group)} className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 text-[11px] text-[var(--vh-text-3)]">{shotT('groups.' + group)}</span>
          {shotGroups[group].map(item => <Action key={item.id} type="button" disabled={disabled} aria-pressed={draft[key] === item.id} className={chip(draft[key] === item.id)}
            onClick={() => onChange({ [key]: draft[key] === item.id ? undefined : item.id })}>{shotT('options.' + group + '.' + item.id)}</Action>)}
        </div>;
      })}</div>
    </Field>
    <Field label={t('mood')}><Input aria-label={t('mood')} placeholder={t('moodHint')} value={draft.mood ?? ''} disabled={disabled} onChange={event => onChange({ mood: event.target.value.slice(0, 200) })} /></Field>
    <Field label={t('audio')} hint={t('audioHint')}>
      <Textarea aria-label={t('audio')} rows={2} value={draft.audio ?? ''} disabled={disabled} onChange={event => onChange({ audio: event.target.value.slice(0, 600) })} className="min-h-0 resize-y text-sm leading-6" />
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('duration')}><NativeSelect aria-label={t('duration')} value={String(draft.duration)} disabled={disabled} onChange={event => onChange({ duration: Number(event.target.value) })}>
        {DURATIONS.map(value => <option key={value} value={value}>{t('seconds', { count: value })}</option>)}</NativeSelect></Field>
      <Field label={t('aspect')}><NativeSelect aria-label={t('aspect')} value={draft.aspectRatio} disabled={disabled} onChange={event => onChange({ aspectRatio: event.target.value as CinemaDraft['aspectRatio'] })}>
        {SHOT_ASPECT_RATIOS.map(value => <option key={value} value={value}>{value}</option>)}</NativeSelect></Field>
    </div>
    <Field label={t('start')}>
      <div className="grid grid-cols-2 gap-2">{(['generate', 'none'] as const).map(mode => {
        const selected = !draft.startAssetId && draft.startFrame === mode;
        return <Action key={mode} type="button" disabled={disabled} aria-pressed={selected} onClick={() => onChange({ startFrame: mode, startAssetId: undefined })}
          className={cn('rounded-xl border p-3 text-left', selected ? 'border-[var(--vh-text-1)] bg-[var(--vh-control)]' : 'border-[var(--vh-border)]')}>
          <span className="block text-xs font-semibold">{t(mode === 'generate' ? 'startGenerate' : 'startNone')}</span>
          <span className="mt-1 block text-[11px] leading-4 text-[var(--vh-text-3)]">{t(mode === 'generate' ? 'startGenerateHint' : 'startNoneHint')}</span>
        </Action>;
      })}</div>
      <ProjectImagePicker projectId={projectId} label={t('startAsset')} max={1} disabled={disabled} value={draft.startAssetId ? [draft.startAssetId] : []} onChange={ids => onChange({ startAssetId: ids[0] })} />
    </Field>
    <Field label={t('end')} hint={t('endHint')}>
      <ProjectImagePicker projectId={projectId} label={t('endAsset')} max={1} disabled={disabled || (!draft.startAssetId && draft.startFrame === 'none')}
        value={draft.endAssetId ? [draft.endAssetId] : []} onChange={ids => onChange({ endAssetId: ids[0] })} />
    </Field>
    <Field label={t('characters')} hint={t('charactersHint')}>
      <ProjectImagePicker projectId={projectId} label={t('chooseImages')} max={4} disabled={disabled} value={draft.characterAssetIds} onChange={characterAssetIds => onChange({ characterAssetIds })} />
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('provider')}><NativeSelect aria-label={t('provider')} value={draft.provider} disabled={disabled} onChange={event => onChange({ provider: event.target.value, videoModel: 'auto', imageModel: 'auto' })}>
        <option value="any">{t('anyProvider')}</option>{providers.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</NativeSelect></Field>
      <Field label={t('takes')}><NativeSelect aria-label={t('takes')} value={String(draft.variations)} disabled={disabled} onChange={event => onChange({ variations: Number(event.target.value) })}>
        {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</NativeSelect></Field>
      {/* Model names are long ("Grok Imagine Video 1.5 Lite"); a full row keeps them readable on phones. */}
      <Field label={t('videoModel')} className="col-span-2"><NativeSelect aria-label={t('videoModel')} value={draft.videoModel} disabled={disabled} onChange={event => onChange({ videoModel: event.target.value })}>
        <option value="auto">{t('auto')}</option>{inProvider('ai-video').map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</NativeSelect></Field>
      <Field label={t('imageModel')} className="col-span-2"><NativeSelect aria-label={t('imageModel')} value={draft.imageModel} disabled={disabled || draft.startFrame === 'none' || Boolean(draft.startAssetId)} onChange={event => onChange({ imageModel: event.target.value })}>
        <option value="auto">{t('auto')}</option>{inProvider('ai-image').map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</NativeSelect></Field>
    </div>
  </div>;
}
