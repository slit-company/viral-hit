import { Check, FileVideo2, ImageIcon } from 'lucide-react';
import { Action } from '@/components/base/action';
import type { RecentAsset } from '@/core/workspace-lib/app/workspace-client-api';
import { cn } from '@/lib/utils';

export type ChoiceAsset = RecentAsset & { kind: 'image' | 'video' };
const seconds = (asset: ChoiceAsset) => asset.kind === 'video' && asset.durationMs ? (asset.durationMs / 1000).toFixed(1) + 's' : null;

/** Project images and videos to pick from; multi-select shows the order they were picked in. */
export function AssetChoiceGrid({ assets, selected, label, onToggle }: { assets: ChoiceAsset[]; selected: string[]; label: string; onToggle: (id: string) => void }) {
  return <div role="group" aria-label={label} className="grid grid-cols-3 gap-2">
    {assets.map(asset => {
      const order = selected.indexOf(asset.id), name = asset.filename?.trim() || asset.id;
      return <Action key={asset.id} type="button" aria-pressed={order >= 0} aria-label={name} onClick={() => onToggle(asset.id)}
        className={cn('group relative min-w-0 overflow-hidden rounded-xl border p-1 text-left transition', order >= 0 ? 'border-[var(--vh-text-1)] bg-[var(--vh-control)]' : 'border-[var(--vh-border)] hover:border-[var(--vh-text-3)]')}>
        <span className="relative block aspect-video overflow-hidden rounded-lg bg-[var(--vh-control)]">
          {asset.kind === 'video'
            ? <video src={asset.publicUrl + '#t=0.5'} muted playsInline preload="metadata" aria-hidden="true" className="size-full object-cover" />
            : <img src={asset.publicUrl} alt="" className="size-full object-cover" />}
          {order >= 0 && <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-[var(--vh-text-1)] text-[10px] font-bold text-white">{selected.length > 1 ? order + 1 : <Check className="size-3" />}</span>}
        </span>
        <span className="mt-1 flex items-center gap-1 px-0.5 text-[11px] text-[var(--vh-text-2)]">
          {asset.kind === 'video' ? <FileVideo2 className="size-3 shrink-0" aria-hidden="true" /> : <ImageIcon className="size-3 shrink-0" aria-hidden="true" />}
          <span className="truncate">{name}</span>{seconds(asset) && <span className="ml-auto shrink-0 tabular-nums">{seconds(asset)}</span>}
        </span>
      </Action>;
    })}
  </div>;
}
