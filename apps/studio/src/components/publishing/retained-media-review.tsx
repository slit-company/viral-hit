import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useState } from 'react';
import { Action } from '@/components/base/action';
import type { PublicationAsset } from '@/core/publishing/contracts';

/** Exact retained files for review. strip shows them side by side in delivery order, like a carousel. */
export function RetainedMediaReview({ projectId, publicationId, digest, assets, onReady, layout = 'stack' }: {
  projectId: string; publicationId: string; digest: string; assets: PublicationAsset[]; onReady: (ready: boolean) => void; layout?: 'stack' | 'strip';
}) {
  const [loaded, setLoaded] = useState<number[]>([]), [failed, setFailed] = useState<number[]>([]), [attempt, setAttempt] = useState(0);
  useEffect(() => onReady(loaded.length === assets.length && !failed.length), [loaded, failed, assets.length, onReady]);
  function success(index: number) { setLoaded(previous => previous.includes(index) ? previous : [...previous, index]); setFailed(previous => previous.filter(value => value !== index)); }
  function failure(index: number) { setFailed(previous => previous.includes(index) ? previous : [...previous, index]); setLoaded(previous => previous.filter(value => value !== index)); }
  const strip = layout === 'strip';
  const media = (asset: PublicationAsset, index: number) => {
    const url = `/api/app/projects/${projectId}/publications/${publicationId}/media?digest=${digest}&asset=${index}&attempt=${attempt}`;
    const size = strip ? 'h-64 w-auto max-w-none' : 'max-h-64 w-full';
    return asset.contentType.startsWith('image/') ? <img loading="lazy" decoding="async" src={url} alt={uiMessages["ui.publishing.retained_image"]() + (index + 1)} onLoad={() => success(index)} onError={() => failure(index)} className={`${size} rounded-xl bg-[var(--vh-control)] object-contain`} />
      : asset.contentType.startsWith('audio/') ? <audio src={url} aria-label={uiMessages["ui.publishing.retained_audio"]() + (index + 1)} controls preload="metadata" onLoadedMetadata={() => success(index)} onError={() => failure(index)} className="w-full" />
      : <video src={url} aria-label={uiMessages["ui.publishing.retained_video"]() + (index + 1)} controls playsInline preload="metadata" onLoadedMetadata={() => success(index)} onError={() => failure(index)} className={`${size} rounded-xl bg-black object-contain`} />;
  };
  return <section aria-label={uiMessages["ui.publishing.retained_media"]()} className="space-y-3">
    {strip ? <>
      <p className="text-xs text-[var(--vh-text-2)]">{uiMessages["ui.publishing.exact_files_in_order"]()}</p>
      <ol className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-2">{assets.map((asset, index) => <li key={asset.assetId + ':' + index + ':' + attempt} className="relative shrink-0 snap-start">
        {media(asset, index)}<span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-medium tabular-nums text-white">{index + 1}</span>
      </li>)}</ol>
    </> : assets.map((asset, index) => <div key={asset.assetId + ':' + attempt} className="space-y-2"><p className="text-xs text-[var(--vh-text-2)]">{uiMessages["ui.publishing.file_2"]()} {index + 1} · {asset.contentType} {uiMessages["ui.publishing.retained_for_this_revision"]()}</p>{media(asset, index)}</div>)}
    {failed.length > 0 && <div className="space-y-2"><p role="status" className="text-sm">{uiMessages["ui.publishing.some_retained_media_could_not_load_retry_before_approving"]()}</p><Action className="vh-secondary" onClick={() => { onReady(false); setLoaded([]); setFailed([]); setAttempt(value => value + 1); }}>{uiMessages["ui.publishing.retry_previews"]()}</Action></div>}
  </section>;
}
