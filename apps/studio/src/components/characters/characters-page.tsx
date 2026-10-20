import { useState } from 'react';
import { FileUp, Plus, UserRound } from 'lucide-react';
import { ProductShell } from '@/components/marketing/product-shell';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Character, CharacterProfile } from '@/core/characters/contract';
import { CharacterDetail } from './character-detail';
import { CharacterProfileFields, emptyProfile, ImagePicker } from './character-form';
import { referenceUrl, useCharacters, type ImageDraft } from './use-characters';

const ready = (profile: CharacterProfile, images: ImageDraft[]) => Boolean(profile.name.trim() && profile.description.trim() && images.length);

export function CharactersPage({ locale }: { locale: string }) {
  const library = useCharacters();
  const [creating, setCreating] = useState(false);
  const [profile, setProfile] = useState<CharacterProfile>(emptyProfile);
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [openId, setOpenId] = useState<string>();
  const open = library.characters?.find(item => item.id === openId);
  async function importFile(file: File) {
    const imported = await library.importFile(file);
    if (imported) setOpenId(imported.id);
  }
  async function create() {
    const created = await library.create(profile, images);
    if (created) { setCreating(false); setProfile(emptyProfile()); setImages([]); setOpenId(created.id); }
  }
  return <ProductShell active="characters" locale={locale}>
    <main className="mx-auto w-full max-w-[1280px] px-5 pb-12 pt-14 sm:px-6">
      <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]">CHARACTERS</p>
          <h1 className="vh-product-display mt-4 text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.04em]">Keep every face the same.</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-6 text-[var(--vh-text-2)]">A character is a set of reference images plus what must always stay the same. Add one to any project and use it in every shot.</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start lg:self-auto">
          <label className="vh-secondary cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ink)]"><FileUp size={15} aria-hidden="true" />Import character
            <input type="file" accept=".tar,application/x-tar" className="sr-only" disabled={library.busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} /></label>
          <Action onClick={() => { library.clearError(); setCreating(true); }} className="vh-primary"><Plus size={16} />New character</Action>
        </div>
      </section>
      {library.error && !creating && <p role="alert" className="mt-6 rounded-xl bg-red-500/10 p-3 text-sm text-red-800">{library.error}</p>}
      <section aria-label="Your characters" className="mt-10">
        {library.characters?.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--vh-border)] px-6 py-14 text-center">
          <UserRound className="mx-auto mb-3 text-[var(--vh-text-2)]" size={28} aria-hidden="true" />
          <p className="font-semibold">No characters yet</p>
          <p className="mt-2 text-sm text-[var(--vh-text-2)]">Start with one clear image of the face or product, then add other angles.</p>
        </div>}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{library.characters?.map(character => <li key={character.id}>
          <Action onClick={() => setOpenId(character.id)} aria-label={'Open ' + character.name} className="flex w-full flex-col overflow-hidden rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-0 text-left">
            <img src={referenceUrl(character, character.references.find(item => item.role === 'canonical')!.sha256)} alt="" className="aspect-[4/5] w-full object-cover" />
            <span className="block self-stretch p-3 text-left"><span className="block truncate font-semibold">{character.name}</span><span className="mt-1 block text-xs text-[var(--vh-text-2)]">{character.references.length} images · {character.invariants.length} rules{character.providerIdentities.length ? ' · Soul ID' : ''}</span></span>
          </Action>
        </li>)}</ul>
      </section>
    </main>
    <Dialog open={creating} onOpenChange={setCreating}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>New character</DialogTitle><DialogDescription>Images show the look; the lists say what generation must keep and avoid.</DialogDescription></DialogHeader>
        <CharacterProfileFields value={profile} onChange={setProfile} />
        <ImagePicker images={images} onChange={setImages} />
        {library.error && <p role="alert" className="whitespace-pre-wrap rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{library.error}</p>}
        <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] px-6 py-4"><Action disabled={library.busy || !ready(profile, images)} onClick={() => void create()} className="vh-primary w-full sm:w-auto">{library.busy ? 'Saving…' : 'Create character'}</Action></div>
      </DialogContent>
    </Dialog>
    {open && <CharacterDetail character={open} library={library} onClose={() => setOpenId(undefined)} />}
  </ProductShell>;
}

