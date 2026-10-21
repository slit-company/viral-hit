# Project storyboards

Storyboards own a versioned creative plan, reference observations and explicitly accepted shot results. They compose existing project media, recipes, durable runs and editable sequences. They do not introduce an execution engine, model SDK, polling worker or brand-specific format.

The first transport surface is HTTP/MCP/CLI. A human or external planning agent authors the same document. General and specialized plans differ in content/scope, not storage or execution policy. Observations identify source assets/hashes and distinguish observed, inferred and proposed statements; storing an observation does not prove visual inspection. Shot directions and preserve/change/avoid decisions remain explicit. Recipe values are the actual execution inputs; prose is never silently injected into a provider request.

`core/storyboards/` owns pure ingestion contracts, its bounded SQLite store, project-media validation and orchestration. It depends on existing project, recipe, harness and sequence services. Execution, project mutation and media owners do not import storyboard orchestration. The project-bundle composer can import the storyboard-owned portable boundary described below. UI imports pure contracts for local draft validation; routes/MCP/CLI invoke the same application service. Browser imports must never reach the store, media service or execution service.

State is revisioned per project/board. Saving retains the prior revision and only preserves an accepted result when its shot definition and reference context remain identical. Acceptance records the exact source hash and caller-supplied review notes. New generations do not replace accepted results. References and accepted bytes are checked before execution/assembly.

Before enqueue, store an immutable action containing the exact pinned plan and stable request identity under the board revision transaction. Enqueue then uses the existing durable harness key. Resume reads that original reservation rather than recompiling current recipes. A crash between reservation, enqueue and recording the run ID is recoverable without another generation. A plan edited after reservation does not rewrite already authorized work. Never hold a SQLite transaction across an asynchronous operation.

Assembly creates an ordinary `editor.sequence` run from current accepted shots, timing and optional captions/audio. The existing worker validates real media and the existing revision-checked attachment command appends the sequence to the editor. Assembly does not overwrite a timeline, publish, or claim visual QA. Rendering and destination approval remain existing separate operations.

Limits: 16 shots, one-hour sequence, 256 KB per stored document/action, 64 board identities, 512 retained revisions and 256 actions per project. No automatic history purge. Browser draft JSON remains project-local. Project files can carry latest storyboard plans and owned media through the portable boundary below.


## Browser draft boundary — 2026-10-21

The browser authoring workspace owns presentation and one session-local project draft. Its draft schema derives the plan shape while allowing incomplete form text and ranges; it cannot admit executable plans. Save/accept/generate/assemble still pass the original application-service schema, membership, bytes and revision checks. This deliberately adds a pure-schema consumer to the earlier types-only UI boundary, without importing server modules or duplicating the execution service.

The controller serializes browser actions and suppresses responses from an unmounted route. It preserves local edits when refreshing a newer server plan and requires an explicit reviewed replacement or discard. Exact generation/assembly requests are written to session storage before submission; an unknown response retains the original request across reload. HTTP only reports a known unreserved rejection after consulting the action store. Recovery retries the original request rather than recompiling under a new identity. No extra background poller or runtime dependency is introduced.


## Project-file composition — 2026-10-21

The project-bundle composer now includes storyboard-owned portable definitions in format version 2. Version 1 files remain readable and projects without boards retain version 1 exports. Each board carries its latest authored plan, source revision and accepted media with notes/timestamps. Execution reservations, provider job IDs and action history are installation-local and are not copied. Exact recipe definitions are inert metadata, not installed code or automatic library changes. Their declared asset parameters provide the mapping contract; prompts and arbitrary scalar values are never rewritten by guessed string matching. A missing exact recipe version blocks export rather than silently losing its inputs. Definitions retained by an earlier import allow re-export without installing those recipes.

Media identity, kind, measured range and acceptance fingerprints are checked before review. Import maps references, soundtrack, accepted media and declared recipe asset parameters to the new project's assets, then recomputes shot fingerprints. Accepted media remain editable without a model provider; new generation still requires an explicitly installed matching recipe and configured runtime through the normal service.

Storyboard storage atomically stages all imported first revisions and inert recipe snapshots before the main project transaction activates the new project and its media. These rows are inaccessible through the application while their project does not exist. If activation fails, retry compares the exact first staged revision; it cannot overwrite later user edits. This is ordered activation across stores, not a cross-database transaction. Unactivated staged metadata and retained bundle files require future operator cleanup. Export compares the complete storyboard snapshot after media packaging and rejects concurrent edits. Project import never calls the execution service or creates harness/publication jobs.
