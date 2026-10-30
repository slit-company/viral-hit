import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { TextField } from '@seed-design/react';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import {
  catalogEntryHref,
  type CatalogEntry,
  type SavedCatalog,
} from '@/core/community/contract';
export const entryKindLabels = {
  skill: 'Skill',
  'recipe-pack': 'Recipe pack',
  'creative-pack': 'Creative pack',
  'runtime-package': 'Runtime package',
};

export function CatalogEntries({ catalogs }: { catalogs: SavedCatalog[] }) {
  const [query, setQuery] = useState(''),
    [scope, setScope] = useState('all'),
    [kind, setKind] = useState('all'),
    [page, setPage] = useState(0);
  const entries = catalogs
    .flatMap((item) =>
      item.catalog.entries.map((entry) => ({ catalog: item.catalog, entry })),
    )
    .filter(
      ({ catalog, entry }) =>
        (scope === 'all' || entry.scope === scope) &&
        (kind === 'all' || entry.kind === kind) &&
        [
          entry.title,
          entry.id,
          entry.summary,
          ...entry.tags,
          catalog.title,
          catalog.id,
          catalog.author,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    );
  const current = Math.min(
      page,
      Math.max(0, Math.ceil(entries.length / 24) - 1),
    ),
    visible = entries.slice(current * 24, (current + 1) * 24);
  return (
    <section aria-label={uiMessages["ui.community.discover_entries"]()} className="scroll-mt-24 space-y-5">
      <div className="space-y-2">
        <label htmlFor="catalog-search" className="text-sm font-medium"> {uiMessages["ui.community.find_a_workflow"]()} </label>
        <TextField.Root className="vh-field">
          <TextField.Input
            id="catalog-search"
            aria-label={uiMessages["ui.community.find_a_workflow"]()}
            placeholder={uiMessages["ui.community.search_titles_tags_authors_or_ids"]()}
            value={query}
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </TextField.Root>
      </div>
      <div
        role="group"
        aria-label={uiMessages["ui.community.filter_by_scope"]()}
        className="flex flex-wrap gap-2"
      >
        {[
          ['all', uiMessages["ui.community.all_uses"]()],
          ['general', uiMessages["ui.creative-packs.general"]()],
          ['specialized', uiMessages["ui.app.for_a_specific_job"]()],
        ].map(([value, label]) => (
          <Action
            key={value}
            aria-pressed={scope === value}
            className={scope === value ? 'vh-primary' : 'vh-secondary'}
            onClick={() => {
              setScope(value);
              setPage(0);
            }}
          >
            {label}
          </Action>
        ))}
      </div>
      <div
        role="group"
        aria-label={uiMessages["ui.community.filter_by_kind"]()}
        className="flex flex-wrap gap-2"
      >
        {[['all', uiMessages["ui.community.all_types"]()], ...Object.entries(entryKindLabels)].map(
          ([value, label]) => (
            <Action
              key={value}
              aria-pressed={kind === value}
              className={kind === value ? 'vh-primary' : 'vh-secondary'}
              onClick={() => {
                setKind(value);
                setPage(0);
              }}
            >
              {label}
            </Action>
          ),
        )}
      </div>
      <p role="status" className="text-xs text-[var(--vh-text-2)]">
        {entries.length
          ? `${current * 24 + 1}–${Math.min((current + 1) * 24, entries.length)} of ${entries.length} entries`
          : uiMessages["ui.community.no_matching_entries_try_another_filter_or_add_a_catalog"]()}
      </p>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map(({ catalog, entry }) => (
          <li
            key={catalog.id + '/' + entry.id}
            className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5"
          >
            <div className="flex flex-wrap gap-2 text-[11px] text-[var(--vh-text-2)]">
              <span className="rounded-full bg-[var(--vh-control)] px-2 py-1">
                {entryKindLabels[entry.kind]}
              </span>
              <span className="py-1">
                {entry.scope === 'general' ? uiMessages["ui.creative-packs.general"]() : uiMessages["ui.app.for_a_specific_job"]()} ·
                v{entry.version}
              </span>
            </div>
            <h3 className="break-words font-semibold">{entry.title}</h3>
            <p className="break-words text-sm leading-6 text-[var(--vh-text-2)]">
              {entry.summary}
            </p>
            <p className="break-all font-mono text-[11px] text-[var(--vh-text-2)]">
              {catalog.id}/{entry.id}
            </p>
            <p className="break-words text-xs text-[var(--vh-text-2)]"> {uiMessages["ui.app.from"]()} {catalog.title} · {catalog.author}
            </p>
            {!!entry.tags.length && (
              <p className="break-words text-xs text-[var(--vh-text-2)]">
                {entry.tags.join(' · ')}
              </p>
            )}
            <EntryLink entry={entry} catalogId={catalog.id} />
          </li>
        ))}
      </ul>
      {entries.length > 24 && (
        <div className="flex items-center gap-3">
          <Action
            className="vh-secondary"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          > {uiMessages["ui.community.previous"]()} </Action>
          <span className="text-xs"> {uiMessages["ui.community.page"]()} {current + 1} {uiMessages["ui.community.of"]()} {Math.ceil(entries.length / 24)}
          </span>
          <Action
            className="vh-secondary"
            disabled={(current + 1) * 24 >= entries.length}
            onClick={() => setPage(current + 1)}
          > {uiMessages["ui.community.next"]()} </Action>
        </div>
      )}
    </section>
  );
}
function EntryLink({
  entry,
  catalogId,
}: {
  entry: CatalogEntry;
  catalogId: string;
}) {
  return (
    <Link
      href={catalogEntryHref(entry)}
      aria-label={
        uiMessages["ui.characters.open"]() + entry.title + ' (' + catalogId + '/' + entry.id + ')'
      }
      className="vh-secondary mt-auto inline-flex min-h-11 items-center justify-center rounded-full px-4 text-xs font-semibold"
    >
      {uiMessages["ui.community.open_in"]()}{entry.kind === 'skill' ? 'Skills' : entry.kind === 'runtime-package' ? 'Runtime packages' : 'Packs'}
    </Link>
  );
}
