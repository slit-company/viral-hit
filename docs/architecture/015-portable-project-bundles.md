# Portable project bundles

The project domain owns a versioned, inspectable project file containing Canvas, timeline and project-owned media. HTTP, MCP and CLI share one application service; transport code does not recreate asset mapping or project mutations.

Use an uncompressed POSIX ustar archive (`.viralhit.tar`): `manifest.json` followed by content-addressed media members. Existing video/image/audio formats are already compressed. Bounded streaming copies avoid loading a complete archive into browser or server memory and avoid a new default compression dependency. A strict subset (regular files, fixed names, no links, extensions, directories or duplicate members) is documented and tested with an independent tar reader.

Export captures saved state and verifies each original's bytes before serving a retained download. Concurrent saved-state or media-membership changes fail preparation. Import stages and verifies the archive, hashes and media before exposing a review. Acceptance remaps project/asset URLs and IDs, resets executable generation state, invalidates derived render receipts, then registers the new project, media memberships, Canvas and timeline in one SQLite transaction. Existing projects are never overwritten. Stable import identity recovers a lost acknowledgement without creating another project.

Provider connections, private credentials, publication approvals and live job leases are installation state and are not portable execution authority. Imported files start no provider or publishing operations. Editable content, prompts, graph references and take choices are retained. Unsupported remote/transient/missing media fails export with an actionable error rather than silently producing an incomplete file.

Limits, retained staging files and recovery behavior are explicit. Source tests cover malformed archives, integrity, membership, concurrent state and crash/replay boundaries; browser tests perform download → inspect → import → edit/export on actual media. Visual review uses real desktop/mobile captures after functional checks.
