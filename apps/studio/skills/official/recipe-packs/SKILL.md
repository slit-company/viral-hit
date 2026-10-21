# Recipe packs

Use this skill when someone wants a ready-made workflow, wants Viral Hit set up for a particular job (vertical reels, slide stories, a team's campaign format), or wants to share workflows they made. Packs group recipes and are labeled `general` (fits any project) or `specialized` (one format, job or audience). Recipe-only packs add recipes to the local library. If the request also includes agent skills or characters/reference images, follow **Share a complete creative setup** below with `viral_hit_creative_pack`. It never queues runs, generates media or publishes.

## Find a pack

1. Call `viral_hit_recipe_pack` with `{ "request": { "action": "list" } }`. `available` lists packs offered by this installation with `state` `available`, `installed` or `other-version`; `installed` lists what is already in the library.
2. Match the request to `summary.scope`, `summary.useCases`, `summary.title` and `summary.description`. Prefer a `specialized` pack when the user names a specific format or job, and a `general` pack when they want building blocks for any project. If two fit, say how they differ in one sentence each.
3. If the user gave a pack link, call `{ "action": "fetch", "url": "..." }` instead. Only HTTPS links on the public internet work; a GitHub file page is converted to its raw file. Report the returned error as is if the link is not a pack.
4. If nothing fits, say so and offer to build a pack from recipes the user already has (see below). Do not invent pack names.

## Discover independent catalogs

Use this path when the user supplies a catalog or wants options beyond this installation's offered packs. A catalog is metadata hosted by its author; it can mix general and specialized skills, recipe packs and creative packs.

1. Call `viral_hit_community` with `{ "request": { "action": "list" } }` to read saved catalogs without networking. Match entries by `scope`, `kind`, title, summary and tags. Always identify an entry by both catalog ID and entry ID; titles can repeat. Do not claim its author descriptions establish runtime compatibility or creative quality.
2. For a catalog link, call `{ "request": { "action": "fetch", "url": "..." } }`. For a local catalog JSON, use `inspect` with `catalog`. Review source, author, full entries, `changes` and both digests. Saving is optional; when the user asks to add it, use `save` with the exact `catalog`, `source`, `expectedDigest` and `expectedPreviousDigest` from review. This installs nothing. `fetch` again checks a saved source only when requested; an old snapshot is still usable offline.
3. To use a selected entry, call the matching library's `fetch`: `viral_hit_skill_library` for `skill`, `viral_hit_recipe_pack` for `recipe-pack`, `viral_hit_creative_pack` for `creative-pack`. Pass `url: entry.url` and **`expectedSha256: entry.sha256`**. Creative packs additionally need a new absolute `path`. Never drop the checksum after a mismatch or substitute a different download. Refresh the catalog and review its change, or report the mismatch.
4. Read the returned skill/recipe inspection, or inspect the retained creative-pack file, then follow that library's installation flow. Keep retained contents and the inspection digest; do not refetch between review and install. Check actual library state afterward. Catalog scope/version are author labels; the inspected artifact is authoritative.
5. If asked to remove a discovery source, use `remove` with catalog `id` and its reviewed `expectedDigest`. Installed skills, recipes and characters remain. Removing an installed item uses that library's separate lifecycle.

## Review before installing

1. For an offered pack, call `{ "action": "inspect", "pack": <available[i].manifest> }`. A fetched link already returns `inspection`.
2. Show the user: title, version, scope, each recipe title with its input count, `requirements` (setup outside the studio), `unavailableOperations` (steps this installation cannot run yet) and every `blocking` reason.
3. Do not install when `blocking` is non-empty. For a different version of an installed recipe pack, use the reviewed pack-update workflow below. Plain installation still cannot overwrite it.
4. Install when the user asks for it or the request clearly includes installing: `{ "action": "install", "pack": <the exact reviewed manifest>, "expectedDigest": <inspection.pack.digest> }`. Never edit the manifest between review and install; a changed manifest is rejected.
5. Confirm with `viral_hit_recipes_list` that every `recipeIds` entry is present. Tell the user the recipes appear in **Runs** grouped under the pack name. If `requirements` or `unavailableOperations` were present, repeat what still needs to be installed before those recipes can run.

## Build and share a pack

1. Call `viral_hit_recipes_list` and agree with the user on which recipes belong together (up to 24). If a recipe the user names is not installed but appears in an offered pack's `recipeIds` from the `list` result, review and install that pack first as described above, then build.
2. Choose the scope with the user: `general` if it helps any project, `specialized` if it encodes a particular format, brand, audience or job. Ask for a title, a short description of what it is for and what people must bring, author and license. Use short lowercase use cases such as `product-ad`.
3. Call `{ "action": "build", "pack": { "id", "title", "description", "author", "license", "scope", "useCases", "recipeIds" } }`. The pack ID is lowercase letters, numbers and hyphens, at most 40 characters; recipe IDs gain it as a prefix. Contents, authors and licenses of each recipe stay unchanged.
4. Give the user the returned `manifest` as a JSON file if you can write files, otherwise show where to save it. Explain that others install it with **Import pack file**, **Add from link** (for example a GitHub file in a public repository) or the `fetch` action. Building installs nothing.
5. Keep private rules, account details, credentials and brand assets out of descriptions and recipe defaults before the user shares a pack.

## Share a complete creative setup

Use this path when a pack needs skills or characters as well as recipes, or when the user gives a `.viralhit-pack.tar` file or a public HTTPS/GitHub link to one. Any subset is valid: a general skills-only kit and a specialized host + recipes + skills kit use the same format. Keep each original skill instruction and character rule unchanged.

1. Call `viral_hit_creative_pack` with `{ "request": { "action": "list" } }`. Select only actual recipe, skill and character IDs from its catalog. Missing items must be created or installed through their own libraries first; never invent them. In particular, installing a recipe pack alone does not install a named skill or character.
2. For creation, use the title, description, author, license, scope, use cases and chosen contents the user supplied. Ask only for material missing choices. Call `{ "request": { "action": "build", "path": "/absolute/new-file.viralhit-pack.tar", "pack": { "id", "version": "1.0.0", "title", "description", "author", "license", "scope", "useCases", "recipeIds": [], "skillIds": [], "characterIds": [] } } }`. Building writes a new file and never overwrites an existing one. Recipe IDs gain the pack prefix; skill and character IDs are preserved. All character reference images, rules, voice notes and provider identities travel with it, so explain that sharing includes those selected contents.
3. For a link, first call `{ "request": { "action": "fetch", "url": "https://host.example/my-kit.viralhit-pack.tar", "path": "/absolute/new-download.viralhit-pack.tar" } }`. This only downloads bytes (`inspected: false`); it does not validate or install contents. Keep the returned file. For that downloaded file or a received local file, call `{ "request": { "action": "inspect", "path": "/absolute/file.viralhit-pack.tar" } }`. Summarize scope, counts, setup needs, full skill purposes/instructions, character identity rules and every conflict from `blocking`. The UI's **Packs → Import creative pack** or **Add from link → Review link** also displays the actual reference images for review. Do not claim to have visually inspected images based only on the MCP metadata.
4. If installation is authorized and there are no blockers, call `{ "request": { "action": "install", "path": "/absolute/file.viralhit-pack.tar", "expectedDigest": "<inspection.pack.digest>" } }`. Install the retained file with the reviewed digest; never fetch the URL again between review and install. Check `complete`, not just HTTP/tool success. On `complete: false`, report which `items` succeeded and `error`; after resolving that cause, inspect and retry the same file. Matching contents are reused, so retry does not duplicate characters or skills. Conflicting IDs are never overwritten; ask the author for a new ID or use the existing content.
5. Call `list` to verify the installed pack and every selected library entry. An installed pack exports its original snapshot with `{ "request": { "action": "export", "id": "<pack-id>", "path": "/absolute/new-copy.viralhit-pack.tar" } }`, even if a local character has been edited since installation. Return the actual file path and say whether it was merely built or actually installed.
6. No skills execute, jobs queue, models generate or posts publish during these steps. Creative pack `fetch` downloads a tar file to a new path; recipe-only `fetch` reads a JSON recipe pack. Choose the tool by the shared format, not by whether its contents are general or specialized.

## Maintain a recipe pack

For an authorized same-ID update, keep the exact incoming JSON and call `viral_hit_recipe_pack` with `{ "request": { "action": "review-update", "pack": <manifest> } }`. Show installed/incoming metadata and complete definitions for each `changes` entry. Explain additions, identical recipes, differing definitions and dropped recipes. Download or retain the review as a backup. `blocking` must be empty. Existing recipes are preserved by default; only include differing IDs the user wants replaced in `replaceRecipeIds`. Shared replacements also affect the listed `otherPacks`. Recipes dropped from the release remain independently installed.

Apply `{ "request": { "action": "update", "pack": <same manifest>, "expectedDigest": <review.incoming.digest>, "expectedStateDigest": <review.stateDigest>, "replaceRecipeIds": [] } }`. Empty selection keeps all existing definitions while adding missing recipes and adopting the release metadata. Kept custom definitions can correctly leave the pack `content.state` modified. Verify `list` and the actual recipes afterward. Stale reviews and unknown outcomes require reading current state before retrying; do not automatically reuse a stale token.

For pack removal, call `review-remove` with `packId`. Explain that the listing will be removed and recipes kept unless explicitly selected. Apply `remove` with `packId`, `expectedStateDigest` and `deleteRecipeIds` containing only authorized present members. Other-pack members and file-catalog IDs cannot be deleted here. Missing recipes are already absent. Verify both pack absence and remaining recipes. Saved runs, project edits and immutable creative-pack export snapshots remain intact. Creative-pack and runtime-extension lifecycle are separate; do not use this operation to remove them.

## Maintain an installed recipe

When asked to revise an installed recipe, use `viral_hit_recipe_library` with `inspect` and the incoming `manifest`. If it returns `update`, show both full definitions, their versions and affected packs; offer the retained current JSON as a backup. For authorized replacement call `update` with that same manifest, incoming `expectedDigest` and `expectedInstalledDigest: inspection.update.digest`. File-catalog definitions remain protected; use a new ID for a fork. Read `get` afterward to verify the current version and digest.

For removal call `review-remove` with `recipeId`, explain that saved runs/project edits remain and affected packs can become incomplete, then use `remove` with the reviewed digest when removal is authorized. A stale review needs another read. Recipe-pack `list` exposes each installed pack's `content` state; reimporting the original pack restores missing recipes only after review and refuses any changed member. Creative-pack exports retain their original snapshots. Do not describe a missing or modified pack as fully installed.

For a later run, read `viral_hit_recipes_list` and pass `recipeDigests[recipeId]` as `expectedRecipeDigest` in the check/run request when using that reviewed definition. A changed recipe requires reloading and reviewing inputs. Deleting a recipe does not cancel already queued work.

## Boundaries

- Recipe packs change the recipe library; creative packs can also add skills and characters. Running a recipe is a separate request; queueing, paid generation and publishing need their own authorization.
- Do not retry an install that failed with a conflict. Explain the conflict and use a fresh lifecycle review for same-ID recipe-pack updates, or a new ID for an independent fork.
- The same operations exist in the Recipe library UI (**Runs → Recipe library**) and the CLI (`recipe packs`, `inspect-pack`, `install-pack`, `build-pack`, `review-update-pack`, `review-remove-pack`, `pack-request`), so the user can finish any step themselves.

