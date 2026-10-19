# Retained media for publishing

`openProjectPublicationMedia()` is the shared server application boundary for publication media. `pin(projectId, assetId, signal)` accepts project-owned IDs, resolves the active project/local asset, verifies its recorded MIME type, size and SHA-256, and retains a separate copy. It returns only `{assetId, sha256, sizeBytes, contentType}`. Account credentials, host paths and temporary filenames do not belong in that public identity. HTTP/MCP/UI admission must use this boundary rather than accepting caller-invented file paths or hashes.

The returned `validateAssets` and `read` methods implement the media half of `PublicationRuntime`. A worker checks active project status and retained identity/availability before session creation, then verifies each requested byte range before transmission. The generic implementation supports image, audio and video; destination connectors enforce their own media constraints. This boundary is integrated with the actual project database and tested with the YouTube executor, but publication approval/delivery UI and the scheduling loop are not yet connected. Browser account connection management is implemented separately.

## Persistence and integrity

Private data lives under `VIRAL_HIT_DATA_DIR/publication-media` (or the default studio `data/publication-media`). SQLite stores the manifest and indexed SHA-256 hashes for fixed 8 MiB blocks. Retained files are addressed by project/asset/full hash. Newly created index files use mode 0600, retained media 0400 and directories 0700. Symlink/nonregular paths are rejected; source files open without following final symlinks and with nonblocking mode before file-type validation.

Preparation uses one reusable block buffer, computes the full hash while copying, syncs the completed file and directory entries, then commits manifest/block rows in one transaction. Filesystem work runs outside SQLite transactions. Atomic hard-link placement refuses to overwrite an existing retained file; repeated/concurrent preparation verifies that existing file. An interruption after file placement but before the manifest commit can leave an unreferenced complete file, which a later preparation verifies and recovers. Normal failures/cancellation clean their temporary files. A process crash may leave an unreferenced temporary file.

Reads allow at most 8 MiB, even when a provider resumes at an unaligned byte offset. Each read queries only the one or two touched block hashes, verifies each full touched block and copies the requested slice into the result. Live read buffers are at most one 8 MiB verification buffer plus one 8 MiB result; process RSS also includes V8, garbage collection, SQLite and callers. The full hash is verified at preparation, not recomputed during every upload step. Missing/corrupt blocks stop byte transfer. A corruption found after session creation preserves the original session for recovery; it does not create a replacement upload.

Approved retained media survives source edits/deletion. Removing source media therefore does not cancel an approved publication. Explicit publication stop controls subsequent local delivery; it does not undo remote effects. The implementation assumes the private database and its owner are trusted. It is not an isolation boundary against an administrator who can change both manifests and files.

## Storage and measured limits

The contract allows up to 256 GiB per asset, with at most 32,768 block hashes. That is a validation bound, not proof that every project/import/export path accepts files of that size. Current project import limits still apply. The largest synthetic retained-storage case measured so far is 1 GiB plus 137 bytes; codec/media validity and real provider acceptance are separate checks.

Retention uses an additional local copy per project/asset/hash plus a temporary copy during preparation. Multiple publication intents can reuse one retained identity. Cross-project deduplication, disk quotas, garbage collection and deletion policy are not implemented. Cleanup must account for active/uncertain publication recovery rather than remove the only retained media for a live session.

Reproduce the opt-in local byte-pipeline measurement from `apps/studio`:

```sh
node --expose-gc --import tsx scripts/verify-publication-media.ts /absolute/evidence-directory 256
```

The last argument accepts 16–1024 MiB. The script streams a synthetic fixture into a temporary directory, retains it, removes the source, reads and hashes all retained bytes, checks an unaligned 8 MiB range, writes a JSON report and removes temporary media. It does not access an account or make network requests. See [performance](PERFORMANCE.md) for recorded observations and [publishing status](PUBLISHING.md) for integration gaps.
