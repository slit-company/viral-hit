# Project files

A project file (`.viralhit.tar`) moves a whole editable project to another Viral Hit installation: original media, Canvas cards and layout, timelines, takes, captions, overlay keyframes, and the latest storyboard plans with accepted results. Open **Project file** in a project header to prepare and download it. On the Projects page or inside any project, choose a file under **Import a project**, review its verified contents, then create a new project.

Import always creates a new project and never overwrites existing work. Retrying the same reviewed file returns the project it already created. Provider connections, credentials, publishing approvals and running jobs belong to an installation and are left out. Imported generation cards start idle; rendered timeline exports are recreated on demand.

The same operations are available to agents and scripts:

| Surface | Export | Inspect | Import |
|---|---|---|---|
| UI | Project file → Prepare → Download | Import a project → choose file | Create new project |
| MCP | `viral_hit_project_file_export` | `viral_hit_project_file_inspect` | `viral_hit_project_file_accept` |
| CLI | `pnpm project:file export PROJECT_ID out.viralhit.tar` | `pnpm project:file inspect FILE` | `pnpm project:file accept REVIEW_ID SHA256` |

## Format

The file is a plain POSIX tar readable with `tar -tf`. It contains `manifest.json` followed by media named `media/<sha256>`. Version 1 remains supported. Projects with storyboards export version 2, including latest plans, source revision numbers, accepted media notes/timestamps, and exact recipe definitions. The import review shows storyboard/accepted-shot counts and offers each required recipe as a downloadable JSON file for separate review in the recipe library. Importing the project does not install those recipes or execute them.

The manifest records schema-validated Canvas and timeline documents whose media references use `viralhit:asset:<id>` and a list of assets with kind, MIME type, size, SHA-256 and probed dimensions/duration. Other tools can generate or read this format; the strict subset is regular files only, exact member names, no links, directories, extensions or duplicates.

## Limits

Files are limited to 2 GiB, 500 assets and 512 MiB per asset, with a 5 MiB manifest. Export requires local project media; run `pnpm media:localize` first if a project still references remote storage. Export fails when media is missing, altered or changed while the file is being prepared, so an incomplete file is never offered. Prepared and staged files are kept under the data directory's `project-bundles/` folder until removed by the operator.


## Storyboard transfer

Reference, soundtrack, accepted-result and declared recipe asset parameters map to the new project's media identities. Free-text directions and scalar values remain unchanged. A default asset parameter becomes an explicit mapped input. Imported boards start at revision 1, retain the supplied acceptance notes/timestamps, and recompute their fingerprints for the mapped plan. Source action IDs and prior revisions are not transferred. Acceptance records are the author's supplied review, not a new visual/model assessment by the receiving installation.

The exact pinned recipe definition must be available during export, either in the current library or retained by an earlier project import. Restore a missing version before exporting; missing definitions are not silently discarded. Included definitions stay inert and can be downloaded from the import review. New attempts require matching installed recipes and configured runtimes. Accepted media can be assembled and edited without the original model service. Recipe defaults and fixed node inputs remain part of the original definition; only declared asset parameters in the board's supplied values are mapped, so installation-specific hard-coded inputs must be reviewed before reuse.

The file retains latest plans, not board history, execution reservations or queued work. The 5 MiB manifest and existing board/recipe limits still apply. Staged storyboard rows become visible only after the new project activates; failed activation can be retried without overwriting subsequent edits. Retained files and unactivated metadata have no automatic cleanup yet.
