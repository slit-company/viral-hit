# Structured provider report handoff

`core/generation-providers/analysis-report.ts` owns a pure provider-independent output schema. Installed runtimes validate and retain reports in the existing generation output, using the report summary for text presentation when necessary. No database column, duplicate report store, new worker or polling loop is introduced.

`analysis-records.server.ts` owns bounded discovery and exact-generation lookup. It reads only succeeded records from the requested project, requires a pinned local video input and server-recorded provider/model identity, and hashes the normalized report plus original pin and model identity. Operator modules remain trusted code; typed observations are data, not tool instructions.

`core/storyboards/analysis.server.ts` verifies the retained source through the storyboard media boundary and delegates to a pure plan builder. The builder preserves selected observation order and original ranges, copies optional proposals into editable shot fields, labels references as inferred, and attaches immutable source evidence. It creates no recipes, accepted results, saved boards or runs. The existing explicit save/revision/generation/accept/assemble boundaries remain authoritative.

The transport exposes these operations through the existing storyboard service and schema. UI hooks own loading and unsaved draft state; the input component uses shared SEED fields. Portable plans retain report evidence as historical context, while only actual asset references are remapped. The full source report remains in its original generation database.

Validation covers report bounds, schema drift, independent immediate/queued output, proposal order and editable fields, source ownership/integrity/status, selected range validity, explicit save and portable evidence. Creative interpretation and provider quality require separate real-model evidence.
