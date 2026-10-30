import { m as uiMessages } from '@/paraglide/messages.js';
import { useCallback, useEffect, useState } from 'react';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { WORKSPACE_MUTATION_HEADER } from '@/lib/trusted-local-request';
import type { Character, CharacterProfile, CharacterRequest, CharacterReference } from '@/core/characters/contract';

export type ImageDraft = { file: File; role: CharacterReference['role']; preview: string };
export const referenceUrl = (character: Pick<Character, 'id'>, sha256: string) => `/api/app/characters/${character.id}/references/${sha256}`;
export const characterFileUrl = (character: Pick<Character, 'id'>) => `/api/app/characters/${character.id}/file`;

async function upload(request: unknown, images: ImageDraft[]) {
  const form = new FormData();
  form.set('request', JSON.stringify(request));
  form.set('roles', JSON.stringify(images.map(image => image.role)));
  for (const image of images) form.append('file', image.file, image.file.name);
  const response = await fetch('/api/app/characters', { method: 'POST', body: form, headers: { [WORKSPACE_MUTATION_HEADER]: '1' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || uiMessages["ui.characters.character_request_failed"]());
  return body as Character;
}

/** Loading and mutations for the workspace character library; rendering lives in the components. */
export function useCharacters() {
  const [characters, setCharacters] = useState<Character[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setCharacters((await apiJsonGet<{ characters: Character[] }>('/api/app/characters')).characters); }
    catch (cause) { setError(cause instanceof Error ? cause.message : uiMessages["ui.characters.characters_are_unavailable"]()); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function run<T>(task: () => Promise<T>) {
    setBusy(true); setError('');
    try { const result = await task(); await load(); return result; }
    catch (cause) { setError(cause instanceof Error ? cause.message : uiMessages["ui.characters.character_request_failed"]()); return undefined; }
    finally { setBusy(false); }
  }
  return {
    characters, busy, error, clearError: () => setError(''),
    create: (profile: CharacterProfile, images: ImageDraft[]) => run(() => upload({ action: 'create', profile }, images)),
    addImages: (character: Character, images: ImageDraft[]) => run(() => upload({ action: 'add_references', id: character.id, expectedVersion: character.version }, images)),
    change: (request: CharacterRequest) => run(() => apiJsonPost<Character>('/api/app/characters', request)),
    importFile: (file: File) => run(async () => {
      const response = await fetch('/api/app/characters/import', { method: 'POST', body: file, headers: { 'Content-Type': 'application/x-tar', [WORKSPACE_MUTATION_HEADER]: '1' } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || uiMessages["ui.characters.the_character_file_could_not_be_imported"]());
      return body as Character & { replayed: boolean };
    }),
  };
}

