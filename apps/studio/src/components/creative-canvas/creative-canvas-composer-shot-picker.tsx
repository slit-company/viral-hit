import { useState, type RefObject } from 'react';
import { Clapperboard } from 'lucide-react';
import { Action } from '@/components/base/action';
import { parseShotLine, shotGroups, shotGroupsFor, writeShotLine, type Shot, type ShotGroup, type ShotOptionId } from '@/core/creative-canvas/shot-line';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { cn } from '@/lib/utils';
import { composerFloatingPanelClassName, composerSectionLabelClassName, stopComposerEvent } from './creative-canvas-composer-utils';

const chipClassName = (selected: boolean) => cn('rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
  selected ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white' : 'border-[var(--vh-border)] bg-[var(--vh-surface)] text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]');

/** Framing, angle, lens, camera move, light and look, written into the prompt as one editable Shot line. */
export function CreativeCanvasComposerShotPicker({ containerRef, disabled, isOpen, mediaType, onOpenChange, onPromptChange, prompt }: {
  containerRef: RefObject<HTMLDivElement | null>; disabled: boolean; isOpen: boolean; mediaType: 'image' | 'video';
  onOpenChange: (next: boolean) => void; onPromptChange: (prompt: string) => void; prompt: string;
}) {
  const t = useTranslations('AppShell.studio.canvas.shot');
  const { shot } = parseShotLine(prompt);
  const chosen = shotGroupsFor(mediaType).filter(group => shot[group]).length;
  // The panel is tall. It opens above the composer, or below the whole composer when the app header
  // leaves too little room, so the prompt and its Shot line stay visible either way.
  const [placement, setPlacement] = useState<{ top?: number; maxHeight: number }>({ maxHeight: 360 });
  function toggle() {
    const button = containerRef.current?.getBoundingClientRect();
    const composer = containerRef.current?.closest('.vh-composer')?.getBoundingClientRect();
    if (!isOpen && button && composer) {
      const above = button.top - 72, below = window.innerHeight - composer.bottom - 16;
      setPlacement(above >= 260 || above >= below ? { maxHeight: Math.min(360, above) } : { top: composer.bottom - button.top + 8, maxHeight: Math.min(360, below) });
    }
    onOpenChange(!isOpen);
  }
  const choose = (group: ShotGroup, id: ShotOptionId) => onPromptChange(writeShotLine(prompt, { ...shot, [group]: shot[group] === id ? undefined : id } as Shot, mediaType));
  return <div ref={containerRef} className="relative shrink-0">
    <Action type="button" disabled={disabled} onClick={toggle} onPointerDownCapture={stopComposerEvent} aria-expanded={isOpen}
      aria-label={chosen ? t('buttonWithCount', { count: chosen }) : t('button')}
      className={cn('inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:cursor-not-allowed disabled:opacity-60',
        chosen ? 'bg-[var(--vh-control)] text-[var(--vh-text-1)]' : 'text-[var(--vh-text-3)]')}>
      <Clapperboard className="size-3.5" aria-hidden="true" /><span>{t('button')}</span>{chosen ? <span className="tabular-nums">{chosen}</span> : null}
    </Action>
    {isOpen ? <div role="group" aria-label={t('title')} style={placement.top === undefined ? { maxHeight: placement.maxHeight } : { maxHeight: placement.maxHeight, top: placement.top, bottom: 'auto' }} onPointerDownCapture={stopComposerEvent}
      className={cn(composerFloatingPanelClassName, 'left-0 w-[min(360px,calc(100vw-48px))]')}>
      <div className="space-y-3 px-1 pb-1">
        <p className="px-1 text-[11px] leading-4 text-[var(--vh-text-3)]">{t('hint')}</p>
        {shotGroupsFor(mediaType).map(group => <div key={group} className="space-y-1.5">
          <div className={composerSectionLabelClassName}>{t('groups.' + group)}</div>
          <div className="flex flex-wrap gap-1.5">{shotGroups[group].map(item => <Action key={item.id} type="button" disabled={disabled} aria-pressed={shot[group] === item.id}
            onClick={() => choose(group, item.id)} className={chipClassName(shot[group] === item.id)}>{t('options.' + group + '.' + item.id)}</Action>)}</div>
        </div>)}
        {chosen ? <Action type="button" disabled={disabled} onClick={() => onPromptChange(writeShotLine(prompt, {}, mediaType))} className="px-1 text-[11px] font-semibold text-[var(--vh-text-3)] hover:text-[var(--vh-text-1)]">{t('clear')}</Action> : null}
      </div>
    </div> : null}
  </div>;
}
