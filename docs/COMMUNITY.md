# Independent community catalogs

A creator or team can host a small JSON catalog in their own public repository or HTTPS site. It lists **general** tools and workflows for a **specific job** together, without a central registry or changes to Viral Hit. Supported entries are portable skill JSON, recipe-pack JSON and creative-pack tar files. Executable modules use the separate operator installation boundaries.

## Browse and use

Open **Community catalogs** from Skills, Packs or Extensions. Add a public HTTPS/GitHub catalog link or import a JSON file. Review its author, source, entries and changes, then save. Saved catalogs are searchable by title, ID, author and tags; scope and type filters work locally, with 24 cards per page. Saving or browsing downloads no entry files and starts no jobs. Each card displays its catalog ID and entry ID so repeated titles remain distinguishable.

Choose an entry to open its library with a prefilled link and checksum. **Review link** downloads it and checks the exact raw bytes against the catalog's SHA-256 before normal library inspection. The actual artifact review determines compatibility, identity and install conflicts. Descriptions and version labels in a catalog are author-provided metadata, not verified behavior. Installation retains its normal explicit action and reviewed-content digest; it does not refetch the source.

**Manage catalogs → Review latest** checks only that source. Review added, changed and removed entry IDs, as well as changed title/description/author/homepage/source fields. Save compares both the reviewed incoming digest and the previously saved digest; a concurrent edit requires review again. Download exports portable catalog JSON. Remove deletes only discovery metadata; installed items stay in their libraries. Catalogs imported from a file have no refresh source; import a newer file to review an update.

## Publish your own

Start with [the empty author template](../examples/community/catalog.json) and [JSON Schema](schemas/community-catalog.schema.json). This template intentionally has no download entries or asserted hosted release. Give your catalog a unique lowercase ID, title, description and author, and optionally a homepage. Add up to 200 entries, each with:

| Field | Meaning |
|---|---|
| `id` | Stable unique entry ID within this catalog |
| `kind` | `skill`, `recipe-pack` or `creative-pack` |
| `title`, `summary` | What the artifact actually does and needs |
| `scope` | `general` or `specialized` |
| `version` | Author's artifact version label |
| `tags` | Up to eight searchable tags |
| `url` | Stable public HTTPS file URL; GitHub file pages are normalized to raw files |
| `sha256` | Lowercase SHA-256 of the exact downloadable file bytes |

Export your artifact from its library first. Hash the **final file**, including its actual whitespace/archive bytes; changing or reformatting the hosted file changes its hash. From `apps/studio`:

```sh
pnpm community hash /absolute/exported-file.json
pnpm community inspect /absolute/catalog.json
pnpm community schema /absolute/new-schema.json
```

Put the resulting hash and file URL in the catalog. Publish the artifact and catalog on your own host, then share the catalog link. A commit-pinned file URL makes revision intent clearer. The checksum detects a changed file relative to the catalog; it does not authenticate the author's identity. No platform account is required by the format. Private authenticated downloads, signatures, a hosted marketplace and automatic update polling are not implemented.

## Agent, API and CLI

The bundled `recipe-packs` skill describes discovery and installation. MCP **`viral_hit_community`**, HTTP **`/api/app/community`** and `pnpm community` call the same application service. GET/list reads saved snapshots without network calls. HTTP POST requires the trusted workspace request header.

| Action | Inputs / result |
|---|---|
| `list`, `get` | Saved catalogs, or one catalog by `id` |
| `inspect` | `catalog`, optional `source`; returns review and changes without saving |
| `fetch` | `url`; downloads bounded catalog JSON and returns review |
| `save` | Exact reviewed `catalog`, optional `source`, `expectedDigest`, `expectedPreviousDigest` (null for a new catalog) |
| `remove` | `id`, `expectedDigest`; removes discovery only |

CLI: `list`, `fetch <url>`, `inspect <file>`, `hash <file>`, `change <request.json>`, `export <id> <new-file>` and `schema <new-file>`. Export/schema never overwrite an existing file. CLI `change` takes the same request object as HTTP (MCP wraps it in `request`). Fetching or inspecting does not save.

Pass an entry's `sha256` as `expectedSha256` to `viral_hit_skill_library`, `viral_hit_recipe_pack` or `viral_hit_creative_pack` **fetch**. CLI equivalents accept a final optional SHA-256 argument:

```sh
pnpm skill fetch https://example.org/skill.json /absolute/new-skill.json SHA256
pnpm recipe fetch-pack https://example.org/recipes.json /absolute/new-recipes.json SHA256
pnpm creative-pack fetch https://example.org/kit.tar /absolute/new-kit.tar SHA256
```

These are command templates; substitute your real file URLs and 64-character hashes. A failed checksum removes temporary bytes and never publishes the destination file. Creative-pack fetch still reports `inspected: false`; inspect that retained file next. For skills and recipes, fetch returns the normal full inspection.

## Resource and storage bounds

`community-catalogs.sqlite` stores reviewed metadata in the configured data directory: 20 catalogs, 200 entries per catalog, 512,000 bytes per downloaded/imported catalog and 8 MiB aggregate stored documents. Fetch has a 20-second deadline; public DNS pinning, private-address rejection, redirect revalidation and streaming limits use the shared downloader. Catalog URLs contain no credentials, query strings, fragments or custom ports. No cookies or authorization are forwarded.

No new dependency, daemon, thumbnail prefetch, entry prefetch or background poller is required. Saved catalogs remain browsable without contacting their authors. Artifact downloads retain their existing library limits, so selecting a large creative pack can still consume up to its 512 MB transfer limit. See [the architecture boundary](architecture/COMMUNITY-CATALOGS.md).
