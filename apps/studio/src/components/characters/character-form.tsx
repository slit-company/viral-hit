import { useEffect, useState } from 'react';
import { TextField } from '@seed-design/react';
import { ImagePlus } from 'lucide-react';
import { Action } from '@/components/base/action';
import { characterKinds, referenceRoles, type CharacterProfile } from '@/core/characters/contract';
import type { ImageDraft } from './use-characters';

const kindLabel: Record<(typeof characterKinds)[number], string> = { person: 'Person', illustrated: 'Illustrated', mascot: 'Mascot', product: 'Product', other: 'Other' };
export const roleLabel: Record<(typeof referenceRoles)[number], string> = { canonical: 'Main image', angle: 'Other angle', expression: 'Expression', outfit: 'Outfit', detail: 'Detail' };
const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
const fieldClass = 'w-full rounded-xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-2.5 text-sm';

export function emptyProfile(): CharacterProfile { return { name: '', kind: 'person', description: '', invariants: [], forbidden: [], providerIdentities: [] }; }

function Text({ id, label, hint, value, onChange, multiline }: { id: string; label: string; hint?: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return <div className="space-y-1.5">
    <label htmlFor={id} className="block text-xs text-[var(--vh-text-2)]">{label}</label>
    <TextField.Root className="vh-field">{multiline
      ? <TextField.Textarea id={id} autoresize={false} value={value} maxLength={2000} onChange={event => onChange(event.target.value)} className="resize-y" />
      : <TextField.Input id={id} type="text" value={value} maxLength={120} onChange={event => onChange(event.target.value)} />}</TextField.Root>
    {hint && <p className="text-[11px] text-[var(--vh-text-2)]">{hint}</p>}
  </div>;
}

/** Profile fields shared by creating and editing; image handling is separate. */
export function CharacterProfileFields({ value, onChange }: { value: CharacterProfile; onChange: (value: CharacterProfile) => void }) {
  const [keep, setKeep] = useState(value.invariants.join('\n'));
  const [never, setNever] = useState(value.forbidden.join('\n'));
  const soul = value.providerIdentities.find(item => item.provider === 'higgsfield-soul')?.referenceId ?? '';
  useEffect(() => { setKeep(value.invariants.join('\n')); setNever(value.forbidden.join('\n')); }, [value.invariants, value.forbidden]);
  return <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
      <Text id="character-name" label="Name" value={value.name} onChange={name => onChange({ ...value, name })} />
      <div className="space-y-1.5"><label htmlFor="character-kind" className="block text-xs text-[var(--vh-text-2)]">Type</label>
        <select id="character-kind" value={value.kind} onChange={event => onChange({ ...value, kind: event.target.value as CharacterProfile['kind'] })} className={fieldClass + ' h-[50px]'}>{characterKinds.map(kind => <option key={kind} value={kind}>{kindLabel[kind]}</option>)}</select></div>
    </div>
    <Text id="character-description" label="Who or what it is" value={value.description} onChange={description => onChange({ ...value, description })} multiline />
    <Text id="character-keep" label="Always keep" hint="One per line, for example: white chest patch, round glasses." value={keep} onChange={text => { setKeep(text); onChange({ ...value, invariants: lines(text).slice(0, 24) }); }} multiline />
    <Text id="character-never" label="Never change" hint="One per line, for example: extra fingers, different logo." value={never} onChange={text => { setNever(text); onChange({ ...value, forbidden: lines(text).slice(0, 24) }); }} multiline />
    <Text id="character-voice" label="Voice direction (optional)" value={value.voice?.direction ?? ''} onChange={direction => onChange({ ...value, voice: direction.trim() ? { ...value.voice, direction } : undefined })} />
    <Text id="character-soul" label="Higgsfield Soul ID (optional)" hint="Used by the Higgsfield extension for identity-faithful generation." value={soul} onChange={referenceId => onChange({ ...value, providerIdentities: [...value.providerIdentities.filter(item => item.provider !== 'higgsfield-soul'), ...(referenceId.trim() ? [{ provider: 'higgsfield-soul', referenceId: referenceId.trim() }] : [])] })} />
  </div>;
}

/** Chooses images and their roles; the first image becomes the main image unless another is chosen. */
export function ImagePicker({ images, onChange, allowCanonical = true }: { images: ImageDraft[]; onChange: (images: ImageDraft[]) => void; allowCanonical?: boolean }) {
  useEffect(() => () => images.forEach(image => URL.revokeObjectURL(image.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const roles = referenceRoles.filter(role => allowCanonical || role !== 'canonical');
  function add(files: FileList | null) {
    const next = [...images, ...[...(files ?? [])].filter(file => /^image\/(png|jpeg|webp)$/.test(file.type)).map(file => ({ file, role: 'angle' as const, preview: URL.createObjectURL(file) }))].slice(0, 10);
    if (allowCanonical && !next.some(image => image.role === 'canonical') && next[0]) next[0] = { ...next[0], role: 'canonical' };
    onChange(next);
  }
  function setRole(index: number, role: ImageDraft['role']) {
    onChange(images.map((image, n) => n === index ? { ...image, role } : role === 'canonical' && image.role === 'canonical' ? { ...image, role: 'angle' } : image));
  }
  return <div className="space-y-2">
    <p id="character-images-hint" className="text-xs text-[var(--vh-text-2)]">Reference images · PNG, JPEG or WebP, up to 20 MB each</p>
    <label className="vh-secondary cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ink)]"><ImagePlus size={15} aria-hidden="true" />Choose images
      <input type="file" multiple accept="image/png,image/jpeg,image/webp" aria-describedby="character-images-hint" onChange={event => { add(event.target.files); event.target.value = ''; }} className="sr-only" /></label>
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">{images.map((image, index) => <li key={image.preview} className="space-y-1.5 rounded-xl border border-[var(--vh-border)] p-2">
      <img src={image.preview} alt={image.file.name} className="aspect-square w-full rounded-lg object-cover" />
      <select aria-label={'Role for ' + image.file.name} value={image.role} onChange={event => setRole(index, event.target.value as ImageDraft['role'])} className={fieldClass + ' p-1.5 text-xs'}>{roles.map(role => <option key={role} value={role}>{roleLabel[role]}</option>)}</select>
      <Action onClick={() => onChange(images.filter((_, n) => n !== index))} className="text-[11px] text-[var(--vh-text-2)]">Remove</Action>
    </li>)}</ul>
  </div>;
}

