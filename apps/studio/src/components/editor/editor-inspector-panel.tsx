import { useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const query = '(max-width: 639px)';
const subscribe = (listener: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
export function useInspectorPanel() {
  const narrow = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  return { narrow, open: narrow ? mobileOpen : desktopOpen, setOpen: (narrow ? setMobileOpen : setDesktopOpen) as Dispatch<SetStateAction<boolean>> };
}

/** The same inspector content uses SEED's focus-managed dialog on phones. */
export function EditorInspectorPanel({ open, narrow, setOpen, title, children }: {
  open: boolean; narrow: boolean; setOpen: (value: boolean) => void; title: string; children: ReactNode;
}) {
  if (narrow) return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent showCloseButton={false} className="!flex h-[calc(100dvh-32px)] max-h-[900px] flex-col gap-0 overflow-hidden !p-0 bg-[var(--vh-surface)] text-[var(--vh-text-1)]">
      <DialogTitle className="sr-only">{title}</DialogTitle>
      {children}
    </DialogContent>
  </Dialog>;
  return <aside className={open ? 'hidden w-[300px] shrink-0 flex-col border-l border-[var(--vh-border)] bg-[var(--vh-surface)] sm:flex xl:w-[336px]' : 'hidden'}>{children}</aside>;
}
