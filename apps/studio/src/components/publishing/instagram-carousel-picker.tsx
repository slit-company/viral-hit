import { m as uiMessages } from '@/paraglide/messages.js';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { isPublishableImage } from './instagram-labels';
import type { PublicationVideo } from './use-publications';

/** Ordered carousel items. The first item sets the frame every image is fitted to. */
export function InstagramCarouselPicker({ media, items, altTexts, onItems, onAlt }: {
  media: PublicationVideo[]; items: string[]; altTexts: Record<string, string>;
  onItems: (ids: string[]) => void; onAlt: (id: string, text: string) => void;
}) {
  const byId = new Map(media.map(item => [item.id, item])), remaining = media.filter(item => !items.includes(item.id));
  const move = (from: number, to: number) => { const next = [...items]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); onItems(next); };
  return <fieldset className="space-y-3">
    <legend className="flex w-full items-center justify-between gap-3 text-sm font-medium"><span>{uiMessages["ui.publishing.carousel_items"]()}</span><span className="text-xs font-normal tabular-nums text-[var(--vh-text-2)]">{uiMessages["ui.publishing.carousel_count"]({ count: items.length })}</span></legend>
    {items.length > 0 && <ol className="space-y-2">{items.map((id, index) => {
      const item = byId.get(id), name = item?.filename || id, image = isPublishableImage(item);
      return <li key={id} className="rounded-xl border border-[var(--vh-border)] p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="w-5 shrink-0 text-center text-xs tabular-nums text-[var(--vh-text-2)]">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-sm" title={name}>{name}</span>
          <span className="shrink-0 rounded-full bg-[var(--vh-control)] px-2 py-0.5 text-xs">{image ? uiMessages["ui.agent.kind_image"]() : uiMessages["ui.agent.kind_video"]()}</span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={uiMessages["ui.publishing.move_item_up"]({ name })} disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowUp /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={uiMessages["ui.publishing.move_item_down"]({ name })} disabled={index === items.length - 1} onClick={() => move(index, index + 1)}><ArrowDown /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={uiMessages["ui.publishing.remove_item"]({ name })} onClick={() => onItems(items.filter(value => value !== id))}><X /></Button>
        </div>
        {image && <Input className="mt-2" aria-label={uiMessages["ui.publishing.alt_text_for"]({ name })} placeholder={uiMessages["ui.publishing.alt_text"]()} maxLength={1000} value={altTexts[id] ?? ''} onChange={event => onAlt(id, event.target.value)} />}
      </li>;
    })}</ol>}
    {items.length < 20 && remaining.length > 0 && <NativeSelect aria-label={uiMessages["ui.publishing.add_carousel_item"]()} value="" onChange={event => { if (event.target.value) onItems([...items, event.target.value]); }}>
      <option value="">{uiMessages["ui.publishing.add_carousel_item"]()}</option>{remaining.map(item => <option key={item.id} value={item.id}>{item.filename || item.id}</option>)}
    </NativeSelect>}
  </fieldset>;
}
