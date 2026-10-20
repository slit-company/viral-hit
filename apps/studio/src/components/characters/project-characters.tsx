import { useState } from 'react';
import { Copy, UserRound } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import type { Character } from '@/core/characters/contract';
import { referenceUrl, useCharacters } from './use-characters';

type Used = { character: { id: string; name: string }; brief: string; assets: { assetId: string; role: string }[] };

/** Adds workspace characters to one project; their images land in this project's assets. */
export function ProjectCharacters({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const library = useCharacters();
  const [used, setUsed] = useState<Used>();
  const [copied, setCopied] = useState(false);
  async function use(character: Character) {
    const result = await library.change({ action: 'use', id: character.id, projectId }) as unknown as Used | undefined;
    if (result) { setUsed(result); setCopied(false); onAdded(); }
  }
  return <section aria-label="Characters in this project" className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><UserRound size={16} aria-hidden="true" />Characters</h2>
      <Link href="/characters" className="text-xs text-[var(--color-lime-text)]">Manage characters</Link>
    </div>
    {library.characters?.length === 0 && <p className="text-xs text-[var(--vh-text-2)]">No characters yet. Create one in Characters, then add it here.</p>}
    <ul className="flex gap-2 overflow-x-auto pb-1">{library.characters?.map(character => <li key={character.id} className="w-36 shrink-0 rounded-xl border border-[var(--vh-border)] p-2">
      <img src={referenceUrl(character, character.references.find(item => item.role === 'canonical')!.sha256)} alt="" className="aspect-square w-full rounded-lg object-cover" />
      <p className="mt-1.5 truncate text-xs font-semibold">{character.name}</p>
      <Action aria-label={'Add ' + character.name + ' to this project'} disabled={library.busy} onClick={() => void use(character)} className="vh-secondary mt-1.5 w-full text-[11px]">Add to project</Action>
    </li>)}</ul>
    {used && <div role="status" className="space-y-2 rounded-xl bg-[var(--vh-control)] p-3 text-xs">
      <p><span className="font-semibold">{used.character.name}</span> is in this project: {used.assets.length} reference {used.assets.length === 1 ? 'image' : 'images'}. Attach the main image when you generate and include this brief:</p>
      <p className="leading-relaxed">{used.brief}</p>
      <Action onClick={() => { void navigator.clipboard.writeText(used.brief).then(() => setCopied(true)); }} className="inline-flex items-center gap-1.5 text-xs"><Copy size={13} />{copied ? 'Copied' : 'Copy brief'}</Action>
    </div>}
    {library.error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-xs text-red-800">{library.error}</p>}
  </section>;
}

