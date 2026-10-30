import { useQuery } from '@tanstack/react-query';
import { Music2, Plus, Upload } from 'lucide-react';
import { Action } from '@/components/base/action';
import type { TimelineClip } from '@/core/editor/timeline-document';
import { seekStaticVideoPreview } from '@/core/media/video-preview';
import { fetchRecentAssets, type RecentAsset } from '@/core/workspace-lib/app/workspace-client-api';
import { recentAssetsKeys } from '@/core/workspace-lib/app/workspace-query-keys';

export type ProjectAssetKind = 'image' | 'video' | 'audio';
type Labels = { type: (kind: TimelineClip['sourceType']) => string; projectAssets: string; add: (name: string) => string; empty: string; drop: string };

const formatTime = (seconds: number) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0, minutes = Math.floor(safe / 60);
  return minutes + ':' + (safe - minutes * 60).toFixed(2).padStart(5, '0');
};
const tile = (view: 'grid' | 'list', active: boolean) => 'group min-w-0 overflow-hidden rounded-[10px] border text-left transition ' + (active ? 'border-[var(--vh-accent)]/70 bg-[var(--vh-accent)]/[0.08]' : 'border-[var(--vh-border)] bg-[var(--vh-control)] hover:border-[var(--vh-border-strong)]') + (view === 'list' ? ' flex items-center gap-2.5 p-2' : ' p-1.5');
const frame = (view: 'grid' | 'list') => 'relative grid shrink-0 place-items-center overflow-hidden rounded-[7px] bg-[var(--vh-control)] ' + (view === 'list' ? 'size-12' : 'aspect-video w-full');

function Preview({ kind, url }: { kind: TimelineClip['sourceType']; url: string }) {
  if (kind === 'image') return <img src={url} alt="" className="size-full object-cover" />;
  if (kind === 'video') return <video src={url} muted playsInline preload="metadata" className="size-full object-cover opacity-80" onLoadedMetadata={event => seekStaticVideoPreview(event.currentTarget)} />;
  return <Music2 className="size-4 text-[var(--vh-graph)]" />;
}

/**
 * The editor's media bin: clips already on the timeline, then project assets (Studio results, imports, renders)
 * that can be placed on the timeline with one click.
 */
export function EditorMediaPanel({ projectId, clips, view, search, selectedAssetId, labels, onSelect, onAdd, onImport }: {
  projectId: string; clips: TimelineClip[]; view: 'grid' | 'list'; search: string; selectedAssetId?: string; labels: Labels;
  onSelect: (clip: TimelineClip) => void; onAdd: (asset: RecentAsset, kind: ProjectAssetKind) => void; onImport: () => void;
}) {
  const assets = useQuery({ queryKey: recentAssetsKeys.lists(projectId), queryFn: () => fetchRecentAssets(projectId), staleTime: 15_000 });
  const placed = new Set(clips.map(clip => clip.assetId)), query = search.trim().toLowerCase();
  const available = assets.data ? ([['image', assets.data.images], ['video', assets.data.videos], ['audio', assets.data.audios]] as const)
    .flatMap(([kind, list]) => list.map(asset => ({ asset, kind: kind as ProjectAssetKind })))
    .filter(({ asset }) => !placed.has(asset.id) && (asset.filename ?? '').toLowerCase().includes(query)) : [];
  const layout = view === 'grid' ? 'grid grid-cols-2 gap-2.5' : 'flex flex-col gap-2';
  if (!clips.length && !available.length) return <Action type="button" onClick={onImport} className="flex h-full min-h-56 w-full flex-col items-center justify-center rounded-xl border border-dashed border-[var(--vh-border)] px-5 text-center text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)]">
    <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-[var(--vh-control)]"><Upload className="size-5" /></span>
    <span className="text-xs font-[560]">{labels.empty}</span><span className="mt-2 max-w-44 text-[11px] leading-5">{labels.drop}</span>
  </Action>;
  return <div className="space-y-5">
    {clips.length > 0 && <div className={layout}>{clips.map(clip => <Action key={clip.assetId} type="button" onClick={() => onSelect(clip)} className={tile(view, selectedAssetId === clip.assetId)}>
      <span className={frame(view)}><Preview kind={clip.sourceType} url={clip.sourceUrl} /><span className="absolute bottom-1 right-1 rounded bg-black/72 px-1 py-0.5 text-[8px] font-[560] tabular-nums text-white/90">{formatTime(clip.duration)}</span></span>
      <span className={'block min-w-0 ' + (view === 'grid' ? 'px-1 pb-1 pt-2' : 'flex-1')}><span className="block truncate text-[11px] font-[550] text-[var(--vh-text-1)]">{clip.name}</span><span className="mt-0.5 block text-[9px] text-[var(--vh-text-2)]">{labels.type(clip.sourceType)}</span></span>
    </Action>)}</div>}
    {available.length > 0 && <section aria-label={labels.projectAssets} className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--vh-text-3)]">{labels.projectAssets}</h3>
      <div className={layout}>{available.map(({ asset, kind }) => { const name = asset.filename?.trim() || labels.type(kind); return <Action key={asset.id} type="button" aria-label={labels.add(name)} title={labels.add(name)} onClick={() => onAdd(asset, kind)} className={tile(view, false)}>
        <span className={frame(view)}><Preview kind={kind} url={asset.publicUrl} /><span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-[var(--vh-text-1)] text-[var(--vh-surface)] opacity-90"><Plus className="size-3" /></span></span>
        <span className={'block min-w-0 ' + (view === 'grid' ? 'px-1 pb-1 pt-2' : 'flex-1')}><span className="block truncate text-[11px] font-[550] text-[var(--vh-text-1)]">{name}</span><span className="mt-0.5 block text-[9px] text-[var(--vh-text-2)]">{labels.type(kind)}</span></span>
      </Action>; })}</div>
    </section>}
  </div>;
}
