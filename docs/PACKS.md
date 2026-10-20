# Recipe packs

A pack bundles recipes that belong together. Some packs are **general** and fit any project. Others are built **for a specific job**, such as vertical reels, slide stories or one team's campaign format. Both kinds install the same way, and neither changes the core app.

## Bundled packs

| Pack | Scope | Recipes | Use it for |
|---|---|---|---|
| [Editing basics](../packs/editing-basics.json) | General | Title card, music bed, voice-over, picture-in-picture | Any project |
| [Short-form reel kit](../packs/short-form-reel.json) | Specific job | Hook cut with call to action, product punch-in, reference study | Reels, shorts, product ads, remakes of a reference |
| [Slide story kit](../packs/slide-story.json) | Specific job | Three-card story, five cards with music | Card news, carousels turned into video, explainers |
| [Local media engines](../extensions/local-media/pack.json) | General | Music score, motion timeline, animated image, narrated scene | Rendering music and motion on your machine; needs the local-media extension |
| [ima2 image generation](../extensions/ima2/pack.json) | Specific job | Prompt to image, reimagine a project image | Image generation through your own ima2 server and provider account |

Optional extensions ship a `pack.json` next to their code. The pack gallery offers them with a **Needs setup** note that says what to install, and the review warns about any step this installation cannot run yet. You can install the recipes first and add the extension later.

Every recipe in the first three packs prepares separate, editable tracks after your current timeline. They use your own footage, images, music and narration and do not generate or publish anything. The reel hook cut renders a vertical 8-second MP4 when the source is vertical.

## Install a pack

In a project, open **Runs → Recipe library**. Choose **Review pack** on a bundled pack, **Import pack file** for a file someone sent you, or paste a link under **Add from link**. Links must be HTTPS on the public internet; a GitHub file page link is converted to its raw file automatically, so a pack kept in any public repository can be shared by URL. Downloads use the same address checks as media imports and are limited to 1 MB. The review lists each recipe, its inputs, conflicts with recipes you already have, and any runtime step this installation is missing. **Install pack** adds all of its recipes at once, and they appear in the Runs recipe picker grouped under the pack name. Installing never queues work.

Agents and scripts use the same service:

```sh
pnpm --dir apps/studio recipe packs                                   # bundled and installed packs
pnpm --dir apps/studio recipe inspect-pack ../../packs/slide-story.json
pnpm --dir apps/studio recipe install-pack ../../packs/slide-story.json DIGEST_FROM_INSPECT
```

Agents connected over MCP can read the bundled [recipe-packs skill](../apps/studio/skills/official/recipe-packs/SKILL.md) (`viral_hit_skill_get` or `viral-hit://skills/recipe-packs`). It walks them through matching a request to a general or job-specific pack, showing the review, installing with the reviewed digest and building a pack to share. MCP exposes `viral_hit_recipe_pack` with `{ "request": { "action": "list" } }`, `fetch` (a pack link), `inspect`, `install` and `build`. HTTP uses `GET/POST /api/app/recipe-packs` with the trusted workspace header.

## Make your own pack

The quickest way is **Recipe library → Make a pack**. Name the pack, choose General or For a specific job, add use cases and a description, and tick recipes from your library: built-in ones, your forks, imported ComfyUI graphs or recipes from other packs. **Build pack file** checks the result and **Download pack file** saves it. Recipe IDs gain your pack ID as a prefix; contents, authors and licenses stay as they were. Scripts can do the same:

```sh
# definition.json: { "id", "title", "description", "author", "license", "scope", "useCases", "recipeIds" }
pnpm --dir apps/studio recipe build-pack definition.json my-pack.json
```

MCP accepts the same definition as `{ "request": { "action": "build", "pack": { ... } } }`. Building never installs or runs anything.

You can also write the file by hand. A pack is one JSON file of up to 1 MB:

```json
{
  "schemaVersion": 1,
  "kind": "viral-hit-pack",
  "id": "my-campaign",
  "version": "1.0.0",
  "title": "My campaign kit",
  "description": "What it is for and what users need to bring.",
  "author": "Your name",
  "license": "Apache-2.0",
  "scope": "specialized",
  "useCases": ["product-ad"],
  "homepage": "https://example.com/docs",
  "recipes": [{ "id": "my-campaign-teaser", "...": "a complete recipe manifest" }]
}
```

- `scope` is `general` or `specialized`. `useCases` are short lowercase identifiers shown on the pack card.
- Each recipe is a complete [recipe manifest](EXTENDING.md) and its ID must start with the pack ID and a hyphen. This keeps packs from claiming each other's recipes or the built-in catalog.
- Up to 24 recipes per pack. Recipes may use any installed operation, including [external adapters](EXTERNAL-ADAPTERS.md) and [ComfyUI graphs](LOCAL-COMFYUI.md); the review warns when an installation lacks one.
- `requirements` is an optional plain-language note (up to 600 characters) about setup beyond the studio, such as an adapter, a server or an environment variable. It appears on the pack card and in the review.
- Put pack files in `packs/`, or ship one as `extensions/<name>/pack.json` beside an extension, to offer them in every project of an installation. Setting `VIRAL_HIT_PACKS_DIR` replaces both with your own folder. Offered packs are reviewed before install and never installed automatically.

Installation is all or nothing. If any recipe conflicts with a different recipe already installed, nothing from the pack is added. An installed pack is immutable: reinstalling the same file is a no-op, and a changed file under the same ID is rejected. Publish updates under a new pack ID (for example `my-campaign-v2`) so projects that used the earlier recipes stay reproducible.

Keep private rules, account details and brand assets out of shared packs. A pack built for one team can live in that team's own repository and still install into any Viral Hit installation.

