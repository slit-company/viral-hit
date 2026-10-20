import { useEffect, useRef, useState, type RefObject } from 'react';

export type ComposerPopover = 'type' | 'model' | 'parameter' | 'reference' | 'version' | 'shot';

/** A pointer press keeps the open popover only when it lands inside that popover. */
export function resolveOpenPopoverOnPointerDown(open: ComposerPopover | null, isWithinOpenPopover: boolean) {
  return open && isWithinOpenPopover ? open : null;
}

/**
 * At most one composer popover is open. It closes on a press outside it, on Escape, when another draft
 * becomes active and while the draft is busy. Each picker gets its container ref and an onOpenChange handler.
 */
export function useComposerPopovers({ draftId, isBusy }: { draftId: string | undefined; isBusy: boolean }) {
  const [open, setOpen] = useState<ComposerPopover | null>(null);
  const type = useRef<HTMLDivElement | null>(null), model = useRef<HTMLDivElement | null>(null), parameter = useRef<HTMLDivElement | null>(null);
  const reference = useRef<HTMLDivElement | null>(null), version = useRef<HTMLDivElement | null>(null), shot = useRef<HTMLDivElement | null>(null);
  const refs = useRef<Record<ComposerPopover, RefObject<HTMLDivElement | null>>>({ type, model, parameter, reference, version, shot }).current;
  useEffect(() => { setOpen(null); }, [draftId]);
  useEffect(() => { if (isBusy) setOpen(null); }, [isBusy]);
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      setOpen(resolveOpenPopoverOnPointerDown(open, Boolean(refs[open].current?.contains(event.target))));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(null);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    // The Canvas shell stops keyboard propagation at window capture, so listen on window as well.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, refs]);
  const onOpenChange = (name: ComposerPopover) => (next: boolean) => setOpen(current => (next ? name : current === name ? null : current));
  return { open, refs, onOpenChange };
}
