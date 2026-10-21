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
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]">
            RECIPE PACKS
          </p>
          <h1 className="vh-product-display text-4xl font-semibold tracking-tight">
            Workflows for your next project.
          </h1>
          <p className="text-sm leading-6 text-[var(--vh-text-2)]">
            Review and add recipes to your library. Open a project and choose
            Runs when you are ready to use one.
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/community" className="underline underline-offset-4">
              Browse community catalogs
            </Link>
            <Link href="/packs" className="underline underline-offset-4">
              Creative packs
            </Link>
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
              shared={shared}
              onMakePack={() => setBuilding(true)}
              onInstalled={async (pack) =>
                setNotice(
                  pack.title +
                    ' is in your recipe library. No jobs were started.',
                )
              }
            />
          )}
        </div>
      </main>
    </ProductShell>
  );
}
