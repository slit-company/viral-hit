import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { Action } from '@/components/base/action';
import type { CommunityLibrary } from './use-community';
export function CatalogReviewPanel({ library }: { library: CommunityLibrary }) {
  const review = library.review!,
    [confirmed, setConfirmed] = useState(false);
  return (
    <section
      aria-label={uiMessages["ui.community.catalog_review"]()}
      className="space-y-5 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-7"
    >
      <header className="space-y-2">
        <p className="text-xs text-[var(--vh-text-2)]">
          {review.previousDigest
            ? uiMessages["ui.community.review_catalog_update"]()
            : uiMessages["ui.community.review_new_catalog"]()}
        </p>
        <h2 className="break-words text-xl font-semibold">
          {review.catalog.title}
        </h2>
        <p className="break-all text-xs text-[var(--vh-text-2)]">
          {review.catalog.id} · {review.catalog.author}
        </p>
        <p className="text-sm leading-6">{review.catalog.description}</p>
      </header>
      {review.source && (
        <p className="break-all text-xs text-[var(--vh-text-2)]"> {uiMessages["ui.community.source"]()} {review.source}
        </p>
      )}
      <p className="text-sm">
        {review.catalog.entries.length} {uiMessages["ui.community.entries"]()} {review.changes.added.length}{' '} {uiMessages["ui.community.added"]()} {review.changes.changed.length} {uiMessages["ui.community.changed"]()}{' '}
        {review.changes.removed.length} {uiMessages["ui.community.removed"]()} </p>
      {!!review.changes.details.length && (
        <p className="text-sm"> {uiMessages["ui.community.catalog_details_changed"]()} {review.changes.details.join(', ')}
        </p>
      )}
      <details className="rounded-xl border border-[var(--vh-border)] p-4">
        <summary className="cursor-pointer text-sm font-medium"> {uiMessages["ui.community.entries_and_changes"]()} </summary>
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-xs">
          {review.catalog.entries.map((entry) => (
            <li key={entry.id} className="break-words">
              <strong>{entry.title}</strong> · {entry.id} · {entry.kind} ·{' '}
              {entry.scope} · v{entry.version}
              <p className="break-all text-[var(--vh-text-2)]">{entry.url}</p>
            </li>
          ))}
          {review.changes.removed.map((id) => (
            <li key={'removed/' + id}>{uiMessages["ui.community.removed_2"]()} {id}</li>
          ))}
        </ul>
      </details>
      <details className="rounded-xl border border-[var(--vh-border)] p-4">
        <summary className="cursor-pointer text-sm font-medium"> {uiMessages["ui.community.full_catalog_json"]()} </summary>
        <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5">
          {JSON.stringify(review.catalog, null, 2)}
        </pre>
      </details>
      <p className="text-xs leading-5 text-[var(--vh-text-2)]"> {uiMessages["ui.community.saving_adds_a_searchable_list_its_descriptions_come_from_the_author_each_do"]()} </p>
      <label className="flex items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          className="mt-1.5"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>{uiMessages["ui.community.i_reviewed_this_catalog_and_its_source"]()}</span>
      </label>
      <div className="flex flex-wrap gap-3">
        <Action
          className="vh-secondary"
          disabled={library.busy}
          onClick={library.close}
        > {uiMessages["ui.community.cancel_review"]()} </Action>
        <Action
          className="vh-primary"
          disabled={library.busy || !confirmed}
          onClick={() => void library.save()}
        >
          {library.busy ? uiMessages["ui.common.saving"]() : uiMessages["ui.community.save_catalog"]()}
        </Action>
      </div>
    </section>
  );
}
