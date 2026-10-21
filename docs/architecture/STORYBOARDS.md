# Project storyboards

Storyboards own a versioned creative plan, reference observations and explicitly accepted shot results. They compose existing project media, recipes, durable runs and editable sequences. They do not introduce an execution engine, model SDK, polling worker or brand-specific format.

The first transport surface is HTTP/MCP/CLI. A human or external planning agent authors the same document. General and specialized plans differ in content/scope, not storage or execution policy. Observations identify source assets/hashes and distinguish observed, inferred and proposed statements; storing an observation does not prove visual inspection. Shot directions and preserve/change/avoid decisions remain explicit. Recipe values are the actual execution inputs; prose is never silently injected into a provider request.

`core/storyboards/` owns pure ingestion contracts, its bounded SQLite store, project-media validation and orchestration. It depends on existing project, recipe, harness and sequence services. Core owners do not import storyboards. UI may use types only; routes/MCP/CLI invoke the same application service.

State is revisioned per project/board. Saving retains the prior revision and only preserves an accepted result when its shot definition and reference context remain identical. Acceptance records the exact source hash and caller-supplied review notes. New generations do not replace accepted results. References and accepted bytes are checked before execution/assembly.

Before enqueue, store an immutable action containing the exact pinned plan and stable request identity under the board revision transaction. Enqueue then uses the existing durable harness key. Resume reads that original reservation rather than recompiling current recipes. A crash between reservation, enqueue and recording the run ID is recoverable without another generation. A plan edited after reservation does not rewrite already authorized work. Never hold a SQLite transaction across an asynchronous operation.

Assembly creates an ordinary `editor.sequence` run from current accepted shots, timing and optional captions/audio. The existing worker validates real media and the existing revision-checked attachment command appends the sequence to the editor. Assembly does not overwrite a timeline, publish, or claim visual QA. Rendering and destination approval remain existing separate operations.

Limits: 16 shots, one-hour sequence, 256 KB per stored document/action, 64 board identities, 512 retained revisions and 256 actions per project. No automatic history purge. A storyboard is project-local; exporting its JSON does not bundle media or make asset IDs portable. Project-bundle inclusion and browser authoring remain subsequent work.
