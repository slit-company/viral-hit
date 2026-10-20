import { useEffect, useState } from 'react';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { characterBrief, type Character, type CharacterProfile } from '@/core/characters/contract';
import { CharacterProfileFields, ImagePicker, roleLabel } from './character-form';
import { characterFileUrl, referenceUrl, type ImageDraft, type useCharacters } from './use-characters';

const profileOf = ({ name, kind, description, invariants, forbidden, voice, providerIdentities }: Character): CharacterProfile => ({ name, kind, description, invariants, forbidden, ...(voice ? { voice } : {}), providerIdentities });

export function CharacterDetail({ character, library, onClose }: { character: Character; library: ReturnType<typeof useCharacters>; onClose: () => void }) {
  const [profile, setProfile] = useState(() => profileOf(character));
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [confirmArchive, setConfirmArchive] = useState(false);
  useEffect(() => { setProfile(profileOf(character)); }, [character]);
  const changed = JSON.stringify(profile) !== JSON.stringify(profileOf(character));
  const base = { id: character.id, expectedVersion: character.version };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{character.name}</DialogTitle><DialogDescription>Version {character.version}. Every project that adds this character gets these images and rules. Download the character file to use it in another Viral Hit.</DialogDescription></DialogHeader>
      <section aria-label="Saved reference images" className="space-y-2">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">{character.references.map(reference => <li key={reference.sha256} className="space-y-1.5 rounded-xl border border-[var(--vh-border)] p-2">
          <img src={referenceUrl(character, reference.sha256)} alt={roleLabel[reference.role] + ' of ' + character.name} className="aspect-square w-full rounded-lg object-cover" />
          <p className="text-xs font-semibold">{roleLabel[reference.role]}</p>
          {reference.role !== 'canonical' && <div className="flex flex-wrap gap-2 text-[11px]">
            <Action disabled={library.busy} onClick={() => void library.change({ action: 'set_canonical', ...base, sha256: reference.sha256 })} className="text-[var(--vh-text-2)]">Make main</Action>
            <Action disabled={library.busy} onClick={() => void library.change({ action: 'remove_reference', ...base, sha256: reference.sha256 })} className="text-[var(--vh-text-2)]">Remove</Action>
          </div>}
        </li>)}</ul>
        <ImagePicker images={images} onChange={setImages} allowCanonical={false} />
        {images.length > 0 && <Action disabled={library.busy} onClick={async () => { if (await library.addImages(character, images)) setImages([]); }} className="vh-secondary text-xs">Add {images.length} {images.length === 1 ? 'image' : 'images'}</Action>}
      </section>
      <CharacterProfileFields value={profile} onChange={setProfile} />
      <section aria-label="Prompt brief" className="rounded-xl bg-[var(--vh-control)] p-3 text-xs leading-relaxed"><p className="mb-1 font-semibold">Added to prompts</p>{characterBrief(profile)}</section>
      {library.error && <p role="alert" className="whitespace-pre-wrap rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{library.error}</p>}
      <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] px-6 py-4">
        {confirmArchive ? <span className="flex flex-wrap items-center gap-2 text-xs">Archive this character? Projects keep the images they already have.
          <Action disabled={library.busy} onClick={async () => { if (await library.change({ action: 'archive', ...base })) onClose(); }} className="vh-secondary text-xs">Archive</Action>
          <Action onClick={() => setConfirmArchive(false)} className="text-xs">Keep</Action></span>
          : <span className="flex flex-wrap items-center gap-3 text-xs">
            <Action onClick={() => setConfirmArchive(true)} className="text-[var(--vh-text-2)]">Archive</Action>
            <a href={characterFileUrl(character)} download className="font-semibold text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]">Download character file</a>
          </span>}
        <Action disabled={library.busy || !changed || !profile.name.trim() || !profile.description.trim()} onClick={() => void library.change({ action: 'update', ...base, profile: { ...profile, voice: profile.voice ?? null } })} className="vh-primary text-xs">{library.busy ? 'Saving…' : 'Save changes'}</Action>
      </div>
    </DialogContent>
  </Dialog>;
}

