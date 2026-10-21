# Structure rules

These rules govern new work and changes to existing code. Read them before implementing a feature. The product remains a general creative workspace; brand-specific marketing workflows are optional extensions. `docs/PARITY.md` records acceptance scope, not a claim of completion.

## Ownership and dependency direction

| Area | Owns | Must not own |
|---|---|---|
| `src/components/base/`, `src/components/ui/`, `src/styles/` | Shared SEED controls, layout primitives, accessibility, tokens | Project persistence, provider calls, business decisions |
| `src/components/<feature>/` | Feature presentation, user interaction and browser state | Secrets, databases, filesystem access, provider SDKs |
| `src/lib/` | Small shared platform helpers with explicit browser/server use | Feature orchestration or an unstructured dumping ground |
| `src/routes/api/`, `src/mcp/`, `scripts/` | Transport validation, trust checks, mapping to application services | Independent copies of domain mutations or provider behavior |
| `src/core/commands/` | Revision-checked project mutations, idempotency and origin | React or transport-specific policy |
| `src/core/projects/`, `src/core/editor/`, `src/core/creative-canvas/` | Project, asset, timeline and canvas behavior; pure contracts beside their owners | Imports from UI or routes |
| `src/core/harness/` | Plans, durable jobs, bindings, recovery, receipts and runtime adapters | Product-specific campaign logic or UI state |
| `src/core/references/` | Explicit source acquisition, verified originals/samples and bounded visual-cut analysis with editable interval output | Inbox session management, sending messages, pretending previews are full media or semantic analysis |
| `src/core/transcripts/` | Provider-independent machine transcript validation and relative subtitle serialization | Model installation, independent execution queues or claiming recognition accuracy |
| `src/core/storyboards/` | Revisioned creative plans, source observations, accepted shot identities and orchestration through existing runs/sequences | A second execution engine, invented visual inspection or brand-specific format constraints |
| `src/core/creative-packs/` | Reviewed composition/transfer of recipe, skill and character definitions, verified images and explicit partial-install recovery | A second execution engine, unchecked cross-library overwrite or silent runtime installation |
| `src/core/skills/` | Bounded skill definitions, compatibility, reviewed lifecycle and atomic managed storage | Executing skill text, project mutation, remote polling or overriding official/operator files |
| `src/core/community/` | Bounded independent catalog metadata, review diffs and local snapshots | Artifact execution/installation, background network discovery or a second package library |
| `src/core/runtime-packages/` | Reviewed executable package metadata/source, immutable releases, atomic desired-state changes and process snapshots | A second execution engine, install scripts, dependency downloads or hot task migration |
| `src/core/extensions/` | Read-only public diagnostic projections of installed extension catalogs, shared by UI/MCP/CLI | Runtime installation, module execution, provider probes, configuration values or independent registration state |
| `src/core/publishing/` | Approved media/destination intents, leases, resumable transfer, remote receipts and reconciliation | Generation, shared UI, credentials in public views or remote calls inside transactions |
| `src/core/db/`, `src/core/workspace-db/`, storage modules | Database/file persistence and transaction boundaries | UI or provider workflows |
| `examples/adapters/`, `recipes/` | Independently replaceable processors and portable workflows | Imports from app internals, private account data or product-wide assumptions |
| `extensions/<name>/` | Separately installed runtimes, bundled entrypoints, own tests/lockfile | Default studio dependencies, browser imports, silent tool installation |
| `research/upstream/`, `research/evidence/` | Ignored reference checkouts and local evidence | Runtime dependencies or distributable private content |

Dependencies point from presentation/transport into domain services and then persistence/provider adapters. Core never imports UI or routes. Shared controls never import feature/domain logic. Runtime imports reachable from browser components must not reach Node built-ins, database drivers or provider SDKs. Use type-only imports for server-owned types. New browser/server mixed modules must be split at the boundary, not hidden behind `typeof window` branches.

Use feature-local components and hooks instead of adding another top-level abstraction directory. Keep a pure eligibility/formatting rule beside its domain owner and export its types explicitly. Name server-only additions `*.server.ts` when they do not already live in an established server-only domain module. Avoid a global barrel exporting browser and server code together.

## Rules before implementation

For each substantial change, identify the owning domain, input/output contract, persistence boundary, recovery behavior and verification evidence. Record a new architectural decision under this directory only when introducing a new boundary, dependency or exception; ordinary feature work needs a concise PR/commit description, not a ceremonial document.

- New source modules stay at or below 400 nonblank lines. An existing larger module has an explicit, non-growing allowance. Split by responsibility when touching it; do not split into arbitrary numbered files or compress statements to satisfy a count.
- New runtime dependency cycles are prohibited. Existing cycles, if any, must be individually recorded and reduced; broad directory exemptions are prohibited.
- UI components render and compose hooks. Separate loading/mutations, draft synchronization, media processing and recipe interpretation from rendering. A component with multiple independent workflows needs feature-local subcomponents/hooks even below the line threshold.
- External requests do not run inside SQLite transactions. Side effects use stable identities, persist receipts and distinguish rejection from an unknown outcome. Provider output, registered asset, accepted take and published post are different states.
- HTTP, MCP and CLI call the same application operations. They validate transport trust independently and must not bypass project membership, revision checks or admission rules.
- Add schemas at ingestion and typed internal contracts. Do not spread `any`, catch-and-ignore errors, or ad-hoc JSON parsing through UI. Dependency injection is for actual boundaries/tests, not generic frameworks without callers.
- Domain tests exercise invariants and failure recovery. Browser tests cover meaningful user flows. A fixture or mock cannot establish live provider behavior, model quality or publishing success.

## SEED UI policy

Use an existing SEED component when its behavior fits. Otherwise adapt the same SEED primitive and owned tokens through the shared UI layer. Feature code must not start a competing button/dialog/input system. Keep a source/adaptation map in `docs/DESIGN.md`; direct source reuse, SEED-based adaptation and visual token reuse are different categories. Do not claim a reuse percentage without a defined denominator and source evidence.

Native media, file, range and color controls may remain where appropriate. Preserve their accessible names and interaction behavior. The wide creative editor is a separate layout from SEED' consumer phone shell. Brand/product content is not imported merely to reuse a component.

## Publishing and analytics extension boundary

Meta, YouTube and other destinations belong behind publishing connectors with explicit account selection, credential isolation, immutable export identity, review/approval state, scheduled delivery, remote receipt and reconciliation. A network timeout must not authorize a duplicate post. Analytics is a versioned observation linked to a published creative, not a mutation of accepted source media. reference pipeline and marketing repositories are references for reusable implementations; private sessions, credentials, business rules and datasets are excluded from the generic core.

These are required contracts for upcoming work. Publishing connectors and analytics are not implemented merely because they appear in this document.

## Automated gate and known debt

Run `pnpm architecture:check` before the normal typecheck, source tests, i18n and build gates. The checker uses TypeScript syntax trees to inspect local runtime dependencies, prohibited browser imports, core/UI direction, research imports, cycles and module size. It is a static guard, not a complete security or quality proof: arbitrary runtime module loading, package internals and runtime data flow still require review.

`architecture-baseline.json` records exact existing oversized modules and cycles. Never increase an allowance just to pass. Reductions are allowed after verification; a new exception requires a named architectural decision and review. The baseline does not mean that existing large modules are good structure.

Priority decomposition targets are the editor workspace, canvas shell/interaction adapter and MCP registration. Preserve behavior with meaningful tests while extracting cohesive responsibilities. New publishing/analytics work starts in its own domain instead of extending those large files.

## Installed publication connectors

`core/publishing/installed/` owns operator manifests, public discovery, metadata validation and the trusted module boundary. Browser code imports only pure contracts. Discovery reads bounded files and compiles a synchronous JSON Schema; it never imports executable modules. HTTP/MCP/CLI still call the existing publication application service. Installed destinations add ordered image/video/audio inputs; pinned media uses the existing integrity-checked streaming store.

Approval pins a fingerprint of connector manifest, source and declared environment values. The worker imports the captured source only for approved work, validates that fingerprint before every action, and delegates transfer/publish/reconcile to the existing lease/fence state machine. Configuration changes pause the original operation; unknown start/publish outcomes cannot trigger another write. Raw receipts and credentials stay server-side; only the explicit validated publicDelivery subobject can reach UI. Modules are trusted server code, not sandboxed plugins. Use separate optional runtimes for heavyweight dependencies.

Creative packs follow [the composition decision](CREATIVE-PACKS.md): preflight all content, retain each library's atomic mutations, report partial completion and reuse exact items on retry. Their completion record is an immutable snapshot, not a mutable link to current character profiles.

Managed skills follow [the lifecycle decision](SKILL-LIFECYCLE.md): whole-definition SQLite replacement, digest comparison under the write transaction, and managed overlays for unchanged legacy folders.

Community discovery follows [the catalog boundary](COMMUNITY-CATALOGS.md): metadata snapshots hand off checksum-pinned files to existing reviewed library operations.

Recipe lifecycle follows [the storage/execution decision](RECIPE-LIFECYCLE.md): compare definitions in one SQLite transaction, project pack completeness from current members, and pin the loaded recipe digest before new UI runs. Saved execution plans remain independent.

Recipe-pack maintenance follows [the atomic composition lifecycle](PACK-LIFECYCLE.md): preserve existing definitions by default, pin affected state and membership, replace/delete only explicit eligible selections, and keep saved execution plans independent.

Creative-pack releases follow [the composition lifecycle](CREATIVE-PACK-LIFECYCLE.md): explicit selected replacements through library owners, partial recovery with fresh review, immutable historical exports and removal that retains reusable contents.

Managed executable releases follow [the runtime package decision](RUNTIME-PACKAGES.md). Runtime owners consume captured source through their existing contracts; lifecycle changes never execute source and require coordinated process restart.

Project storyboards follow [the planning boundary](STORYBOARDS.md): retain reference context and exact shot definitions, reserve pinned actions before enqueue, explicitly accept results, then hand editable sequences to the existing worker and editor.

Installed generation providers follow [the local-input boundary](LOCAL-PROVIDER-MEDIA.md) when opting into project media: shared ownership/hash checks, bounded call-scoped readers and the existing generation/polling ledger.

Structured provider reports follow [the analysis-to-plan decision](STRUCTURED-ANALYSIS.md): pure bounded output contracts, identity-checked discovery, source-byte verification on preparation and an unsaved storyboard handoff through existing operations.

Independent model options follow [the declared-control boundary](MODEL-OPTIONS.md): bounded public definitions, namespaced values, model-scoped drafts and repeated validation before provider execution.


Declared audio references reuse the common per-kind count contract, existing asset-first admission and local provider reader. `referenceInputs` is optional metadata; omission retains text-only audio and existing fingerprints. Studio analysis/audio share source selection, bounded library projection and fenced upload/history actions. Model changes retain sources and reject incompatible submissions; no second upload store or polling engine is introduced.

Generation intent receipts belong to `core/effects`: bind the existing claimed intent to its project/model history before provider code runs, refuse reassignment, and preserve the link on failure. `core/generation-providers` projects read-only inspection to MCP/CLI through the existing public history view. Observation must not poll, refresh authorization or imply permission to repeat ambiguous work. See [recovery contract](../GENERATION-RECOVERY.md).
