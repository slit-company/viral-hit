import { TextField } from '@seed-design/react';
import { NativeSelect } from '@/components/ui/native-select';
import type { JsonValue } from '@/lib/canonical-json';

export function metadataProperties(schema: Record<string, JsonValue>) {
  return schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? Object.entries(schema.properties).filter((entry): entry is [string, Record<string, JsonValue>] => Boolean(entry[1] && typeof entry[1] === 'object' && !Array.isArray(entry[1]))) : [];
}
export function metadataDefaults(schema: Record<string, JsonValue>) {
  return Object.fromEntries(metadataProperties(schema).filter(([, property]) => property.default !== undefined).map(([id, property]) => [id, property.default]));
}
export function needsJsonEditor(schema: Record<string, JsonValue>) {
  return metadataProperties(schema).some(([, property]) => !['string', 'number', 'integer', 'boolean'].includes(String(property.type)));
}
export function InstalledMetadataFields({ schema, values, onChange }: { schema: Record<string, JsonValue>; values: Record<string, JsonValue>; onChange: (id: string, value: JsonValue) => void }) {
  return <>{metadataProperties(schema).map(([id, property]) => {
    const label = typeof property.title === 'string' ? property.title : id;
    const required = Array.isArray(schema.required) && schema.required.includes(id), value = values[id] ?? '';
    const number = property.type === 'number' || property.type === 'integer';
    return <div key={id} className="space-y-2"><label htmlFor={'publication-metadata-' + id} className="block text-sm font-medium">{label}{required ? ' *' : ''}</label>
      {Array.isArray(property.enum) ? <NativeSelect id={'publication-metadata-' + id} aria-label={label} value={JSON.stringify(value)} required={required} onChange={event => onChange(id, JSON.parse(event.target.value))}><option value={JSON.stringify('')}>Choose…</option>{property.enum.map(option => <option key={JSON.stringify(option)} value={JSON.stringify(option)}>{String(option)}</option>)}</NativeSelect>
        : property.type === 'boolean' ? <input id={'publication-metadata-' + id} type="checkbox" checked={value === true} onChange={event => onChange(id, event.target.checked)} />
        : <TextField.Root className="vh-field"><TextField.Input id={'publication-metadata-' + id} aria-label={label} type={number ? 'number' : 'text'} value={typeof value === 'string' || typeof value === 'number' ? value : ''} required={required} min={typeof property.minimum === 'number' ? property.minimum : undefined} max={typeof property.maximum === 'number' ? property.maximum : undefined} step={property.type === 'integer' ? 1 : 'any'} maxLength={typeof property.maxLength === 'number' ? property.maxLength : 16000} onChange={event => onChange(id, number && event.target.value !== '' ? Number(event.target.value) : event.target.value)} /></TextField.Root>}
      {typeof property.description === 'string' && <p className="text-xs leading-5 text-[var(--vh-text-2)]">{property.description}</p>}
    </div>;
  })}</>;
}
