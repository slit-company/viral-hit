import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { resolveModelOptions, type ModelOptionsDraft, type ModelOptionValues } from '@/core/generation-providers/model-controls';
import { useWorkspaceModels } from '@/core/workspace-hooks/use-workspace-metadata';

/** The same declared settings form is used by Canvas and Studio; it never starts a generation. */
export function ModelOptions({ modelId, value, disabled, onChange }: {
  modelId: string; value?: ModelOptionsDraft; disabled: boolean; onChange: (value: ModelOptionsDraft) => void;
}) {
  const { data } = useWorkspaceModels();
  const model = data?.models.find(item => item.id === modelId);
  const controls = model?.controls;
  const [open, setOpen] = useState(false), [values, setValues] = useState<ModelOptionValues>({}), [error, setError] = useState('');
  if (!model || !controls?.length) return null;
  const update = (key: string, value: string | number | boolean) => { setValues(current => ({ ...current, [key]: value })); setError(''); };
  const begin = () => {
    setValues({ ...resolveModelOptions(controls, undefined), ...(value?.modelId === modelId ? value.values : {}) });
    setError(''); setOpen(true);
  };
  return <>
    <Action aria-label="Model options" title="Model options" disabled={disabled} className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)]" onClick={begin}><SlidersHorizontal size={16} /></Action>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-32px)] grid-rows-[auto_auto_minmax(0,1fr)_auto]">
        <DialogTitle>Model options</DialogTitle>
        <DialogDescription className="pr-6 break-words">{model.name}. These settings apply to this model's next generation.</DialogDescription>
        <fieldset disabled={disabled} className="min-h-0 space-y-4 overflow-y-auto pr-1">
          {controls.map(control => <label key={control.key} className="block space-y-1.5 text-sm font-medium">
            <span className="break-words">{control.label}</span>
            {control.type === 'select' ? <NativeSelect aria-label={control.label} value={String(values[control.key] ?? '')} onChange={event => update(control.key, event.target.value)}>{control.choices.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</NativeSelect>
              : control.type === 'boolean' ? <NativeSelect aria-label={control.label} value={String(values[control.key])} onChange={event => update(control.key, event.target.value === 'true')}><option value="true">On</option><option value="false">Off</option></NativeSelect>
              : control.type === 'number' ? <Input aria-label={control.label} type="number" min={control.min} max={control.max} step={control.integer ? 1 : 'any'} value={String(values[control.key] ?? '')} onChange={event => update(control.key, event.target.value === '' ? '' : Number(event.target.value))} />
              : control.multiline ? <Textarea aria-label={control.label} maxLength={control.maxLength} value={String(values[control.key] ?? '')} onChange={event => update(control.key, event.target.value)} />
              : <Input aria-label={control.label} maxLength={control.maxLength} value={String(values[control.key] ?? '')} onChange={event => update(control.key, event.target.value)} />}
            {control.description && <span className="block break-words text-xs font-normal leading-5 text-[var(--vh-text-2)]">{control.description}</span>}
          </label>)}
        </fieldset>
        <div>{error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}<DialogFooter>
          <Action className="vh-secondary" disabled={disabled} onClick={() => { setValues(resolveModelOptions(controls, undefined)); setError(''); }}>Reset defaults</Action>
          <Action className="vh-primary" disabled={disabled} onClick={() => { try { onChange({ modelId, values: resolveModelOptions(controls, values) }); setOpen(false); } catch (error) { setError(error instanceof Error ? error.message : 'Check model options'); } }}>Apply options</Action>
        </DialogFooter></div>
      </DialogContent>
    </Dialog>
  </>;
}
