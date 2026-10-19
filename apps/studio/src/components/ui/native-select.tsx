import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Native keyboard/mobile picker using the shared input tokens. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={cn('h-10 w-full min-w-0 rounded-lg border border-input bg-[var(--vh-surface)] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', className)} />;
}
