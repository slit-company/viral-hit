import { ArrowRight } from 'lucide-react';
import { Link } from '@/core/i18n/navigation';
import { m } from '@/paraglide/messages.js';
import { normalizeLocale } from '@/config/locale';
import { cn } from '@/lib/utils';

type Tool = { key: 'image' | 'video' | 'audio' | 'storyboards' | 'maskEdit' | 'canvas' | 'editor' | 'packs' | 'characters'; href: string; cover: string; isNew?: boolean };

// The first card is the large tile; the rest follow the Higgsfield-style bento order.
const TOOLS: Tool[] = [
  { key: 'image', href: '/studio?target=image', cover: '/app/create-thumb-portrait.webp' },
  { key: 'video', href: '/studio?target=video', cover: '/app/covers/video.webp' },
  { key: 'maskEdit', href: '/studio?target=image&model=masked-image-edit', cover: '/app/covers/mask-edit.webp', isNew: true },
  { key: 'audio', href: '/studio?target=audio', cover: '/app/covers/audio.webp' },
  { key: 'storyboards', href: '/projects', cover: '/app/covers/storyboard.webp' },
  { key: 'canvas', href: '/canvas', cover: '/app/covers/canvas.webp' },
  { key: 'editor', href: '/projects', cover: '/app/covers/editing.webp' },
  { key: 'packs', href: '/packs', cover: '/app/covers/utility.webp' },
  { key: 'characters', href: '/characters', cover: '/app/create-thumb-ripple.webp' },
];

function toolCopy(key: Tool['key'], locale: string) {
  const options = { locale: normalizeLocale(locale) };
  const title = { image: m['product.home.mediaImage'], video: m['product.home.mediaVideo'], audio: m['product.home.mediaAudio'], storyboards: m['product.home.toolStoryboards'], maskEdit: m['product.home.toolMaskEdit'], canvas: m['product.home.toolCanvas'], editor: m['product.home.toolEditor'], packs: m['product.home.toolPacks'], characters: m['product.home.toolCharacters'] }[key];
  const description = { image: m['product.home.toolImageDescription'], video: m['product.home.toolVideoDescription'], audio: m['product.home.toolAudioDescription'], storyboards: m['product.home.toolStoryboardsDescription'], maskEdit: m['product.home.toolMaskEditDescription'], canvas: m['product.home.toolCanvasDescription'], editor: m['product.home.toolEditorDescription'], packs: m['product.home.toolPacksDescription'], characters: m['product.home.toolCharactersDescription'] }[key];
  return { title: title({}, options), description: description({}, options) };
}

/** Large media cards with a title and one line below, as on Higgsfield's home. */
export function HomeTools({ locale, projectsLabel }: { locale: string; projectsLabel: string }) {
  const options = { locale: normalizeLocale(locale) };
  return (
    <section aria-labelledby="home-tools" className="pb-14">
      <div className="mb-5 flex items-end justify-between gap-3">
        <h2 id="home-tools" className="vh-product-display text-xl font-semibold tracking-[-0.03em] text-[var(--vh-text-1)] sm:text-[22px]">{m['product.home.toolsTitle']({}, options)}</h2>
        <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--vh-text-2)] transition hover:text-[var(--vh-text-1)]">{projectsLabel}<ArrowRight className="size-3.5" /></Link>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4">
        {TOOLS.map((tool, index) => {
          const copy = toolCopy(tool.key, locale);
          return (
            <Link key={tool.key} href={tool.href} className={cn('group block min-w-0', index === 0 && 'col-span-2 md:row-span-2')}>
              <div className={cn('relative overflow-hidden rounded-[var(--vh-radius)] bg-[var(--vh-control)]', index === 0 ? 'aspect-[3/2] md:aspect-auto md:h-[calc(100%-52px)]' : 'aspect-[3/2]')}>
                <img src={tool.cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
                {tool.isNew && <span className="absolute left-3 top-3 rounded-full bg-[var(--color-brand-lime)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-ink)]">{m['product.home.newBadge']({}, options)}</span>}
              </div>
              <h3 className="mt-3 truncate text-[15px] font-semibold text-[var(--vh-text-1)]">{copy.title}</h3>
              <p className="mt-0.5 truncate text-[13px] text-[var(--vh-text-2)]">{copy.description}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

