# Recipe packs

Use this skill when someone wants a ready-made workflow, wants Viral Hit set up for a particular job (vertical reels, slide stories, a team's campaign format), or wants to share workflows they made. Packs group recipes and are labeled `general` (fits any project) or `specialized` (one format, job or audience). Recipe-only packs add recipes to the local library. If the request also includes agent skills or characters/reference images, follow **Share a complete creative setup** below with `viral_hit_creative_pack`. It never queues runs, generates media or publishes.

## Find a pack

1. Call `viral_hit_recipe_pack` with `{ "request": { "action": "list" } }`. `available` lists packs offered by this installation with `state` `available`, `installed` or `other-version`; `installed` lists what is already in the library.
2. Match the request to `summary.scope`, `summary.useCases`, `summary.title` and `summary.description`. Prefer a `specialized` pack when the user names a specific format or job, and a `general` pack when they want building blocks for any project. If two fit, say how they differ in one sentence each.
3. If the user gave a pack link, call `{ "action": "fetch", "url": "..." }` instead. Only HTTPS links on the public internet work; a GitHub file page is converted to its raw file. Report the returned error as is if the link is not a pack.
4. If nothing fits, say so and offer to build a pack from recipes the user already has (see below). Do not invent pack names.

## Review before installing

1. For an offered pack, call `{ "action": "inspect", "pack": <available[i].manifest> }`. A fetched link already returns `inspection`.
2. Show the user: title, version, scope, each recipe title with its input count, `requirements` (setup outside the studio), `unavailableOperations` (steps this installation cannot run yet) and every `blocking` reason.
3. Do not install when `blocking` is non-empty. A different version of an installed pack cannot replace it; the publisher must use a new pack ID.
4. Install when the user asks for it or the request clearly includes installing: `{ "action": "install", "pack": <the exact reviewed manifest>, "expectedDigest": <inspection.pack.digest> }`. Never edit the manifest between review and install; a changed manifest is rejected.
5. Confirm with `viral_hit_recipes_list` that every `recipeIds` entry is present. Tell the user the recipes appear in **Runs** grouped under the pack name. If `requirements` or `unavailableOperations` were present, repeat what still needs to be installed before those recipes can run.

## Build and share a pack

1. Call `viral_hit_recipes_list` and agree with the user on which recipes belong together (up to 24). If a recipe the user names is not installed but appears in an offered pack's `recipeIds` from the `list` result, review and install that pack first as described above, then build.
2. Choose the scope with the user: `general` if it helps any project, `specialized` if it encodes a particular format, brand, audience or job. Ask for a title, a short description of what it is for and what people must bring, author and license. Use short lowercase use cases such as `product-ad`.
3. Call `{ "action": "build", "pack": { "id", "title", "description", "author", "license", "scope", "useCases", "recipeIds" } }`. The pack ID is lowercase letters, numbers and hyphens, at most 40 characters; recipe IDs gain it as a prefix. Contents, authors and licenses of each recipe stay unchanged.
4. Give the user the returned `manifest` as a JSON file if you can write files, otherwise show where to save it. Explain that others install it with **Import pack file**, **Add from link** (for example a GitHub file in a public repository) or the `fetch` action. Building installs nothing.
5. Keep private rules, account details, credentials and brand assets out of descriptions and recipe defaults before the user shares a pack.

## Share a complete creative setup

Use this path when a pack needs skills or characters as well as recipes, or when the user gives a `.viralhit-pack.tar` file. Any subset is valid: a general skills-only kit and a specialized host + recipes + skills kit use the same format. Keep each original skill instruction and character rule unchanged.

1. Call `viral_hit_creative_pack` with `{ "request": { "action": "list" } }`. Select only actual recipe, skill and character IDs from its catalog. Missing items must be created or installed through their own libraries first; never invent them. In particular, installing a recipe pack alone does not install a named skill or character.
2. For creation, use the title, description, author, license, scope, use cases and chosen contents the user supplied. Ask only for material missing choices. Call `{ "request": { "action": "build", "path": "/absolute/new-file.viralhit-pack.tar", "pack": { "id", "version": "1.0.0", "title", "description", "author", "license", "scope", "useCases", "recipeIds": [], "skillIds": [], "characterIds": [] } } }`. Building writes a new file and never overwrites an existing one. Recipe IDs gain the pack prefix; skill and character IDs are preserved. All character reference images, rules, voice notes and provider identities travel with it, so explain that sharing includes those selected contents.
3. For a received file, call `{ "request": { "action": "inspect", "path": "/absolute/file.viralhit-pack.tar" } }`. Summarize scope, counts, setup needs, full skill purposes/instructions, character identity rules and every conflict from `blocking`. The UI's **Packs → Import creative pack** also displays the actual reference images for review. Do not claim to have visually inspected images based only on the MCP metadata.
4. If installation is authorized and there are no blockers, call `{ "request": { "action": "install", "path": "/absolute/file.viralhit-pack.tar", "expectedDigest": "<inspection.pack.digest>" } }`. Check `complete`, not just HTTP/tool success. On `complete: false`, report which `items` succeeded and `error`; after resolving that cause, inspect and retry the same file. Matching contents are reused, so retry does not duplicate characters or skills. Conflicting IDs are never overwritten; ask the author for a new ID or use the existing content.
5. Call `list` to verify the installed pack and every selected library entry. An installed pack exports its original snapshot with `{ "request": { "action": "export", "id": "<pack-id>", "path": "/absolute/new-copy.viralhit-pack.tar" } }`, even if a local character has been edited since installation. Return the actual file path and say whether it was merely built or actually installed.
6. No skills execute, jobs queue, models generate or posts publish during these steps. Creative pack uploads currently use files, not HTTPS fetch; use the recipe-only `fetch` flow only for `.json` recipe packs.

## Boundaries

- Recipe packs change the recipe library; creative packs can also add skills and characters. Running a recipe is a separate request; queueing, paid generation and publishing need their own authorization.
- Do not retry an install that failed with a conflict. Explain the conflict and the options (use the installed version, or ask the publisher for a new pack ID).
- The same operations exist in the Recipe library UI (**Runs → Recipe library**) and the CLI (`recipe packs`, `inspect-pack`, `install-pack`, `build-pack`), so the user can finish any step themselves.

