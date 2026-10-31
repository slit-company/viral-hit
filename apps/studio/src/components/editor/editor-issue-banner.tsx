import { Action } from '@/components/base/action';
import type { EditorOperation } from '@/core/commands/editor-commands';
import type { TimelineDocument } from '@/core/editor/timeline-document';
import { trailingGapFix } from '@/core/editor/timeline-gap-fix';

/** Export and edit problems, with a one-click repair when the right fix is unambiguous. */
export function EditorIssueBanner({ error, document, fixLabel, onFix }: {
  error: string | null; document: TimelineDocument; fixLabel: string; onFix: (operation: EditorOperation) => void;
}) {
  if (!error) return null;
  const fix = trailingGapFix(document);
  return <div role="alert" className="absolute bottom-4 left-1/2 z-50 flex max-w-xl -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 shadow-lg">
    <span className="min-w-0 flex-1">{error}</span>
    {fix && <Action type="button" className="vh-secondary shrink-0" onClick={() => onFix(fix)}>{fixLabel}</Action>}
  </div>;
}
