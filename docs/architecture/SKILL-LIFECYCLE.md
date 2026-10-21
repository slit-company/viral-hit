# Managed skill lifecycle

## Boundary and contract

`core/skills/library.server.ts` is the shared HTTP/MCP/CLI operation boundary. `file.server.ts` owns normalized portable files and digests. `storage.server.ts` owns durable installed definitions; registry loading and compatibility remain separate. No core dependency on creative-pack orchestration is added.

`inspect` preserves the current installed package and its digest when an incoming file differs. `update` requires the incoming digest and installed digest. `review-remove` returns the current file/digest; `remove` requires that digest. All actions parse the same strict schema. Official/operator entries cannot be replaced or removed through this service. Skill contents never execute here. A version string does not authorize an update or establish ordering: an explicitly reviewed rollback or correction is valid.

## Persistence and recovery

Managed definitions are whole JSON packages in `skill-library.sqlite`, using built-in Node SQLite with no new dependency or resident process. Compare-and-replace runs under `BEGIN IMMEDIATE`; failures roll back, and concurrent processes cannot both replace the same revision with different contents. Successful identical retries are no-ops. Removal retains only the removed digest and ID as a tombstone so replay is identifiable. A later different install defeats a stale removal. Limits are 500 managed IDs (including tombstones), 32 MiB of active documents, and the existing 700 KB/64 KiB/512 KiB package/manifest/instruction bounds. Removing text makes space within the active-document budget; SQLite can reuse freed pages. Tombstone compaction and version history are not implemented.

Legacy `installed-skills/<id>/skill.json` and `SKILL.md` remain untouched. Reads prefer a managed override or tombstone for that ID; other folders retain existing loading/error behavior. A first mutation reads and validates the legacy files inside the local write transaction, compares the reviewed normalized digest and writes one managed row. Files are bounded and symlinks rejected. No network request occurs in the transaction. Readers receive a complete definition snapshot; an already-started read may finish with its earlier snapshot. Application upgrades must restart app/MCP/worker processes together; old binaries do not understand the new store.

Official and operator-folder precedence remains unchanged. Their edits can shadow an installed ID, but the managed service never changes their files. New installs use the database. Portable import/export remains the interoperability format, and data-root backups retain the database plus legacy folders.

## Product effects and evidence

UI shows both definitions before replacement, offers downloading the retained installed package and requires confirmation. Removal similarly reviews exact retained bytes and can export those bytes even if another client changes the live skill. Stale writes return a conflict and require a new review. Changes appear on subsequent registry/resource reads; they cannot revoke instructions already in an agent conversation.

Saved creative packs are immutable snapshots. Updating or removing a live skill neither rewrites those snapshots nor changes projects, generated media or previous jobs. Exported packs retain their original bytes; reimport can restore missing skills, while conflicting live definitions still block combined-pack installation. Pack-wide updates/uninstall and executable-extension lifecycle remain separate operations.

Verification covers full-definition/scope transfer, incompatible and stale revisions, identical replay, removal followed by reinstall, exact pack export, legacy overlay preservation, independent CLI writer contention, and actual browser/HTTP/MCP review and removal. These checks establish lifecycle behavior, not generated-media quality.
