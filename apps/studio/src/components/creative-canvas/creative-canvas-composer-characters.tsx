import { useContext, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { Action } from '@/components/base/action';
import { referenceUrl, useCharacters } from '@/components/characters/use-characters';
import type { Character } from '@/core/characters/contract';
import { PROJECT_ASSET_REFERENCE_EVENT, type ProjectAssetReferenceDetail } from '@/core/creative-canvas/project-asset-transfer';
import { Link } from '@/core/i18n/navigation';
import { invalidateWorkspaceAfterAssetMutation } from '@/core/workspace-lib/app/workspace-query-invalidation';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { CanvasFrontLayerContext } from './creative-canvas-front-layer-context';
import { composerSectionLabelClassName } from './creative-canvas-composer-utils';

type UsedAsset = { assetId: string; role: string; publicUrl: string; filename: string | null; mimeType: string; width: number; height: number };
type Used = { brief: string; assets: UsedAsset[] };

/**
 * Characters in the composer reference menu. Choosing one copies its images into the project once,
 * attaches the main image to this draft and writes the character brief into the prompt.
 */
type Props = { draftId: string; disabled: boolean; onBrief: (brief: string) => void; onDone: () => void };

export function CreativeCanvasComposerCharacters(props: Props) {
  const canvas = useContext(CanvasFrontLayerContext);
  if (!canvas) return null;
  // Choosing the same character twice attaches nothing new and must not repeat the brief.
  const prompt = canvas.cards[props.draftId]?.prompt ?? '';
  return <ComposerCharacterList {...props} projectId={canvas.projectId} onBrief={brief => { if (!prompt.includes(brief)) props.onBrief(brief); }} />;
}

function ComposerCharacterList({ projectId, draftId, disabled, onBrief, onDone }: Props & { projectId: string }) {
  const t = useTranslations('AppShell.studio.canvas.composer');
  const library = useCharacters();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  async function use(character: Character) {
    setFailed(false);
    const used = await library.change({ action: 'use', id: character.id, projectId }) as unknown as Used | undefined;
    const main = used?.assets.find(asset => asset.role === 'canonical');
    if (!used || !main) { setFailed(true); return; }
    const detail: ProjectAssetReferenceDetail = { draftId, asset: { id: main.assetId, projectId, publicUrl: main.publicUrl, mediaType: 'image', filename: main.filename,
      width: main.width, height: main.height, durationMs: null, createdAt: new Date().toISOString(), mimeType: main.mimeType, assetClass: 'original', metadata: null } };
    window.dispatchEvent(new CustomEvent(PROJECT_ASSET_REFERENCE_EVENT, { detail }));
    onBrief(used.brief);
    void invalidateWorkspaceAfterAssetMutation(queryClient);
    onDone();
  }
  return <div className="space-y-1.5">
    <div className={composerSectionLabelClassName + ' flex items-center justify-between px-2'}>
      <span>{t('characters')}</span>
      <Link href="/characters" className="text-[11px] font-medium normal-case tracking-normal text-[var(--vh-text-3)] hover:text-[var(--vh-text-1)]">{t('manageCharacters')}</Link>
    </div>
    {library.characters?.length === 0 && <p className="px-2.5 text-xs text-[var(--vh-text-3)]">{t('noCharacters')}</p>}
    <div className="space-y-0.5">{library.characters?.map(character => <Action key={character.id} type="button" disabled={disabled || library.busy}
      aria-label={t('useCharacter', { name: character.name })} onClick={() => void use(character)}
      className="flex w-full items-center justify-start gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--vh-control)] disabled:cursor-not-allowed disabled:opacity-60">
      {character.references.some(item => item.role === 'canonical')
        ? <img src={referenceUrl(character, character.references.find(item => item.role === 'canonical')!.sha256)} alt="" draggable={false} className="size-8 shrink-0 rounded-md object-cover" />
        : <UserRound className="size-4 text-[var(--vh-text-2)]" />}
      <span className="min-w-0"><span className="block truncate text-[12px] font-semibold text-[var(--vh-text-1)]">{character.name}</span>
        <span className="block truncate text-[11px] text-[var(--vh-text-3)]">{character.description}</span></span>
    </Action>)}</div>
    {(failed || library.error) && <p role="alert" className="px-2.5 text-xs text-red-700">{library.error || t('characterFailed')}</p>}
  </div>;
}
