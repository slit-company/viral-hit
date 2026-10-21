import { Action } from '@/components/base/action';

export function StudioReferenceThumbnails({ urls, onRemove }: { urls: string[]; onRemove?: (url: string) => void }) {
  if (!urls.length) return null;
  return <div className="mb-2 flex flex-wrap gap-2">{urls.map(url => <Action
    key={url} type="button" onClick={() => onRemove?.(url)}
    className="size-9 overflow-hidden rounded-[10px] border border-[var(--vh-border)]"
  ><img src={url} alt="" className="h-full w-full object-cover" /></Action>)}</div>;
}
