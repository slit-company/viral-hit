# Contributing to Viral Hit

Viral Hit is a general creative workspace. Work that only makes sense for one format, brand, audience or service still belongs here, but in a layer that can be added or removed without changing the app for everyone else. Before you start, decide where your contribution lives.

## Where does it go?

| You want to add | Put it in | Guide |
|---|---|---|
| Something every project benefits from: editing, export, the job harness, safety, accessibility | The core app in `apps/studio`, through a pull request | [Structure rules](docs/architecture/STRUCTURE.md) |
| A workflow for one job, such as vertical product ads, a weekly show format or a team's campaign style | A recipe, or several recipes in a pack labeled `specialized` | [Packs](docs/PACKS.md), [recipes](docs/EXTENDING.md) |
| Reusable building blocks that fit any project | A pack labeled `general` | [Packs](docs/PACKS.md) |
| A new engine, model server or render farm | An external adapter, optionally shipped as an extension with its own `pack.json` | [External adapters](docs/EXTERNAL-ADAPTERS.md) |
| An image or video model with its own API, general or for one job, including models that edit a painted area (`maskInput`) | A provider folder (provider.json plus one module) in your own repository, installed with `VIRAL_HIT_PROVIDERS_DIR` | [Providers](apps/studio/docs/PROVIDERS.md#install-a-provider-without-changing-the-app) |
| A new publishing destination | An installed publishing connector, using the shared review and delivery worker | [Publishing connector guide](docs/PUBLISHING.md#install-a-publishing-connector) |
| Know-how an AI agent should follow, for any project or one job | A skill folder in your own repository, shared as a portable file or loaded with `VIRAL_HIT_SKILLS_DIR`; propose it as official with an evaluation | [Skills](docs/SKILLS.md), [official skill rules](apps/studio/skills/official/README.md) |

A quick test: if your change names a brand, a platform's format, an audience or a campaign, it does not belong in the core. Core contracts (projects, assets, Canvas, timeline, runs) stay free of those fields; specialized parameters live in recipes, packs or optional metadata.

After installing a contribution, inspect **Extensions** or call `viral_hit_extension_status` / `pnpm --dir apps/studio extensions` for declared configuration and load errors. [Diagnostics](docs/EXTENSION-STATUS.md) are read-only and do not prove execution or media quality; include a separate representative execution check with your contribution.

## Sharing a pack

You don't need this repository's permission to share a pack. Build it in **Runs → Recipe library → Make a pack** or with `recipe build-pack`, put the JSON in any public repository, and share the GitHub file link; others install it with **Add from link**. Editors can check files against [pack.schema.json](docs/schemas/pack.schema.json).

To propose a pack for `packs/` so every installation offers it, open a **Share a pack** issue or a pull request. Bundled packs must:

- Use the right scope: `general` only if it helps any project.
- Prefix every recipe ID with the pack ID, and keep each recipe's author and license.
- Contain no private rules, account details, credentials, personal data or brand assets.
- Run on this installation: either every recipe executes with real media in a test, or the pack says what is missing in `requirements`.
- Pass `pnpm --dir apps/studio recipe inspect-pack <file>` with no blocking items.

For a reusable setup that combines recipes, skills and character images, build a [creative pack](docs/CREATIVE-PACKS.md). Keep general building blocks reusable and put format, brand or audience choices in a specialized pack. Contributor additions use the same manifest and shared application services as shipped content.

## Checks

Run these from the repository root before opening a pull request:

```sh
pnpm architecture:check
pnpm typecheck
pnpm test
pnpm --dir apps/studio i18n:check
pnpm build
pnpm performance:check
pnpm --dir apps/studio test:e2e   # for UI, editor, publishing or pack changes
```

Editor changes need real imported media, a decoded export and a look at the actual UI on desktop and phone widths. Provider and publishing changes need timeout, restart and duplicate-request tests. A claim about model quality needs real generation evidence; fixtures and mocks don't count. Record what you verified, and what you didn't, in the pull request.

## Code you didn't write

Reuse public code only under a compatible license, keep its notices, and add it to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Research checkouts under `research/upstream/` are for reading and are never imported.

## Reporting problems

Use the issue forms. For bugs, include the steps, what you expected, what happened, and your OS, Node and FFmpeg versions. Don't paste API keys, tokens or private media.

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).
