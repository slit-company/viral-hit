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
  const update = (key: string, next: string | number | boolean) =>
    onChange({ modelId, values: { ...values, [key]: next } });
  return (
    <fieldset
      disabled={disabled}
      className="grid min-w-0 gap-3"
      aria-label="모델 세부 설정"
    >
      <legend className="mb-3 text-xs font-semibold">세부 설정</legend>
      {controls.map((control) => (
        <label
          key={control.key}
          className="block min-w-0 space-y-1.5 text-xs text-[var(--vh-text-2)]"
        >
          <span>{control.label}</span>
          {control.type === 'select' ? (
            <NativeSelect
              aria-label={control.label}
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
              aria-label={control.label}
              value={String(values[control.key])}
              onChange={(event) =>
                update(control.key, event.target.value === 'true')
              }
            >
              <option value="true">켜기</option>
              <option value="false">끄기</option>
            </NativeSelect>
          ) : control.type === 'number' ? (
            <Input
              aria-label={control.label}
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
              aria-label={control.label}
              maxLength={control.maxLength}
              value={String(values[control.key] ?? '')}
              onChange={(event) => update(control.key, event.target.value)}
            />
          ) : (
            <Input
              aria-label={control.label}
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
