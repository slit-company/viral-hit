import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** SEED confirmation dialog. The compact variant keeps a tighter layout. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  loading = false,
  variant = 'default',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  variant?: 'default' | 'compact';
}) {
  async function handleConfirm() {
    await onConfirm();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={
          variant === 'compact'
            ? 'rounded-[22px] border border-[var(--vh-border)] bg-[var(--vh-surface)] p-6 text-[var(--vh-text-1)] ring-0 shadow-none sm:max-w-[420px] [&_[data-slot=dialog-close]]:text-[var(--vh-text-2)]'
            : 'sm:max-w-[420px]'
        }
      >
        <DialogHeader>
          <DialogTitle
            className={
              variant === 'compact'
                ? 'vh-product-display text-[17px] font-semibold tracking-[-0.02em] text-[var(--vh-text-1)]'
                : 'text-[15px] font-semibold text-foreground'
            }
          >
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription
              className={
                variant === 'compact'
                  ? 'text-[13px] leading-6 text-[var(--vh-text-2)]'
                  : 'text-[13px] leading-6'
              }
            >
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <DialogFooter
          className={
            variant === 'compact'
              ? 'mt-1 flex-row justify-end gap-2 rounded-none border-0 bg-transparent p-0'
              : 'mt-1'
          }
        >
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => onOpenChange(false)}
            className={
              variant === 'compact'
                ? 'h-10 rounded-[var(--vh-radius-sm)] border-[var(--vh-border)] bg-transparent px-4 text-[13px] font-medium text-[var(--vh-text-2)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]'
                : 'h-10 px-4'
            }
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            disabled={loading}
            onClick={() => void handleConfirm()}
            className={cn(
              'h-10 px-4 text-[13px] font-semibold',
              variant === 'compact' &&
                'rounded-[var(--vh-radius-sm)] bg-red-500 text-[var(--vh-text-1)] shadow-none hover:bg-red-600'
            )}
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              </>
            ) : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
