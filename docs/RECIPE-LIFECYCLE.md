# Maintaining installed recipes

Installed recipes can be updated under the same ID or removed through **Runs → Recipe library**, MCP and CLI. Recipes from the bundled or operator-configured file directory stay owned by that directory; duplicate those into a new ID to maintain a separate copy.

## Review an update

Select the recipe in Runs, open Recipe library and choose **Edit installed recipe**, or import/paste an incoming definition with the same ID. Edit the JSON and choose **Inspect JSON**. A different installed definition produces an update review with the current and incoming versions, both complete JSON definitions, and affected recipe packs. Download the installed definition before replacing it if you want a portable backup. Confirm both definitions and choose **Update recipe**.

The write compares the incoming reviewed digest and the installed digest. Any changed content in either definition requires another inspection. Identical retries converge on the same state. Versions are author labels; content hashes determine conflicts, including edits that keep the same version label. Unknown runtime operations can be retained as portable data, but execution still requires their installed adapters. This operation does not run the recipe.

## Review removal

Select **Review removal** to read the current installed definition and affected packs. The removal screen has a JSON download and explicit confirmation. **Remove recipe** deletes only that reviewed library definition. A concurrent replacement causes a conflict; cancel and review removal again to see the current version. A repeated removal of an already absent ID does nothing. Reinstall from a retained JSON file or reviewed pack if needed.

Saved run inputs, fingerprints, receipts, project media and timeline edits remain. Queued work executes the plan already stored by the harness, even if its recipe definition is later removed. Removal is not job cancellation. Creative-pack exports preserve their original recipe snapshots, so editing a live library recipe does not change an old pack export.

## Recipe packs after local changes

A recipe pack records the originally installed composition. Discovery compares its digest with its current member definitions and reports **complete**, **modified** or **missing**. The UI displays changed or missing installed packs, including those imported from outside the bundled catalog.

Reimport and review the original pack to restore missing members. The existing installation operation checks every recipe in one transaction even when the pack identity is already known. It reuses exact members and restores absent ones; any existing changed definition blocks the whole operation. It never resets an author's local edit just because an old pack was reimported. Pack-wide replacement/removal remains separate work.

## Runs opened before another update

HTTP and MCP recipe discovery return `recipeDigests` and `installedIds`. The Runs UI sends the digest of its loaded recipe as `expectedRecipeDigest` when checking or submitting it. If another client changes the definition, the submission fails before enqueue or provider work. Close and reopen Runs, review the current definition/inputs, then submit. Existing agents can omit this optional field to explicitly use the latest definition; agents reviewing a specific revision should pass it. Already queued plans remain self-contained.

## Shared interface

`viral_hit_recipe_library` and POST `/api/app/recipes` share these actions. HTTP requires the trusted workspace mutation header.

| Action | Fields / result |
|---|---|
| `get` | `recipeId`; current recipe and digest, suitable for export |
| `inspect` | `manifest`; recipe, digest, collision, operations and optional `update.current`, `update.digest`, affected packs |
| `install` | `manifest`, `expectedDigest`; installs a new ID or reuses identical contents |
| `update` | `manifest`, `expectedDigest`, `expectedInstalledDigest`; replaces only the reviewed installed definition |
| `review-remove` | `recipeId`; current definition, digest and affected packs |
| `remove` | `recipeId`, `expectedDigest`; removes the matching installed definition |

From `apps/studio`:

```sh
pnpm recipe inspect /absolute/incoming.json
pnpm recipe update /absolute/incoming.json INCOMING_DIGEST INSTALLED_DIGEST
pnpm recipe review-remove my-recipe
pnpm recipe export my-recipe /absolute/new-backup.json
pnpm recipe remove my-recipe REVIEWED_DIGEST
```

Use the actual digest strings returned by inspection. Export never overwrites a file. Updates/removals use the existing `recipe-library.sqlite`, with 200 active recipes and 128,000 bytes per definition. They add no dependency, background process, duplicate version archive or polling. Back up the data directory or export a reviewed definition when retaining an older version matters. See [storage and execution boundaries](architecture/RECIPE-LIFECYCLE.md).
