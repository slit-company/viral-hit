# Structured provider report handoff

`core/generation-providers/analysis-report.ts` owns a pure provider-independent output schema. Installed runtimes validate and retain reports in the existing generation output, using the report summary for text presentation when necessary. No database column, duplicate report store, new worker or polling loop is introduced.

`analysis-records.server.ts` owns bounded discovery and exact-generation lookup. It reads only succeeded records from the requested project, requires pinned local media inputs and server-recorded provider/model identity, and hashes the normalized report plus original pin(s) and model identity. Operator modules remain trusted code; typed observations are data, not tool instructions.

`core/storyboards/analysis.server.ts` verifies the retained source through the storyboard media boundary and delegates to a pure plan builder. The builder preserves selected observation order and original ranges, copies optional proposals into editable shot fields, labels references as inferred, and attaches immutable source evidence. It creates no recipes, accepted results, saved boards or runs. The existing explicit save/revision/generation/accept/assemble boundaries remain authoritative.

The transport exposes these operations through the existing storyboard service and schema. UI hooks own loading and unsaved draft state; the input component uses shared SEED fields. Portable plans retain report evidence as historical context, while only actual asset references are remapped. The full source report remains in its original generation database.

Validation covers report bounds, schema drift, independent immediate/queued output, proposal order and editable fields, source ownership/integrity/status, selected range validity, explicit save and portable evidence. Creative interpretation and provider quality require separate real-model evidence.

Analysis models may declare mixed-media input ranges. Legacy version 1 identifies a single source timeline. For version 1, `analysis-records.server.ts` admits only exactly one local video with no image/audio companions; arrays and the legacy singular alias must agree. Legacy batch reports remain in generation history and cannot silently become first-video storyboard evidence. Version 2 uses the explicit source contract below.

## Source-specific version 2

Reports may identify each observation with a zero-based `{kind, index}` into the exact per-kind input array. `analysis-source-pins.server.ts` resolves these positions exclusively from retained project-media pins, rejects absent/foreign/duplicate/remote inputs and binds every original into the report fingerprint. The version 1 identity and normalized key order remain unchanged. Version 2 requires a source on every observation; image observations have no timeline, while video/audio observations require a range.

Storyboard preparation verifies all original inputs sequentially, including companions not selected as shots, then maps each selected observation through its own verified source. Evidence retains observation ID and source position, while portable actual references retain normal asset remapping. Untimed images default to an editable three-second shot when the provider omits a proposal duration; audio observations become references for shots, not implicitly added soundtrack. No accepted result or generation follows from preparation.
