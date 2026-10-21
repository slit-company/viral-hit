import { Action } from '@/components/base/action';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import type { EditorOperation } from '@/core/commands/editor-commands';
import type { TimelineClip } from '@/core/editor/timeline-document';
import { overlayTransformAt, withOverlayKeyframe, type OverlayKeyframe } from '@/core/editor/overlay-motion';

export function OverlayInspector({ clip, time, onEdit, onSeek, locked }: {
  locked: boolean; clip: TimelineClip; time: number; onEdit: (operation: EditorOperation) => void; onSeek: (time: number) => void;
}) {
  const t = useTranslations('AppShell.editor.overlay');
  const cursor = Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, time));
  const sourceTime = clip.inPoint + cursor - clip.startTime;
  const pose = overlayTransformAt(clip, cursor)!;
  const frames = clip.motion?.keyframes ?? [];
  const selected = frames.find(frame => Math.abs(frame.time - sourceTime) < 0.001);
  const setMotion = (keyframes: OverlayKeyframe[]) => onEdit({ type: 'set_overlay_motion', clipId: clip.id, motion: keyframes.length ? { version: 1, keyframes } : null });
  const enableMotion = () => {
    const first = withOverlayKeyframe(clip, clip.startTime);
    onEdit({ type: 'set_overlay_motion', clipId: clip.id, motion: withOverlayKeyframe({ ...clip, motion: first }, clip.startTime + clip.duration) });
  };
  return <fieldset disabled={locked} className="min-w-0 space-y-4" aria-label={t('animation')}>
    <div className="space-y-2 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">{t('animation')}</span>
        <Action onClick={() => clip.motion ? setMotion([]) : enableMotion()} aria-pressed={!!clip.motion} className="vh-secondary !min-h-9 !px-2 !py-1 !text-xs">
          {t(clip.motion ? 'disable' : 'enable')}
        </Action>
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--vh-text-2)]">{t(clip.motion ? 'animatedHint' : 'staticHint')}</p>
      {clip.motion ? <>
        <div className="flex flex-wrap gap-1" aria-label={t('keyframes')}>
          {frames.map(frame => <Action key={frame.id} aria-pressed={frame === selected} aria-label={`${t('keyframe')} ${(frame.time - clip.inPoint).toFixed(2)}s`}
            onClick={() => onSeek(clip.startTime + frame.time - clip.inPoint)}
            disabled={frame.time < clip.inPoint || frame.time > clip.outPoint}
            className={`vh-secondary !min-h-9 !min-w-14 !px-2 !py-1 !text-xs tabular-nums ${frame === selected ? 'bg-[var(--vh-control)] ring-1 ring-[var(--vh-graph)]' : ''}`}>
            {(frame.time - clip.inPoint).toFixed(2)}s
          </Action>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Action disabled={!!selected || frames.length >= 32} onClick={() => onEdit({ type: 'set_overlay_motion', clipId: clip.id, motion: withOverlayKeyframe(clip, cursor) })} className="vh-secondary !min-h-9 !px-2 !py-1 !text-xs">{t('addKeyframe')}</Action>
          <Action disabled={!selected} onClick={() => setMotion(frames.filter(frame => frame !== selected))} className="vh-secondary !min-h-9 !px-2 !py-1 !text-xs">{t('removeKeyframe')}</Action>
        </div>
        <label className="block text-[11px] text-[var(--vh-text-2)]">{t('easing')}
          <select aria-label={t('easing')} disabled={!selected} value={selected?.easing ?? 'linear'}
            onChange={event => setMotion(frames.map(frame => frame === selected ? { ...frame, easing: event.target.value as OverlayKeyframe['easing'] } : frame))}
            className="mt-1 w-full rounded-md border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 py-2 text-xs">
            {(['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
          </select>
        </label>
        <p className="text-[11px] tabular-nums text-[var(--vh-text-2)]">{t('cursor')} {(cursor - clip.startTime).toFixed(2)}s · {frames.length}/32</p>
      </> : null}
    </div>
    {clip.sourceType === 'video' && <label className="block text-[11px] text-[var(--vh-text-2)]">
      {t('audioVolume')} · {Math.round(clip.volume * 100)}%
      <input type="range" min={0} max={1} step={.01} value={Math.min(1, clip.volume)} className="mt-2 w-full accent-[var(--vh-graph)]"
        onChange={event => onEdit({ type: 'update_audio', clipId: clip.id, patch: { volume: Number(event.target.value) } })} />
    </label>}
    {([
      ['x', 0, 1, 0.01, pose.x], ['y', 0, 1, 0.01, pose.y],
      ['width', 0.05, 2, 0.01, pose.width], ['opacity', 0, 1, 0.01, pose.opacity],
      ['rotation', -180, 180, 1, pose.rotation],
      ['fadeIn', 0, clip.duration, 0.01, clip.fadeIn], ['fadeOut', 0, clip.duration, 0.01, clip.fadeOut],
    ] as const).map(([field, min, max, step, value]) => <label key={field} className="block">
      <span className="mb-2 flex items-center justify-between text-[11px] text-[var(--vh-text-2)]">
        <span>{t(field)}</span><span className="tabular-nums">{field === 'fadeIn' || field === 'fadeOut' ? `${value.toFixed(2)}s` : field === 'rotation' ? `${Math.round(value)}°` : `${Math.round(value * 100)}%`}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        disabled={!!clip.motion && !selected && frames.length >= 32 && field !== 'fadeIn' && field !== 'fadeOut'}
        onChange={event => onEdit({ type: 'update_overlay', clipId: clip.id, atTime: cursor, patch: { [field]: Number(event.target.value) } })}
        className="h-1 w-full accent-[var(--vh-graph)]" />
    </label>)}
  </fieldset>;
}
