import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import { apiJsonGet } from '@/lib/api-client';
import { m } from '@/paraglide/messages.js';
import { normalizeLocale } from '@/config/locale';
import { cn } from '@/lib/utils';
import type { RecipeCatalog } from '@/core/harness/recipe-library-contract';
import type { InstalledPack } from '@/core/harness/recipe-packs';
import { categoryLabel, templateCover } from './template-covers';

type Filter = { kind: 'all' } | { kind: 'specialized' } | { kind: 'category'; value: string };
const INITIAL_COUNT = 9;
const loadTemplates = () => apiJsonGet<RecipeCatalog & { packs?: InstalledPack[] }>('/api/app/recipes');

/** Templates come from the live recipe catalog, so contributed general and specialized recipes appear beside shipped ones. */
export function HomeTemplates({ locale }: { locale: string }) {
  const options = { locale: normalizeLocale(locale) };
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [expanded, setExpanded] = useState(false);
  const catalog = useQuery({ queryKey: ['home-templates'], queryFn: loadTemplates, staleTime: 30_000 });
  const scopes = new Map<string, 'general' | 'specialized'>();
  for (const pack of catalog.data?.packs ?? []) for (const id of pack.recipeIds) scopes.set(id, pack.scope);
  const recipes = catalog.data?.recipes ?? [];
  // General first: a pack's general scope and the general category mean the same thing to people browsing.
  const categories = [...new Set(['general', ...recipes.map(recipe => recipe.category)])].sort((a, b) => Number(b === 'general') - Number(a === 'general') || a.localeCompare(b));
  const hasSpecialized = [...scopes.values()].includes('specialized');
  const matching = recipes.filter(recipe => filter.kind === 'all'
    || (filter.kind === 'specialized' ? scopes.get(recipe.id) === 'specialized'
      : recipe.category === filter.value || (filter.value === 'general' && scopes.get(recipe.id) === 'general')));
  const visible = expanded ? matching : matching.slice(0, INITIAL_COUNT);
  const chips: Array<{ label: string; filter: Filter }> = [
    { label: m['product.home.templatesAll']({}, options), filter: { kind: 'all' } },
    ...categories.map(category => ({ label: category === 'general' ? m['product.home.templatesGeneral']({}, options) : categoryLabel(category), filter: { kind: 'category', value: category } as Filter })),
    ...(hasSpecialized ? [{ label: m['product.home.templatesSpecialized']({}, options), filter: { kind: 'specialized' } as Filter }] : []),
  ];
  const same = (a: Filter, b: Filter) => a.kind === b.kind && (a.kind !== 'category' || a.value === (b as { value: string }).value);

  return (
    <section aria-labelledby="home-templates" className="pb-16">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="home-templates" className="vh-product-display text-xl font-semibold tracking-[-0.03em] text-[var(--vh-text-1)] sm:text-[22px]">{m['product.home.templatesTitle']({}, options)}</h2>
          <p className="mt-1 text-[13px] text-[var(--vh-text-2)]">{m['product.home.templatesDescription']({}, options)}</p>
        </div>
        <Link href="/packs" className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--vh-text-2)] transition hover:text-[var(--vh-text-1)]">{m['product.home.templatesBrowsePacks']({}, options)}<ArrowRight className="size-3.5" /></Link>
      </div>
      <div role="group" aria-label={m['product.home.templatesFilter']({}, options)} className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
        {chips.map(chip => {
          const active = same(chip.filter, filter);
          return <Action key={chip.label} aria-pressed={active} onClick={() => { setFilter(chip.filter); setExpanded(false); }}
            className={cn('h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition', active ? 'border-[var(--color-ink)] bg-[var(--color-ink)] text-white' : 'border-[var(--vh-border)] bg-[var(--vh-surface)] text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]')}>{chip.label}</Action>;
        })}
      </div>
      {catalog.isPending && <p role="status" className="text-sm text-[var(--vh-text-2)]">{m['product.home.templatesLoading']({}, options)}</p>}
      {catalog.error && <p role="alert" className="text-sm text-[var(--vh-text-2)]">{m['product.home.templatesError']({}, options)}</p>}
      {catalog.data && !matching.length && <p className="text-sm text-[var(--vh-text-2)]">{m['product.home.templatesEmpty']({}, options)}</p>}
      <div className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(recipe => {
          const scope = scopes.get(recipe.id);
          return (
            <Link key={recipe.id} href={'/studio?recipe=' + encodeURIComponent(recipe.id)} aria-label={m['product.home.useTemplate']({}, options) + ': ' + recipe.title} className="group block min-w-0">
              <div className="relative aspect-[3/2] overflow-hidden rounded-[var(--vh-radius)] bg-[var(--vh-control)]">
                <img src={templateCover(recipe)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
                {scope && <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-[var(--color-ink)]">{scope === 'general' ? m['product.home.templatesGeneral']({}, options) : m['product.home.templatesSpecialized']({}, options)}</span>}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <h3 className="min-w-0 truncate text-[15px] font-semibold text-[var(--vh-text-1)]">{recipe.title}</h3>
                <span className="shrink-0 text-[12px] text-[var(--vh-text-2)]">{categoryLabel(recipe.category)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-[var(--vh-text-2)]">{recipe.description}</p>
              <p className="mt-1 truncate text-[12px] text-[var(--vh-text-3)]">{recipe.author}</p>
            </Link>
          );
        })}
      </div>
      {matching.length > visible.length && <div className="mt-8 flex justify-center"><Action className="vh-secondary" onClick={() => setExpanded(true)}>{m['product.home.templatesShowAll']({ count: String(matching.length) }, options)}</Action></div>}
    </section>
  );
}

