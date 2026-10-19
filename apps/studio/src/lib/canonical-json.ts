export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Stable object-key ordering; arrays keep their authored order. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite input');
  return JSON.stringify(value);
}
