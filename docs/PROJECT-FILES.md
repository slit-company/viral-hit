# Project files

A project file (`.viralhit.tar`) moves a whole editable project to another Viral Hit installation: original media, Canvas cards and layout, timelines, takes, captions and overlay keyframes. Open **Project file** in a project header to prepare and download it. On the Projects page or inside any project, choose a file under **Import a project**, review its verified contents, then create a new project.

Import always creates a new project and never overwrites existing work. Retrying the same reviewed file returns the project it already created. Provider connections, credentials, publishing approvals and running jobs belong to an installation and are left out. Imported generation cards start idle; rendered timeline exports are recreated on demand.

The same operations are available to agents and scripts:

| Surface | Export | Inspect | Import |
|---|---|---|---|
| UI | Project file → Prepare → Download | Import a project → choose file | Create new project |
| MCP | `viral_hit_project_file_export` | `viral_hit_project_file_inspect` | `viral_hit_project_file_accept` |
| CLI | `pnpm project:file export PROJECT_ID out.viralhit.tar` | `pnpm project:file inspect FILE` | `pnpm project:file accept REVIEW_ID SHA256` |

## Format

The file is a plain POSIX tar readable with `tar -tf`. It contains `manifest.json` followed by media named `media/<sha256>`. The manifest records schema-validated Canvas and timeline documents whose media references use `viralhit:asset:<id>` and a list of assets with kind, MIME type, size, SHA-256 and probed dimensions/duration. Other tools can generate or read this format; the strict subset is regular files only, exact member names, no links, directories, extensions or duplicates.

## Limits

Files are limited to 2 GiB, 500 assets and 512 MiB per asset, with a 5 MiB manifest. Export requires local project media; run `pnpm media:localize` first if a project still references remote storage. Export fails when media is missing, altered or changed while the file is being prepared, so an incomplete file is never offered. Prepared and staged files are kept under the data directory's `project-bundles/` folder until removed by the operator.
