# Maintain recipe packs

An independent author can publish a new release under the same recipe-pack ID. In **Recipe packs** or **Runs → Recipe library**, import its JSON file or review its link, then choose **Review pack update**. The review shows installed/incoming metadata and each full recipe definition. New recipes are added. Existing definitions stay unless you select **Replace** beside that stable recipe ID. Recipes dropped from the new release stay independently installed. Changing a choice clears the final confirmation.

Choose **Download reviewed definitions** to keep a JSON review snapshot containing the current metadata, recipe definitions and memberships before applying changes. This is review evidence, not a directly installable pack file. Build a pack from the retained recipes to share them. Review the selected replacements, confirm the pack ID and choose **Update pack**. A pack whose custom definitions were kept may correctly show **Recipes changed** afterward.

The **Installed packs** list includes packs imported from outside the bundled catalog. **Review removal** removes its listing; recipes are kept by default. Select **Delete** only for recipes to remove too. A recipe referenced by another recipe pack or the file catalog cannot be deleted in this review. Recipes removed by an earlier release are not members and are left alone. Saved runs keep their original execution plans, and project media, timeline edits and creative-pack export snapshots remain.

## Agent and command-line operations

HTTP `POST /api/app/recipe-packs`, MCP `viral_hit_recipe_pack` and CLI use the same application service. HTTP still requires the trusted workspace request header. MCP wraps these objects in `{ "request": ... }`.

1. `review-update` with `pack: <incoming JSON>` returns full `changes`, `incoming.digest`, `stateDigest` and `blocking`.
2. `update` with the exact `pack`, `expectedDigest: incoming.digest`, `expectedStateDigest: stateDigest` and explicit `replaceRecipeIds: []` adds missing recipes and preserves all existing definitions. Include differing existing IDs to replace those definitions. Identical/new/unknown/duplicate IDs are not valid replacements.
3. `review-remove` with `packId` returns current definitions, missing members, file reservations, other memberships and `stateDigest`.
4. `remove` with `packId`, `expectedStateDigest` and explicit `deleteRecipeIds: []` keeps all recipes. Include eligible member IDs for deletion.

```sh
pnpm --dir apps/studio recipe review-update-pack /absolute/release.json
pnpm --dir apps/studio recipe review-remove-pack my-kit
# A JSON request uses exactly the object shape above, with inspected digests.
pnpm --dir apps/studio recipe pack-request /absolute/reviewed-request.json
```

No network work occurs during an update or removal. The transaction compares current pack metadata, affected recipe contents/absence and shared membership against the review. Any mismatch rejects the entire change; no recipes are partly updated. The 200-recipe capacity limit is checked before changes. Updates preserve the original installation time. A new review is necessary after stale state; for an unknown response, list and inspect the actual library before retrying. Removing an already absent pack does nothing to detached recipes.

This lifecycle applies to recipe-only JSON packs. Creative packs combine separate libraries and keep immutable tar snapshots; managing their complete lifecycle remains separate. Runtime modules, automatic update polling and model/service configuration are not installed by these operations.
