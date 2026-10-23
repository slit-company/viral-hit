import { cn } from '@/lib/utils';

/* Studio and Canvas share SEED surfaces, ink actions and compact controls. */

/** Composer card surface — mirrors the homepage hero composer card. */
export const composerCardClassName =
  'rounded-[var(--vh-radius)] border border-[var(--vh-border)] bg-[var(--vh-surface)] shadow-[var(--shadow-float)] backdrop-blur-2xl';

/** Field trigger chip (model / ratio / quality selectors). */
export const composerFieldButtonClassName =
  'relative flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-full border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 text-left text-[12px] font-medium text-[var(--vh-text-1)] transition-all duration-200 hover:border-[var(--vh-border)] hover:bg-[var(--vh-control)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vh-graph)] disabled:cursor-not-allowed disabled:opacity-60';

/** Floating picker panel anchored above a field chip. */
export const composerFloatingPanelClassName =
  'vh-pop-in absolute bottom-[calc(100%+8px)] z-40 max-h-[min(360px,60vh)] overflow-y-auto rounded-[var(--vh-radius-sm)] border border-[var(--vh-border)] bg-[var(--vh-surface-2)] p-1.5 text-[var(--vh-text-1)] shadow-[var(--shadow-float)]';

/** Option row inside a floating picker panel. */
export const getComposerOptionRowClassName = (isSelected: boolean) =>
  cn(
    'flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] transition-colors duration-150',
    isSelected
      ? 'bg-[var(--vh-control)] font-medium text-[var(--vh-text-1)] shadow-[var(--shadow-float)]'
      : 'text-[var(--vh-text-2)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]'
  );

/** Quiet Figtree section label — same voice as product UI, not dashboard caps. */
export const panelLabelClassName =
  'text-[12px] font-medium tracking-[-0.01em] text-[var(--vh-text-2)]';

/** Section label inside a floating picker panel. */
export const composerSectionLabelClassName = `px-0.5 ${panelLabelClassName}`;

/** Parameter value chip inside a picker panel. */
export const getComposerParameterChipClassName = (isActive: boolean) =>
  cn(
    'rounded-full border px-2.5 py-1.5 text-[12px] font-medium tracking-[-0.01em] transition-all duration-150',
    isActive
      ? 'border-[var(--vh-border)] bg-[var(--vh-control)] text-[var(--vh-text-1)]'
      : 'border-[var(--vh-border)] bg-[var(--vh-control)] text-[var(--vh-text-2)] hover:border-[var(--vh-border)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]'
  );

/** Labelled Generate action in SEED brand lime, the main call to action as on Higgsfield. */
export const composerGenerateButtonClassName =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-brand-lime)] px-3.5 text-[13px] font-semibold text-[var(--color-ink)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-[var(--vh-control)] disabled:text-[var(--vh-text-3)]';
