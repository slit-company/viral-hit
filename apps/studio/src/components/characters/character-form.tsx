import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useState } from 'react';
import { TextField } from '@seed-design/react';
import { ImagePlus } from 'lucide-react';
import { Action } from '@/components/base/action';
import { characterKinds, referenceRoles, type CharacterProfile } from '@/core/characters/contract';
import type { ImageDraft } from './use-characters';

const kindLabel: Record<(typeof characterKinds)[number], string> = { get person() { return uiMessages["ui.characters.person"](); }, get illustrated() { return uiMessages["ui.characters.illustrated"](); }, get mascot() { return uiMessages["ui.characters.mascot"](); }, get product() { return uiMessages["ui.characters.product"](); }, get other() { return uiMessages["ui.characters.other"](); } };
export const roleLabel: Record<(typeof referenceRoles)[number], string> = { get canonical() { return uiMessages["ui.characters.main_image"](); }, get angle() { return uiMessages["ui.characters.other_angle"](); }, get expression() { return uiMessages["ui.characters.expression"](); }, get outfit() { return uiMessages["ui.characters.outfit"](); }, get detail() { return uiMessages["ui.characters.detail"](); } };
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
      <Text id="character-name" label={uiMessages["ui.characters.name"]()} value={value.name} onChange={name => onChange({ ...value, name })} />
      <div className="space-y-1.5"><label htmlFor="character-kind" className="block text-xs text-[var(--vh-text-2)]">{uiMessages["ui.characters.type"]()}</label>
        <select id="character-kind" value={value.kind} onChange={event => onChange({ ...value, kind: event.target.value as CharacterProfile['kind'] })} className={fieldClass + ' h-[50px]'}>{characterKinds.map(kind => <option key={kind} value={kind}>{kindLabel[kind]}</option>)}</select></div>
    </div>
    <Text id="character-description" label={uiMessages["ui.characters.who_or_what_it_is"]()} value={value.description} onChange={description => onChange({ ...value, description })} multiline />
    <Text id="character-keep" label={uiMessages["ui.characters.always_keep"]()} hint={uiMessages["ui.characters.one_per_line_for_example_white_chest_patch_round_glasses"]()} value={keep} onChange={text => { setKeep(text); onChange({ ...value, invariants: lines(text).slice(0, 24) }); }} multiline />
    <Text id="character-never" label={uiMessages["ui.characters.never_change"]()} hint={uiMessages["ui.characters.one_per_line_for_example_extra_fingers_different_logo"]()} value={never} onChange={text => { setNever(text); onChange({ ...value, forbidden: lines(text).slice(0, 24) }); }} multiline />
    <Text id="character-voice" label={uiMessages["ui.characters.voice_direction_optional"]()} value={value.voice?.direction ?? ''} onChange={direction => onChange({ ...value, voice: direction.trim() ? { ...value.voice, direction } : undefined })} />
    <Text id="character-soul" label={uiMessages["ui.characters.higgsfield_soul_id_optional"]()} hint={uiMessages["ui.characters.used_by_the_higgsfield_extension_for_identity_faithful_generation"]()} value={soul} onChange={referenceId => onChange({ ...value, providerIdentities: [...value.providerIdentities.filter(item => item.provider !== 'higgsfield-soul'), ...(referenceId.trim() ? [{ provider: 'higgsfield-soul', referenceId: referenceId.trim() }] : [])] })} />
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
    <p id="character-images-hint" className="text-xs text-[var(--vh-text-2)]">{uiMessages["ui.characters.reference_images_png_jpeg_or_webp_up_to_20_mb_each"]()}</p>
    <label className="vh-secondary cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ink)]"><ImagePlus size={15} aria-hidden="true" />{uiMessages["ui.characters.choose_images"]()} <input type="file" multiple accept="image/png,image/jpeg,image/webp" aria-describedby="character-images-hint" onChange={event => { add(event.target.files); event.target.value = ''; }} className="sr-only" /></label>
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">{images.map((image, index) => <li key={image.preview} className="space-y-1.5 rounded-xl border border-[var(--vh-border)] p-2">
      <img src={image.preview} alt={image.file.name} className="aspect-square w-full rounded-lg object-cover" />
      <select aria-label={uiMessages["ui.characters.role_for"]() + image.file.name} value={image.role} onChange={event => setRole(index, event.target.value as ImageDraft['role'])} className={fieldClass + ' p-1.5 text-xs'}>{roles.map(role => <option key={role} value={role}>{roleLabel[role]}</option>)}</select>
      <Action onClick={() => onChange(images.filter((_, n) => n !== index))} className="text-[11px] text-[var(--vh-text-2)]">{uiMessages["ui.characters.remove"]()}</Action>
    </li>)}</ul>
  </div>;
}

