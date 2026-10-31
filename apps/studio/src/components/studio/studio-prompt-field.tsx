import { Textarea } from '@/components/ui/textarea';

/** The prompt box of a Studio composer: a labelled field in the side panel, a bare box in the floating composer. */
export function StudioPromptField({ label, placeholder, value, disabled, panel, onChange }: {
  label: string; placeholder: string; value: string; disabled: boolean; panel: boolean; onChange: (value: string) => void;
}) {
  if (!panel) return <textarea aria-label={label} placeholder={placeholder} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="h-20 w-full resize-none bg-transparent text-sm leading-6 text-[var(--vh-text-1)] outline-none placeholder:text-[var(--vh-text-2)]" />;
  return <label className="block space-y-2">
    <span className="text-xs font-semibold">{label}</span>
    <Textarea aria-label={label} placeholder={placeholder} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="min-h-32 resize-y text-sm leading-6" />
  </label>;
}
