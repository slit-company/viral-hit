import * as React from 'react';
import { ContentDialog, Portal } from '@seed-design/react';
import { X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Action } from '@/components/base/action';

// SEED uses SEED dialogs for focus trapping, Escape, backdrop and focus return.
function Dialog(props: React.ComponentProps<typeof ContentDialog.Root>) {
  return <ContentDialog.Root {...props} />;
}
function DialogTrigger(props: React.ComponentProps<typeof ContentDialog.Trigger>) {
  return <ContentDialog.Trigger data-slot="dialog-trigger" {...props} />;
}
function DialogClose(props: React.ComponentProps<typeof ContentDialog.CloseButton>) {
  return <ContentDialog.CloseButton data-slot="dialog-close" {...props} />;
}
function DialogPortal(props: React.ComponentProps<typeof Portal>) { return <Portal {...props} />; }
function DialogOverlay({ className, ...props }: React.ComponentProps<typeof ContentDialog.Backdrop>) {
  return <ContentDialog.Backdrop data-slot="dialog-overlay" className={cn('absolute inset-0 z-0 bg-black/25', className)} {...props} />;
}
function DialogContent({ className, children, showCloseButton = true, showOverlay = true, ...props }: React.ComponentProps<typeof ContentDialog.Content> & { showCloseButton?: boolean; showOverlay?: boolean }) {
  return <DialogPortal>
    <ContentDialog.Positioner className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {showOverlay && <DialogOverlay />}
      <ContentDialog.Content data-slot="dialog-content" className={cn('vh-dialog break-normal relative z-10 grid w-full max-w-lg gap-4 rounded-3xl border border-border p-6 text-sm text-foreground outline-none', className)} {...props}>
        {children}
        {showCloseButton && <ContentDialog.CloseButton asChild><Action data-slot="dialog-close" aria-label="Close" className="absolute right-3 top-3 m-0 grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X size={18} /></Action></ContentDialog.CloseButton>}
      </ContentDialog.Content>
    </ContentDialog.Positioner>
  </DialogPortal>;
}
function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) { return <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />; }
function DialogFooter({ className, showCloseButton = false, children, ...props }: React.ComponentProps<'div'> & { showCloseButton?: boolean }) {
  return <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end', className)} {...props}>{children}{showCloseButton && <DialogClose asChild><Action className="vh-secondary">Close</Action></DialogClose>}</div>;
}
function DialogTitle({ className, ...props }: React.ComponentProps<typeof ContentDialog.Title>) { return <ContentDialog.Title data-slot="dialog-title" className={cn('text-lg font-bold leading-snug', className)} {...props} />; }
function DialogDescription({ className, ...props }: React.ComponentProps<typeof ContentDialog.Description>) { return <ContentDialog.Description data-slot="dialog-description" className={cn('text-sm leading-relaxed text-muted-foreground break-normal', className)} {...props} />; }
export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger };
