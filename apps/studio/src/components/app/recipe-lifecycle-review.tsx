import { m as uiMessages } from '@/paraglide/messages.js';
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
        <p className="break-words"> {uiMessages["ui.app.affects_recipe_packs"]()}{' '}
          {packs.map((pack) => `${pack.title} (${pack.id})`).join(', ')}{uiMessages["ui.app.their_catalog_will_show_changed_or_missing_recipes"]()} </p>
      )}
      <p className="text-[var(--vh-text-2)]"> {uiMessages["ui.app.saved_runs_keep_their_execution_plans_project_media_timeline_edits_and_crea"]()} </p>
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
      <h4 className="text-sm font-semibold">{uiMessages["ui.app.review_recipe_update"]()}</h4>
      <p> {uiMessages["ui.app.replace_installed_v"]()}{update.current.version} {uiMessages["ui.app.with_v"]()} {review.recipe.version} {uiMessages["ui.app.under_the_same_id"]()} </p>
      <RecipeDefinition title={uiMessages["ui.app.installed_definition"]()} recipe={update.current} />
      <RecipeDefinition title={uiMessages["ui.app.incoming_definition"]()} recipe={review.recipe} />
      <PackImpact packs={update.packs} />
      <Action
        onClick={() => downloadRecipe(update.current)}
        className="text-xs underline"
      > {uiMessages["ui.app.download_installed_json"]()} </Action>
      <label className="flex items-start gap-2 leading-5">
        <input
          type="checkbox"
          checked={library.confirmed}
          onChange={(event) => library.setConfirmed(event.target.checked)}
          className="mt-1"
        />
        <span> {uiMessages["ui.app.i_reviewed_both_definitions_and_want_to_update"]()}{' '}
          <strong className="break-all">{review.recipe.id}</strong>{uiMessages["ui.publishing.open_editor_end"]()}</span>
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
      aria-label={uiMessages["ui.app.recipe_removal_review"]()}
      className="space-y-4 rounded-xl border border-[var(--vh-border)] p-4 text-xs leading-5"
    >
      <h3 className="break-words text-base font-semibold"> {uiMessages["ui.app.remove"]()} {review.recipe.title}?
      </h3>
      <p className="break-all">
        {review.recipe.id} · v{review.recipe.version}
      </p>
      <p className="break-words">{review.recipe.description}</p>
      <RecipeDefinition title={uiMessages["ui.app.definition_to_remove"]()} recipe={review.recipe} />
      <PackImpact packs={review.packs} />
      <Action
        onClick={() => downloadRecipe(review.recipe)}
        className="text-xs underline"
      > {uiMessages["ui.app.download_recipe_before_removal"]()} </Action>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={library.confirmed}
          onChange={(event) => library.setConfirmed(event.target.checked)}
          className="mt-1"
        />
        <span> {uiMessages["ui.app.remove_the_reviewed"]()}{' '}
          <strong className="break-all">{review.recipe.id}</strong> {uiMessages["ui.app.definition_from_the_library"]()} </span>
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
        > {uiMessages["ui.app.cancel_removal"]()} </Action>
        <Action
          disabled={library.busy || !library.confirmed}
          className="vh-primary"
          onClick={() => void library.remove()}
        >
          {library.busy ? uiMessages["ui.common.removing"]() : uiMessages["ui.app.remove_recipe"]()}
        </Action>
      </div>
    </section>
  );
}
