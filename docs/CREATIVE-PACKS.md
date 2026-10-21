# Creative packs

A creative pack moves a way of working between Viral Hit installations: recipes, agent skills and characters with their original reference images. It can be a general toolkit, a particular team's host and editing workflow, or a specialized format. Any non-empty combination works, including a skills-only pack. It is a `.viralhit-pack.tar` file, distinct from the existing recipe-only JSON packs.

## Make and use a pack

Open **Packs → Make a creative pack**. Name it, choose General or For a specific job, and select items already in your libraries. Download the file. Building installs nothing and leaves the selected library items unchanged. Recipes gain the pack ID as a prefix so they can coexist with their originals; skills and characters keep their IDs. Skill instructions and character profiles/images remain unchanged.

Choose **Import creative pack** on the receiving installation, or paste a public HTTPS/GitHub file link into **Add from link → Review link**. The browser downloads a bounded file and sends those retained bytes through the same inspection flow. It does not fetch the URL again when installing. The review shows recipes and setup needs, expandable full skill instructions, and character images, identity rules, voice notes and provider identities. Confirm the reviewed contents, then install. Exact matches are reused. Conflicting IDs block installation before any library changes; share another version under a new ID rather than overwriting local work. Installed skills can be independently updated or removed in [Skills](SKILLS.md); this does not rewrite saved pack snapshots. Installed packs appear on this page and their recipes appear in Runs. Skills are discoverable immediately by already connected agents; characters appear in the character library.

A selected character includes all its references and profile fields, and a selected skill includes its complete instructions. The pack does not inspect or strip private information from those user-selected contents. Account credentials, executable provider/adapter/connector modules, settings and jobs are not part of this format. A pack can name external setup requirements, but does not install those runtimes or fetch dependencies. Installing never executes a skill, starts generation or publishes anything.

**Download pack** exports the original installed snapshot. If someone later edits a local character, the exported pack still contains the original rules and images. Installation of the original over that changed character is a conflict; export does not silently capture those edits.

## Agent and command-line use

`viral_hit_creative_pack` exposes one `request` object. All paths are absolute paths on the MCP host. The bundled `recipe-packs` skill explains when to use a recipe-only pack and when to use a creative pack.

| Action | Inputs | Result |
|---|---|---|
| `list` | None | Existing recipes, skills and characters to select, plus installed creative pack summaries |
| `fetch` | Public HTTPS `url`, new `path`, optional `expectedSha256` | Retained file path, size and source (query omitted); `inspected: false`, inspect next |
| `build` | `pack`, new `path` | File path, bytes and summary/digest; no installation |
| `inspect` | `path` | Verified contents, image positions for file previews, digest and all current conflicts |
| `install` | Same `path`, `expectedDigest` | `complete`, successful `items` and optional error |
| `export` | Installed pack `id`, new `path` | Original snapshot as a new file |

From `apps/studio`:

```sh
pnpm creative-pack list
pnpm creative-pack fetch https://host.example/my-kit.viralhit-pack.tar /absolute/my-kit.viralhit-pack.tar
pnpm creative-pack inspect /absolute/my-kit.viralhit-pack.tar
pnpm creative-pack change < /absolute/request.json
```

Example build request for a general toolkit, using shipped library entries:

```json
{
  "action": "build",
  "path": "/absolute/general-toolkit.viralhit-pack.tar",
  "pack": {
    "id": "general-toolkit",
    "version": "1.0.0",
    "title": "General creative toolkit",
    "description": "Open image workflows and guidance for consistent characters.",
    "author": "Your name",
    "license": "Apache-2.0",
    "scope": "general",
    "useCases": ["creative-work"],
    "recipeIds": ["open-frame"],
    "skillIds": ["consistent-characters", "recipe-packs"],
    "characterIds": []
  }
}
```

For a specialized kit choose `scope: specialized`, describe its job and select actual character/skill IDs from `list`. The character library and skill library create/import those entries first. Do not assume a named example skill is installed.

The browser uses `GET /api/app/creative-packs` for selection/catalog, `POST` there with a build/export/fetch JSON request for a streaming download, and `POST /api/app/creative-packs/file?action=inspect|install` for a raw tar upload. Installation also supplies `digest` in the query. Browser routes reject server paths and require the workspace mutation header. HTTP, MCP and CLI all call `core/creative-packs/service.server.ts`.

## File contract and resources

The [manifest schema](schemas/creative-pack.schema.json) describes `manifest.json`: kind `viral-hit-creative-pack`, schema version 1, identity/scope, recipes, portable skill files and portable character manifests. `media/<sha256>` stores each unique reference image once, even if several characters share it. No nested archives or executable code are loaded. The same strict tar scanner/writer used by project/character files rejects links, traversal, duplicate/extra/missing members and invalid padding/trailing bytes.

Limits: 24 recipes, 12 skills, 12 characters, at most 20 references per character, 20 MB per reference image, 5 MB of definitions and 512 MB for the whole file. Archive copy/checksum operations use a 1 MiB buffer. Each distinct image is probed once during review or install; installation processes character image sources sequentially. Browsers preview slices of their selected file rather than downloading a second image copy from the server. Link downloads use HTTPS, public DNS pinned to the socket, redirect revalidation, no forwarded cookies/authorization, a 512 MB bound and a five-minute request deadline. The server streams temporary files and deletes them on response completion/cancel. The browser keeps a Blob/File for review and installation, releases it and image object URLs on close/unmount/success, and offers cancellation during download/inspection. There is no persistent remote cache; page reload requires fetching and reviewing again. Large links still consume browser storage and transfer time, up to the file limit. MCP/CLI fetch uses an atomic no-overwrite target and removes partial files; a successful fetch is data only and must be inspected before installation. Temporary uploaded/extracted files are deleted after the operation; the installed completion record keeps definitions and references existing content-addressed image storage. There is no background polling, additional daemon or runtime dependency for packs.

## Interruption and remaining boundaries

Every definition, reference hash and image's actual type/dimensions is verified before installation. The digest covers the normalized manifest, including all reference hashes. Changes between review and installation are refused. Each library retains its own atomic writes; the entire multi-library installation is **not one transaction**. A disk error, cancellation or concurrent conflict can leave some items installed. The response explicitly returns `complete: false`, the successful `items` and an error; the CLI exits nonzero. Resolve the cause, inspect and retry the same file. Exact contents are reused. The completion record is published only after every library operation succeeds. A process crash before that record is also recoverable by reimporting the same file.

Creative packs transfer through files or public HTTPS/GitHub links. Authenticated downloads, managed version updates/uninstall and a hosted community catalog are not implemented. Publish the built tar as a downloadable asset in your own repository or hosting; ordinary HTML repository pages without a downloadable file and Git LFS pointer files are not pack archives. Packs do not bundle a project timeline; use an editable project file for that. Recipe-only JSON packs and their existing HTTPS/GitHub link flow remain available.

[Community catalogs](COMMUNITY.md) discover creative packs from independent sources. Catalog entry hashes are checked against the raw downloaded archive before it reaches review. CLI `fetch` accepts the hash as its final optional argument. Inspection and installation then use the retained archive and its reviewed content digest.
