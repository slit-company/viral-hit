import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import type { EditorOperation } from '@/core/commands/editor-commands';
import { CAPTION_HIGHLIGHT_COLORS, captionWordTimeline } from '@/core/editor/caption-words';
import type { TimelineClip, TimelineDocument } from '@/core/editor/timeline-document';

const COLOR_LABELS: Record<(typeof CAPTION_HIGHLIGHT_COLORS)[number], () => string> = {
  '#FFD60A': () => m['ui.editor.caption_highlight_yellow'](),
  '#A3E635': () => m['ui.editor.caption_highlight_lime'](),
  '#22D3EE': () => m['ui.editor.caption_highlight_cyan'](),
  '#F472B6': () => m['ui.editor.caption_highlight_pink'](),
};

/** Turn spoken-word highlighting on for every caption and show whether this cue's timing is measured. */
export function CaptionHighlightPicker({ document, clip, onEdit }: {
  document: TimelineDocument; clip: TimelineClip; onEdit: (operation: EditorOperation) => void;
}) {
  const current = document.captionHighlight?.toUpperCase() ?? null;
  const measured = captionWordTimeline(clip).measured;
  return <div>
    <span className="mb-2 block text-[10px] font-[520] text-[var(--vh-text-2)]">{m['ui.editor.caption_highlight']()}</span>
    <div role="radiogroup" aria-label={m['ui.editor.caption_highlight']()} className="flex flex-wrap items-center gap-2">
      <Action role="radio" aria-checked={!current} onClick={() => onEdit({ type: 'set_caption_highlight', color: null })}
        className={`vh-secondary !min-h-9 !px-3 !py-1 !text-[11px] ${!current ? 'ring-1 ring-[var(--vh-graph)]' : ''}`}>
        {m['ui.editor.caption_highlight_off']()}
      </Action>
      {CAPTION_HIGHLIGHT_COLORS.map((color) => <Action key={color} role="radio" aria-checked={current === color} aria-label={COLOR_LABELS[color]()} title={COLOR_LABELS[color]()}
        onClick={() => onEdit({ type: 'set_caption_highlight', color })}
        className={`size-9 rounded-full border border-[var(--vh-border)] ${current === color ? 'ring-2 ring-[var(--vh-graph)] ring-offset-2' : ''}`}
        style={{ background: color }} />)}
    </div>
    {current ? <p className="mt-2 text-[11px] leading-relaxed text-[var(--vh-text-2)]">
      {measured ? m['ui.editor.caption_words_measured']() : m['ui.editor.caption_words_estimated']()}
    </p> : null}
  </div>;
}
