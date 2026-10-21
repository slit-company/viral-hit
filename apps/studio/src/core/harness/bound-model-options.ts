import { resolveModelOptions, type ModelControl } from '../generation-providers/model-controls';
import { pointerParts, type OutputBinding } from './bindings';

/** Normalize inert placeholders only at explicitly bound option targets; final values are validated before intent allocation. */
export function prepareBoundModelOptions(controls: readonly ModelControl[] | undefined, raw: unknown, bindings: readonly OutputBinding[]) {
  const targets = bindings.map(binding => pointerParts(binding.target)).filter(parts => parts[0] === 'parameters' && parts[1] === 'provider_options');
  if (!targets.length) return resolveModelOptions(controls, raw);
  if (targets.some(parts => parts.length === 2)) {
    if (raw === undefined) throw Error('Model option binding requires an existing placeholder');
    if (targets.length !== 1) throw Error('Model option binding targets overlap');
    return resolveModelOptions(controls, undefined);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Bound model options require an object with explicit placeholders');
  const fixed = { ...raw };
  for (const parts of targets) {
    if (parts.length !== 3) throw Error('Bind a declared model option directly, not a nested member');
    const control = controls?.find(control => control.key === parts[2]);
    if (!control) throw Error('Unknown bound model option: ' + parts[2]);
    if (!Object.hasOwn(raw, control.key)) throw Error('Model option binding requires an existing placeholder: ' + control.key);
    Object.assign(fixed, { [control.key]: control.default });
  }
  return resolveModelOptions(controls, fixed);
}
