import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { ProductShell } from '@/components/marketing/product-shell';
import { RecipePacks } from '@/components/app/recipe-packs';
import { PackBuilder } from '@/components/app/pack-builder';
import { Link } from '@/core/i18n/navigation';
import type { CatalogHandoff } from '@/core/community/contract';

export function RecipePacksPage({
  locale,
  shared,
}: {
  locale: string;
  shared: CatalogHandoff;
}) {
  const [building, setBuilding] = useState(false),
    [notice, setNotice] = useState('');
  return (
    <ProductShell active="packs" locale={locale}>
      <main className="mx-auto w-full max-w-[960px] space-y-8 px-5 pb-12 pt-14 sm:px-6">
        <header className="space-y-4">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]"> {uiMessages["ui.community.recipe_packs"]()} </p>
          <h1 className="vh-product-display text-4xl font-semibold tracking-tight"> {uiMessages["ui.community.workflows_for_your_next_project"]()} </h1>
          <p className="text-sm leading-6 text-[var(--vh-text-2)]"> {uiMessages["ui.community.review_and_add_recipes_to_your_library_open_a_project_and_choose_runs_when_"]()} </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/community" className="underline underline-offset-4"> {uiMessages["ui.community.browse_community_catalogs"]()} </Link>
            <Link href="/packs" className="underline underline-offset-4"> {uiMessages["ui.community.creative_packs"]()} </Link>
          </div>
        </header>
        {notice && (
          <p
            role="status"
            className="rounded-xl bg-[var(--color-brand-lime-soft)] p-4 text-sm text-[var(--color-lime-text)]"
          >
            {notice}
          </p>
        )}
        <div className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-7">
          {building ? (
            <PackBuilder onBack={() => setBuilding(false)} />
          ) : (
            <RecipePacks
              onRemoved={async (pack) => setNotice(uiMessages["ui.app.pack_removed"]({ name: pack.title }))}
              shared={shared}
              onMakePack={() => setBuilding(true)}
              onInstalled={async (pack) =>
                setNotice(
                  uiMessages["ui.community.pack_ready"]({ name: pack.title }),
                )
              }
            />
          )}
        </div>
      </main>
    </ProductShell>
  );
}
