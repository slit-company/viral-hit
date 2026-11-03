import { m as uiMessages } from '@/paraglide/messages.js';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { localizeChoiceLabel, localizeControlLabel } from '@/components/generation-providers/control-label';
import { SuggestedTextInput } from '@/components/generation-providers/suggested-text-input';
import { useQuery } from '@tanstack/react-query';
import { apiJsonGet } from '@/lib/api-client';
import { identitySuggestions } from '@/core/characters/identities';
import type { Character } from '@/core/characters/contract';
import {
  resolveModelOptions,
  type ModelControl,
  type ModelOptionsDraft,
} from '@/core/generation-providers/model-controls';

export function StudioInlineOptions({
  modelId,
  controls,
  value,
  disabled,
  onChange,
}: {
  modelId: string;
  controls?: ModelControl[];
  value?: ModelOptionsDraft;
  disabled: boolean;
  onChange: (value: ModelOptionsDraft) => void;
}) {
  // Settings that take a trained identity, such as a Soul ID, offer the character library's.
  const wantsIdentity = Boolean(controls?.some(control => control.type === 'string' && control.identity));
  const characters = useQuery({ queryKey: ['characters', 'identities'], queryFn: () => apiJsonGet<{ characters: Character[] }>('/api/app/characters').then(result => result.characters), enabled: wantsIdentity, staleTime: 30_000 });
  if (!controls?.length) return null;
  const suggestionsFor = (control: ModelControl) => control.type !== 'string' ? undefined
    : control.identity ? [...identitySuggestions(characters.data ?? [], control.identity), ...(control.suggestions ?? [])] : control.suggestions;
  const values = {
    ...resolveModelOptions(controls, undefined),
    ...(value?.modelId === modelId ? value.values : {}),
  };
  const controlLabel = (control: ModelControl) => localizeControlLabel(control.label);
  const update = (key: string, next: string | number | boolean) =>
    onChange({ modelId, values: { ...values, [key]: next } });
  return (
    <fieldset
      disabled={disabled}
      className="grid min-w-0 gap-3"
      aria-label={uiMessages["studio.tools.model_options"]()}
    >
      <legend className="mb-3 text-xs font-semibold">{uiMessages["studio.tools.options"]()}</legend>
      {controls.map((control) => (
        <label
          key={control.key}
          className="block min-w-0 space-y-1.5 text-xs text-[var(--vh-text-2)]"
        >
          <span>{controlLabel(control)}</span>
          {control.type === 'select' ? (
            <NativeSelect
              aria-label={controlLabel(control)}
              value={String(values[control.key])}
              onChange={(event) => update(control.key, event.target.value)}
            >
              {control.choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {localizeChoiceLabel(choice.label)}
                </option>
              ))}
            </NativeSelect>
          ) : control.type === 'boolean' ? (
            <NativeSelect
              aria-label={controlLabel(control)}
              value={String(values[control.key])}
              onChange={(event) =>
                update(control.key, event.target.value === 'true')
              }
            >
              <option value="true">{uiMessages["studio.tools.on"]()}</option>
              <option value="false">{uiMessages["studio.tools.off"]()}</option>
            </NativeSelect>
          ) : control.type === 'number' ? (
            <Input
              aria-label={controlLabel(control)}
              type="number"
              min={control.min}
              max={control.max}
              step={control.integer ? 1 : 'any'}
              value={String(values[control.key] ?? '')}
              onChange={(event) =>
                update(
                  control.key,
                  event.target.value === '' ? '' : Number(event.target.value),
                )
              }
            />
          ) : suggestionsFor(control)?.length ? (
            <SuggestedTextInput
              label={controlLabel(control)}
              value={String(values[control.key] ?? '')}
              suggestions={suggestionsFor(control)!}
              noneLabel={control.type === 'string' && control.identity ? uiMessages['ui.identity.none']() : undefined}
              maxLength={control.maxLength}
              onChange={(next) => update(control.key, next)}
            />
          ) : control.multiline ? (
            <Textarea
              aria-label={controlLabel(control)}
              maxLength={control.maxLength}
              value={String(values[control.key] ?? '')}
              onChange={(event) => update(control.key, event.target.value)}
            />
          ) : (
            <Input
              aria-label={controlLabel(control)}
              maxLength={control.maxLength}
              value={String(values[control.key] ?? '')}
              onChange={(event) => update(control.key, event.target.value)}
            />
          )}
          {control.description && (
            <span className="block text-[11px] leading-5">
              {control.description}
            </span>
          )}
        </label>
      ))}
    </fieldset>
  );
}
