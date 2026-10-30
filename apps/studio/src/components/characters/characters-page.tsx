import { m as uiMessages } from '@/paraglide/messages.js';
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
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]">{uiMessages["ui.characters.characters"]()}</p>
          <h1 className="vh-product-display mt-4 text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.04em]">{uiMessages["ui.characters.keep_every_face_the_same"]()}</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-6 text-[var(--vh-text-2)]">{uiMessages["ui.characters.a_character_is_a_set_of_reference_images_plus_what_must_always_stay_the_sam"]()}</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start lg:self-auto">
          <label className="vh-secondary cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-ink)]"><FileUp size={15} aria-hidden="true" />{uiMessages["ui.characters.import_character"]()} <input type="file" accept=".tar,application/x-tar" className="sr-only" disabled={library.busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} /></label>
          <Action onClick={() => { library.clearError(); setCreating(true); }} className="vh-primary"><Plus size={16} />{uiMessages["ui.characters.new_character"]()}</Action>
        </div>
      </section>
      {library.error && !creating && <p role="alert" className="mt-6 rounded-xl bg-red-500/10 p-3 text-sm text-red-800">{library.error}</p>}
      <section aria-label={uiMessages["ui.characters.your_characters"]()} className="mt-10">
        {library.characters?.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--vh-border)] px-6 py-14 text-center">
          <UserRound className="mx-auto mb-3 text-[var(--vh-text-2)]" size={28} aria-hidden="true" />
          <p className="font-semibold">{uiMessages["ui.characters.no_characters_yet"]()}</p>
          <p className="mt-2 text-sm text-[var(--vh-text-2)]">{uiMessages["ui.characters.start_with_one_clear_image_of_the_face_or_product_then_add_other_angles"]()}</p>
        </div>}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{library.characters?.map(character => <li key={character.id}>
          <Action onClick={() => setOpenId(character.id)} aria-label={uiMessages["ui.characters.open"]() + character.name} className="flex w-full flex-col overflow-hidden rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-0 text-left">
            <img src={referenceUrl(character, character.references.find(item => item.role === 'canonical')!.sha256)} alt="" className="aspect-[4/5] w-full object-cover" />
            <span className="block self-stretch p-3 text-left"><span className="block truncate font-semibold">{character.name}</span><span className="mt-1 block text-xs text-[var(--vh-text-2)]">{character.references.length} {uiMessages["ui.characters.images"]()} {character.invariants.length} {uiMessages["ui.characters.rules"]()}{character.providerIdentities.length ? ' · Soul ID' : ''}</span></span>
          </Action>
        </li>)}</ul>
      </section>
    </main>
    <Dialog open={creating} onOpenChange={setCreating}>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{uiMessages["ui.characters.new_character"]()}</DialogTitle><DialogDescription>{uiMessages["ui.characters.images_show_the_look_the_lists_say_what_generation_must_keep_and_avoid"]()}</DialogDescription></DialogHeader>
        <CharacterProfileFields value={profile} onChange={setProfile} />
        <ImagePicker images={images} onChange={setImages} />
        {library.error && <p role="alert" className="whitespace-pre-wrap rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{library.error}</p>}
        <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 border-t border-[var(--vh-border)] bg-[var(--vh-surface)] px-6 py-4"><Action disabled={library.busy || !ready(profile, images)} onClick={() => void create()} className="vh-primary w-full sm:w-auto">{library.busy ? uiMessages["ui.common.saving"]() : uiMessages["ui.characters.create_character"]()}</Action></div>
      </DialogContent>
    </Dialog>
    {open && <CharacterDetail character={open} library={library} onClose={() => setOpenId(undefined)} />}
  </ProductShell>;
}

