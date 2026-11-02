import { m as uiMessages } from '@/paraglide/messages.js';
import { Textarea } from '@/components/ui/textarea';

/** The prompt box of a Studio composer: a labelled field in the side panel, a bare box in the floating composer. */
export function StudioPromptField({ label, placeholder, value, disabled, panel, optional = false, onChange }: {
  label: string; placeholder: string; value: string; disabled: boolean; panel: boolean; optional?: boolean; onChange: (value: string) => void;
}) {
  if (!panel) return <textarea aria-label={label} placeholder={placeholder} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="h-20 w-full resize-none bg-transparent text-sm leading-6 text-[var(--vh-text-1)] outline-none placeholder:text-[var(--vh-text-2)]" />;
  return <label className="block space-y-2">
    <span className="text-xs font-semibold">{label}{optional && <StudioPromptOptional />}</span>
    <Textarea aria-label={label} placeholder={placeholder} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="min-h-32 resize-y text-sm leading-6" />
  </label>;
}

/** Marks a prompt the selected model can run without. */
export function StudioPromptOptional() {
  return <span className="font-normal text-[var(--vh-text-3)]"> · {uiMessages["studio.media.prompt_optional"]()}</span>;
}

/** Replaces the prompt box for models that work from their sources alone. */
export function StudioPromptNotNeeded() {
  return <p role="note" className="rounded-xl bg-[var(--vh-control)] px-3 py-2.5 text-xs leading-5 text-[var(--vh-text-2)]">{uiMessages["studio.media.prompt_not_needed"]()}</p>;
}
