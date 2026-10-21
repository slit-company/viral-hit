import { useState } from 'react';
import { Action } from '@/components/base/action';
import type { CommunityLibrary } from './use-community';
export function CatalogReviewPanel({ library }: { library: CommunityLibrary }) {
  const review = library.review!,
    [confirmed, setConfirmed] = useState(false);
  return (
    <section
      aria-label="Catalog review"
      className="space-y-5 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-7"
    >
      <header className="space-y-2">
        <p className="text-xs text-[var(--vh-text-2)]">
          {review.previousDigest
            ? 'Review catalog update'
            : 'Review new catalog'}
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
        <p className="break-all text-xs text-[var(--vh-text-2)]">
          Source: {review.source}
        </p>
      )}
      <p className="text-sm">
        {review.catalog.entries.length} entries · {review.changes.added.length}{' '}
        added · {review.changes.changed.length} changed ·{' '}
        {review.changes.removed.length} removed
      </p>
      {!!review.changes.details.length && (
        <p className="text-sm">
          Catalog details changed: {review.changes.details.join(', ')}
        </p>
      )}
      <details className="rounded-xl border border-[var(--vh-border)] p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Entries and changes
        </summary>
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-xs">
          {review.catalog.entries.map((entry) => (
            <li key={entry.id} className="break-words">
              <strong>{entry.title}</strong> · {entry.id} · {entry.kind} ·{' '}
              {entry.scope} · v{entry.version}
              <p className="break-all text-[var(--vh-text-2)]">{entry.url}</p>
            </li>
          ))}
          {review.changes.removed.map((id) => (
            <li key={'removed/' + id}>Removed: {id}</li>
          ))}
        </ul>
      </details>
      <details className="rounded-xl border border-[var(--vh-border)] p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Full catalog JSON
        </summary>
        <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5">
          {JSON.stringify(review.catalog, null, 2)}
        </pre>
      </details>
      <p className="text-xs leading-5 text-[var(--vh-text-2)]">
        Saving adds a searchable list. Its descriptions come from the author.
        Each downloaded skill or pack still needs its own review before
        installation.
      </p>
      <label className="flex items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          className="mt-1.5"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>I reviewed this catalog and its source.</span>
      </label>
      <div className="flex flex-wrap gap-3">
        <Action
          className="vh-secondary"
          disabled={library.busy}
          onClick={library.close}
        >
          Cancel review
        </Action>
        <Action
          className="vh-primary"
          disabled={library.busy || !confirmed}
          onClick={() => void library.save()}
        >
          {library.busy ? 'Saving…' : 'Save catalog'}
        </Action>
      </div>
    </section>
  );
}
