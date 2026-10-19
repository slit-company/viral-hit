import type { Json } from './durable';

export type OutputBinding = { target: string; node: string; pointer: string };
export class BindingError extends Error {}
export function pointerParts(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw new BindingError('Invalid JSON pointer');
  const parts = pointer.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (parts.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new BindingError('Unsafe JSON pointer');
  return parts;
}
function child(value: Json, key: string): Json {
  if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new BindingError(`Missing JSON pointer member: ${key}`);
  if (Array.isArray(value)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) throw new BindingError('Invalid array pointer');
    return value[Number(key)];
  }
  return value[key];
}
export function readPointer(value: Json, pointer: string): Json {
  return pointerParts(pointer).reduce(child, value);
}
export function setPointer(value: Json, pointer: string, replacement: Json): void {
  const parts = pointerParts(pointer);
  if (!parts.length) throw new BindingError('Input root replacement is not supported');
  const key = parts.pop()!;
  const parent = parts.reduce(child, value);
  child(parent, key); // Existing placeholders only; cannot grow arrays or create hidden keys.
  if (Array.isArray(parent)) parent[Number(key)] = structuredClone(replacement);
  else (parent as Record<string, Json>)[key] = structuredClone(replacement);
}
export function validateBindings(input: Json, dependencies: string[], bindings: OutputBinding[]) {
  const targets: string[][] = [];
  for (const binding of bindings) {
    if (!dependencies.includes(binding.node)) throw new BindingError('Output binding must name an explicit dependency');
    pointerParts(binding.pointer);
    const target = pointerParts(binding.target);
    if (!target.length) throw new BindingError('Input root replacement is not supported');
    readPointer(input, binding.target);
    if (targets.some(other => other.slice(0, Math.min(other.length, target.length)).every((part, i) => part === target[i]))) throw new BindingError('Output binding targets overlap');
    targets.push(target);
  }
}
export function bindOutputs(input: Json, dependencies: Record<string, Json>, bindings: OutputBinding[]): Json {
  const resolved = structuredClone(input);
  for (const binding of bindings) {
    if (!Object.hasOwn(dependencies, binding.node)) throw new BindingError('Dependency output is unavailable');
    setPointer(resolved, binding.target, readPointer(dependencies[binding.node], binding.pointer));
  }
  return resolved;
}
