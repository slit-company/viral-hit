import { m as uiMessages } from '@/paraglide/messages.js';
import { REFERENCE_MEDIA_KINDS } from '@/core/generation-providers/reference-inputs';
import { cn } from '@/lib/utils';

type Kind = (typeof REFERENCE_MEDIA_KINDS)[number];
const label = (kind: Kind) => kind === 'image' ? uiMessages["studio.tools.image"]() : kind === 'video' ? uiMessages["studio.tools.video"]() : uiMessages["studio.media.audio_acda"]();
function amount(kind: Kind, count: number, min: number, max: number) {
  const name = label(kind);
  return min === max ? uiMessages["studio.media.count_exact"]({ kind: name, count, max }) : min > 0 ? uiMessages["studio.media.count_range"]({ kind: name, count, min, max }) : uiMessages["studio.media.count_optional"]({ kind: name, count, max });
}

/**
 * What the selected model needs, per kind of file. Before anything is chosen it reads as a guide; the
 * out-of-range warning appears only once a choice actually falls outside what the model accepts.
 */
export function SourceRequirements({ limits, counts, selected }: { limits: Record<Kind, { min: number; max: number }>; counts: Record<Kind, number>; selected: number }) {
  const kinds = REFERENCE_MEDIA_KINDS.filter(kind => limits[kind].max || counts[kind]);
  if (!kinds.length) return null;
  const fits = (kind: Kind) => counts[kind] >= limits[kind].min && counts[kind] <= limits[kind].max;
  const valid = REFERENCE_MEDIA_KINDS.every(fits), needed = REFERENCE_MEDIA_KINDS.some(kind => limits[kind].min > 0);
  return <div className="space-y-1 text-xs leading-5 text-[var(--vh-text-2)]">
    <p>{kinds.map((kind, index) => <span key={kind} className={cn(!fits(kind) && 'font-medium text-amber-700')}>{index > 0 && ' · '}{amount(kind, counts[kind], limits[kind].min, limits[kind].max)}</span>)}</p>
    {!valid && (selected > 0
      ? <p role="status">{uiMessages["studio.media.selected_sources_do_not_match_this_model_open_sources_to_review_required_counts_existing_files_are_r_33cc"]()}</p>
      : needed && <p>{uiMessages["studio.media.needs_sources"]()}</p>)}
  </div>;
}
