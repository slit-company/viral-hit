import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useRef, useState } from 'react';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import type { PackInspection, PackScope } from '@/core/harness/recipe-packs';
import type { Recipe } from '@/core/harness/recipes';

export type PackDraft = { title: string; id: string; scope: PackScope; useCases: string; description: string; author: string; license: string };
type Built = { manifest: { id: string; version: string }; inspection: PackInspection };
const slug = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40).replace(/-+$/, '');
export const MAX_CHOSEN = 24;

/** Draft state and server build for a shareable pack; installing stays a separate review. */
export function usePackBuilder() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [draft, setDraft] = useState<PackDraft>({ title: '', id: '', scope: 'specialized', useCases: '', description: '', author: '', license: 'Apache-2.0' });
  const [idEdited, setIdEdited] = useState(false);
  const [built, setBuilt] = useState<Built>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  useEffect(() => {
    void apiJsonGet<{ recipes: Recipe[] }>('/api/app/recipes').then(result => setRecipes(result.recipes)).catch(() => setError(uiMessages["ui.app.recipes_are_unavailable"]()));
  }, []);
  function change<K extends keyof PackDraft>(key: K, value: PackDraft[K]) {
    epoch.current++; setBuilt(undefined); setError('');
    setDraft(current => ({ ...current, [key]: value, ...(key === 'title' && !idEdited ? { id: slug(String(value)) } : {}) }));
    if (key === 'id') setIdEdited(true);
  }
  function toggle(id: string) {
    epoch.current++; setBuilt(undefined); setError('');
    setChosen(current => current.includes(id) ? current.filter(item => item !== id) : current.length >= MAX_CHOSEN ? current : [...current, id]);
  }
  async function build() {
    const current = ++epoch.current; setBusy(true); setError('');
    try {
      const useCases = draft.useCases.split(',').map(slug).filter(Boolean);
      const result = await apiJsonPost<Built>('/api/app/recipe-packs', { action: 'build', pack: { ...draft, useCases, recipeIds: chosen } });
      if (current === epoch.current) setBuilt(result);
    } catch (cause) { if (current === epoch.current) setError(cause instanceof Error ? cause.message : uiMessages["ui.app.could_not_build_pack"]()); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  function download() {
    if (!built) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(built.manifest, null, 2) + '\n'], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${built.manifest.id}-${built.manifest.version}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const ready = Boolean(draft.title.trim() && draft.id && draft.description.trim() && draft.author.trim() && draft.license.trim() && draft.useCases.trim() && chosen.length);
  return { recipes, chosen, draft, built, busy, error, ready, change, toggle, build, download };
}
