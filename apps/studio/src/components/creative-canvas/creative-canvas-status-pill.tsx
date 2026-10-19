import { cn } from '@/lib/utils';
import { AlertCircle, Sparkles } from 'lucide-react';
import { creativeCanvasPanelClassName } from './creative-canvas-theme';

export function CreativeCanvasStatusPill({
  message,
  isError,
}: {
  message: string;
  isError: boolean;
}) {
  return (
    <section
      className={`pointer-events-auto absolute left-1/2 top-5 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm ${creativeCanvasPanelClassName}`}
    >
      {isError ? (
        <AlertCircle className="size-3.5 text-[var(--creative-canvas-error)]" />
      ) : (
        <Sparkles className="size-3.5 text-[var(--vh-accent)]" />
      )}
      <span
        className={cn(
          'vh-product-display text-[13px] font-medium tracking-[-0.02em]',
          isError
            ? 'text-[var(--creative-canvas-error)]'
            : 'text-[var(--vh-accent)]'
        )}
      >
        {message}
      </span>
    </section>
  );
}
