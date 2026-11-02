import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

const CUSTOM = '__custom__';

/** A text option with named presets, such as a voice library: pick a name or enter your own value. */
export function SuggestedTextInput({ label, value, suggestions, maxLength, onChange }: {
  label: string; value: string; suggestions: readonly { value: string; label: string }[]; maxLength: number; onChange: (value: string) => void;
}) {
  const known = suggestions.some(item => item.value === value);
  const [custom, setCustom] = useState(!known);
  const typing = custom || !known;
  return <span className="block space-y-2">
    <NativeSelect aria-label={label} value={typing ? CUSTOM : value} onChange={event => {
      const next = event.target.value;
      setCustom(next === CUSTOM);
      if (next !== CUSTOM) onChange(next);
    }}>
      {suggestions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      <option value={CUSTOM}>{uiMessages["studio.controls.custom_value"]()}</option>
    </NativeSelect>
    {typing && <Input aria-label={uiMessages["studio.controls.custom_value_for"]({ label })} maxLength={maxLength} value={value} onChange={event => onChange(event.target.value)} />}
  </span>;
}
