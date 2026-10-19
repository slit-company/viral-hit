import { ActionButton, type ActionButtonProps } from '@seed-design/react';
import type { Ref } from 'react';
import { cn } from '@/lib/utils';

/** The SEED interaction primitive, sized for a desktop creative workspace. */
export function Action({ className, ref, type = 'button', ...props }: ActionButtonProps & { ref?: Ref<HTMLButtonElement> }) {
  return <ActionButton ref={ref} type={type} variant="ghost" size="small" className={cn('vh-action', className)} {...props} />;
}
