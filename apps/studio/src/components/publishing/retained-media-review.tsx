import { useEffect, useState } from 'react';
import { Action } from '@/components/base/action';
import type { PublicationAsset } from '@/core/publishing/contracts';

export function RetainedMediaReview({ projectId, publicationId, digest, assets, onReady }: {
  projectId: string; publicationId: string; digest: string; assets: PublicationAsset[]; onReady: (ready: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<number[]>([]), [failed, setFailed] = useState<number[]>([]), [attempt, setAttempt] = useState(0);
  useEffect(() => onReady(loaded.length === assets.length && !failed.length), [loaded, failed, assets.length, onReady]);
  function success(index: number) { setLoaded(previous => previous.includes(index) ? previous : [...previous, index]); setFailed(previous => previous.filter(value => value !== index)); }
  function failure(index: number) { setFailed(previous => previous.includes(index) ? previous : [...previous, index]); setLoaded(previous => previous.filter(value => value !== index)); }
  return <section aria-label="Retained media" className="space-y-3">{assets.map((asset, index) => {
    const url = `/api/app/projects/${projectId}/publications/${publicationId}/media?digest=${digest}&asset=${index}&attempt=${attempt}`;
    return <div key={asset.assetId + ':' + attempt} className="space-y-2"><p className="text-xs text-[var(--vh-text-2)]">File {index + 1} · {asset.contentType} · retained for this revision</p>
      {asset.contentType.startsWith('image/') ? <img loading="lazy" decoding="async" src={url} alt={'Retained image ' + (index + 1)} onLoad={() => success(index)} onError={() => failure(index)} className="max-h-64 w-full rounded-xl bg-[var(--vh-control)] object-contain" />
        : asset.contentType.startsWith('audio/') ? <audio src={url} aria-label={'Retained audio ' + (index + 1)} controls preload="metadata" onLoadedMetadata={() => success(index)} onError={() => failure(index)} className="w-full" />
        : <video src={url} aria-label={'Retained video ' + (index + 1)} controls playsInline preload="metadata" onLoadedMetadata={() => success(index)} onError={() => failure(index)} className="max-h-64 w-full rounded-xl bg-black object-contain" />}
    </div>;
  })}{failed.length > 0 && <div className="space-y-2"><p role="status" className="text-sm">Some retained media could not load. Retry before approving.</p><Action className="vh-secondary" onClick={() => { onReady(false); setLoaded([]); setFailed([]); setAttempt(value => value + 1); }}>Retry previews</Action></div>}</section>;
}
