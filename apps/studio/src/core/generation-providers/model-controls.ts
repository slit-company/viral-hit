import { z } from 'zod';

const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value), 'Reserved option key');
const common = { key, label: z.string().trim().min(1).max(80), description: z.string().trim().max(300).optional() };
export const modelControlSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('string'), default: z.string().max(4000), maxLength: z.number().int().min(1).max(4000), multiline: z.boolean().optional() }).strict(),
  z.object({ ...common, type: z.literal('number'), default: z.number().finite(), min: z.number().finite(), max: z.number().finite(), integer: z.boolean().optional() }).strict(),
  z.object({ ...common, type: z.literal('boolean'), default: z.boolean() }).strict(),
  z.object({ ...common, type: z.literal('select'), default: z.string().max(120), choices: z.array(z.object({ value: z.string().min(1).max(120), label: z.string().min(1).max(80) }).strict()).min(1).max(32) }).strict(),
]).superRefine((control, ctx) => {
  if (control.type === 'number' && (control.min > control.max || control.default < control.min || control.default > control.max || (control.integer && !Number.isSafeInteger(control.default)))) ctx.addIssue({ code: 'custom', message: 'Number defaults must fit their bounds and integer constraint' });
  if (control.type === 'string' && control.default.length > control.maxLength) ctx.addIssue({ code: 'custom', message: 'Default text exceeds maxLength' });
  if (control.type === 'select' && (!control.choices.some(item => item.value === control.default) || new Set(control.choices.map(item => item.value)).size !== control.choices.length)) ctx.addIssue({ code: 'custom', message: 'Select values must be distinct and include the default' });
});
export const modelControlsSchema = z.array(modelControlSchema).min(1).max(16).refine(controls => new Set(controls.map(item => item.key)).size === controls.length, 'Control keys must be distinct');
export type ModelControl = z.infer<typeof modelControlSchema>;
export const modelOptionValuesSchema = z.record(key, z.union([z.string().max(4000), z.number().finite(), z.boolean()])).refine(value => Object.keys(value).length <= 16, 'At most 16 options');
export type ModelOptionValues = z.infer<typeof modelOptionValuesSchema>;
export const modelOptionsDraftSchema = z.object({ modelId: z.string().min(1).max(200), values: modelOptionValuesSchema }).strict();
export type ModelOptionsDraft = z.infer<typeof modelOptionsDraftSchema>;

/** No coercion or undeclared keys. Shared by form validation and both server admission boundaries. */
export function resolveModelOptions(controls: readonly ModelControl[] | undefined, raw: unknown): ModelOptionValues {
  if (raw && typeof raw === 'object') for (const name of Object.keys(raw)) key.parse(name);
  const values = modelOptionValuesSchema.parse(raw === undefined ? {} : raw);
  const definitions = controls ?? [];
  for (const name of Object.keys(values)) if (!definitions.some(item => item.key === name)) throw Error('Unknown model option: ' + name);
  return Object.fromEntries(definitions.map(control => {
    const value = Object.hasOwn(values, control.key) ? values[control.key] : control.default;
    const valid = control.type === 'boolean' ? typeof value === 'boolean'
      : control.type === 'string' ? typeof value === 'string' && value.length <= control.maxLength
      : control.type === 'select' ? typeof value === 'string' && control.choices.some(item => item.value === value)
      : typeof value === 'number' && Number.isFinite(value) && value >= control.min && value <= control.max && (!control.integer || Number.isSafeInteger(value));
    if (!valid) throw Error('Invalid model option: ' + control.label);
    return [control.key, value];
  }));
}
export function draftModelOptions(draft: { modelId: string; modelOptions?: ModelOptionsDraft }) {
  return draft.modelOptions?.modelId === draft.modelId ? { provider_options: draft.modelOptions.values } : {};
}
