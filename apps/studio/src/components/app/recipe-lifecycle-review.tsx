import { Action } from '@/components/base/action';
import type { Recipe } from '@/core/harness/recipes';
import type { PackSummary } from '@/core/harness/recipe-packs';
import { downloadRecipe, type RecipeLibraryState } from './use-recipe-library';

export function RecipeDefinition({
  title,
  recipe,
}: {
  title: string;
  recipe: Recipe;
}) {
  return (
    <details className="rounded-xl border border-[var(--vh-border)] p-3">
      <summary className="cursor-pointer font-medium">
        {title} · v{recipe.version}
      </summary>
      <pre
        aria-label={title}
        className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5"
      >
        {JSON.stringify(recipe, null, 2)}
      </pre>
    </details>
  );
}
function PackImpact({ packs }: { packs: PackSummary[] }) {
  return (
    <>
      {!!packs.length && (
        <p className="break-words">
          Affects recipe packs:{' '}
          {packs.map((pack) => `${pack.title} (${pack.id})`).join(', ')}. Their
          catalog will show changed or missing recipes.
        </p>
      )}
      <p className="text-[var(--vh-text-2)]">
        Saved runs keep their execution plans. Project media, timeline edits and
        creative-pack snapshots are kept. New runs use the current library
        definition.
      </p>
    </>
  );
}
export function RecipeUpdateReview({
  library,
}: {
  library: RecipeLibraryState;
}) {
  const review = library.inspection!,
    update = review.update!;
  return (
    <div className="space-y-3 border-t border-[var(--vh-border)] pt-3">
      <h4 className="text-sm font-semibold">Review recipe update</h4>
      <p>
        Replace installed v{update.current.version} with v
        {review.recipe.version} under the same ID.
      </p>
      <RecipeDefinition title="Installed definition" recipe={update.current} />
      <RecipeDefinition title="Incoming definition" recipe={review.recipe} />
      <PackImpact packs={update.packs} />
      <Action
        onClick={() => downloadRecipe(update.current)}
        className="text-xs underline"
      >
        Download installed JSON
      </Action>
      <label className="flex items-start gap-2 leading-5">
        <input
          type="checkbox"
          checked={library.confirmed}
          onChange={(event) => library.setConfirmed(event.target.checked)}
          className="mt-1"
        />
        <span>
          I reviewed both definitions and want to update{' '}
          <strong className="break-all">{review.recipe.id}</strong>.
        </span>
      </label>
    </div>
  );
}
export function RecipeRemovalPanel({
  library,
}: {
  library: RecipeLibraryState;
}) {
  const review = library.removal!;
  return (
    <section
      aria-label="Recipe removal review"
      className="space-y-4 rounded-xl border border-[var(--vh-border)] p-4 text-xs leading-5"
    >
      <h3 className="break-words text-base font-semibold">
        Remove {review.recipe.title}?
      </h3>
      <p className="break-all">
        {review.recipe.id} · v{review.recipe.version}
      </p>
      <p className="break-words">{review.recipe.description}</p>
      <RecipeDefinition title="Definition to remove" recipe={review.recipe} />
      <PackImpact packs={review.packs} />
      <Action
        onClick={() => downloadRecipe(review.recipe)}
        className="text-xs underline"
      >
        Download recipe before removal
      </Action>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={library.confirmed}
          onChange={(event) => library.setConfirmed(event.target.checked)}
          className="mt-1"
        />
        <span>
          Remove the reviewed{' '}
          <strong className="break-all">{review.recipe.id}</strong> definition
          from the library.
        </span>
      </label>
      {library.error && (
        <p
          role="alert"
          className="break-words rounded-lg bg-red-500/10 p-3 text-red-800"
        >
          {library.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Action
          disabled={library.busy}
          className="vh-secondary"
          onClick={library.dismissRemoval}
        >
          Cancel removal
        </Action>
        <Action
          disabled={library.busy || !library.confirmed}
          className="vh-primary"
          onClick={() => void library.remove()}
        >
          {library.busy ? 'Removing…' : 'Remove recipe'}
        </Action>
      </div>
    </section>
  );
}
