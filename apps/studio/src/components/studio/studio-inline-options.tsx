import { m as uiMessages } from '@/paraglide/messages.js';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
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
  if (!controls?.length) return null;
  const values = {
    ...resolveModelOptions(controls, undefined),
    ...(value?.modelId === modelId ? value.values : {}),
  };
  const controlLabel = (control: ModelControl) => {
    if (control.key === 'resolution' && control.label === 'Resolution') return uiMessages["studio.tools.resolution"]();
    if (control.key === 'generate_audio' && control.label === 'Generate audio') return uiMessages["studio.controls.generate_audio"]();
    if (control.key === 'enhance_prompt' && control.label === 'Enhance prompt') return uiMessages["studio.controls.enhance_prompt"]();
    if (control.key === 'quality' && control.label === 'Quality') return uiMessages["studio.tools.quality"]();
    return control.label;
  };
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
                  {choice.label}
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
