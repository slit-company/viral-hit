import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useRef, useState } from 'react';
import { TextField } from '@seed-design/react';
import { ProductShell } from '@/components/marketing/product-shell';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import { useCommunity } from './use-community';
import { CatalogEntries } from './catalog-entries';
import { CatalogReviewPanel } from './catalog-review';

export function CommunityPage({ locale }: { locale: string }) {
  const library = useCommunity(),
    input = useRef<HTMLInputElement>(null),
    panel = useRef<HTMLDivElement>(null),
    [url, setUrl] = useState('');
  useEffect(() => {
    if (library.review) panel.current?.scrollIntoView({ block: 'start' });
  }, [library.review]);
  return (
    <ProductShell active="extensions" locale={locale}>
      <main className="mx-auto w-full max-w-[1120px] space-y-8 px-5 pb-12 pt-14 sm:px-6">
        <header className="space-y-4">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]"> {uiMessages["ui.community.community_catalogs"]()} </p>
          <h1 className="vh-product-display text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.04em]"> {uiMessages["ui.community.find_another_way_to_create"]()} </h1>
          <p className="max-w-2xl text-[15px] leading-6 text-[var(--vh-text-2)]"> {uiMessages["ui.community.browse_general_toolkits_and_workflows_made_for_a_particular_job_add_a_catal"]()} </p>
          <Link
            href="/extensions"
            className="inline-block text-sm underline underline-offset-4"
          > {uiMessages["ui.community.inspect_installed_extensions"]()} </Link>
        </header>
        <form
          aria-label={uiMessages["ui.community.add_a_community_catalog"]()}
          className="space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void library.fetchLink(url);
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <label htmlFor="community-link" className="text-sm font-medium"> {uiMessages["ui.community.catalog_link"]()} </label>
              <TextField.Root className="vh-field">
                <TextField.Input
                  id="community-link"
                  aria-label={uiMessages["ui.community.catalog_link"]()}
                  type="url"
                  value={url}
                  maxLength={2000}
                  disabled={!library.catalogs || library.busy}
                  placeholder="https://…/creative-tools.viralhit-catalog.json"
                  onChange={(event) => setUrl(event.target.value)}
                />
              </TextField.Root>
            </div>
            <Action
              type="submit"
              disabled={
                !library.catalogs ||
                library.busy ||
                !/^https:\/\/\S+$/.test(url.trim())
              }
              className="vh-primary"
            > {uiMessages["ui.community.review_catalog_link"]()} </Action>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Action
              disabled={!library.catalogs || library.busy}
              className="vh-secondary"
              onClick={() => input.current?.click()}
            > {uiMessages["ui.community.import_catalog_file"]()} </Action>
            <p className="text-xs text-[var(--vh-text-2)]"> {uiMessages["ui.community.public_https_or_github_json_up_to_200_entries"]()} </p>
          </div>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            aria-label={uiMessages["ui.community.import_catalog_file"]()}
            className="hidden"
            onChange={(event) => {
              void library.importFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </form>
        {library.notice && (
          <p
            role="status"
            className="rounded-xl bg-[var(--color-brand-lime-soft)] p-4 text-sm text-[var(--color-lime-text)]"
          >
            {library.notice}
          </p>
        )}
        {library.error && (
          <p
            role="alert"
            className="break-words rounded-xl bg-red-500/10 p-4 text-sm text-red-800"
          >
            {library.error}
          </p>
        )}
        {library.busy && !library.review && (
          <div className="flex items-center gap-3">
            <p role="status" className="text-sm">
              {library.activity}
            </p>
            {library.canCancel && (
              <Action className="vh-secondary" onClick={library.close}> {uiMessages["product.history.cancel"]()} </Action>
            )}
          </div>
        )}
        <div ref={panel} className="scroll-mt-24">
          {library.review && (
            <CatalogReviewPanel
              key={library.review.digest + library.review.previousDigest}
              library={library}
            />
          )}
        </div>
        {library.catalogs && !library.review && (
          <>
            <CatalogEntries catalogs={library.catalogs} />
            <details className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5">
              <summary className="cursor-pointer font-semibold"> {uiMessages["ui.community.manage_catalogs"]()}{library.catalogs.length})
              </summary>
              <ul className="mt-5 space-y-5">
                {library.catalogs.map((item) => (
                  <li
                    key={item.catalog.id}
                    className="space-y-3 border-t border-[var(--vh-border)] pt-4"
                  >
                    <div>
                      <h2 className="break-words font-semibold">
                        {item.catalog.title}
                      </h2>
                      <p className="break-all text-xs leading-5 text-[var(--vh-text-2)]">
                        {item.catalog.id} · {item.catalog.entries.length}{' '} {uiMessages["ui.community.entries_2"]()} {item.source ?? uiMessages["ui.community.imported_from_a_file"]()}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.source && (
                        <Action
                          className="vh-secondary text-xs"
                          disabled={library.busy}
                          aria-label={uiMessages["ui.community.review_changes_to"]() + item.catalog.id}
                          onClick={() => void library.fetchLink(item.source!)}
                        > {uiMessages["ui.community.review_latest"]()} </Action>
                      )}
                      <Action
                        className="vh-secondary text-xs"
                        disabled={library.busy}
                        aria-label={uiMessages["ui.community.download_catalog"]() + item.catalog.id}
                        onClick={() => library.download(item)}
                      > {uiMessages["ui.community.download_catalog_2"]()} </Action>
                      <Action
                        className="vh-secondary text-xs"
                        disabled={library.busy}
                        aria-label={uiMessages["ui.community.remove_catalog"]() + item.catalog.id}
                        onClick={() => void library.remove(item)}
                      > {uiMessages["ui.community.remove_catalog_2"]()} </Action>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-5 text-[var(--vh-text-2)]"> {uiMessages["ui.community.saved_lists_work_offline_review_latest_checks_only_the_selected_catalog_rem"]()} </p>
            </details>
          </>
        )}
      </main>
    </ProductShell>
  );
}
