# Recipe lifecycle and execution identity

Installed recipe definitions remain in `recipe-library.sqlite`. A shared server-only connection helper owns regular-file checks, schema creation and busy timeouts. Installation and lifecycle use the same table; no migration, shadow directory or archive is needed. Update/removal parses the current stored manifest and compares its content digest inside the write transaction. An update pins both incoming and current content; identical retry is a no-op. File-catalog IDs are rejected by the application boundary.

Recipe-library inspection, graph conversion, update/removal and CLI/HTTP/MCP call one service. Pure result types are owned by the harness and imported by presentation as types. Feature hooks own browser reads/mutations; the UI owns review and confirmation. Every new module stays within the existing architectural budget.

Recipe packs preserve their original summary/composition digest. Read projections recompute the digest from current members in a database read transaction and expose complete/modified/missing state. Pack reinstall must revalidate all members even when the pack record already exists; exact members are reused, missing members can be restored, and different members block the transaction. Creative-pack snapshot storage stays independent and immutable.

A recipe catalog is an authoring source. Durable jobs already contain their compiled inputs, bindings and fingerprints; lifecycle never edits the jobs database or project state. New UI check/run requests pin the digest loaded with the input form so a concurrent recipe edit fails before enqueue. The optional field keeps direct agent requests that intentionally select the latest definition compatible. It does not pin an entire future job to a mutable recipe lookup: compilation reads one definition and persists the resulting plan as before.

The feature does not implement pack-wide lifecycle, runtime module updates, automatic release polling or revocation of already queued work. Those boundaries require their own contracts.
