# Full product parity target

The target is the whole Higgsfield creative workflow, not an advertising MVP. This file is a target and evidence ledger. A checkbox is complete only with a reproducible real run. API parity alone does not establish model quality parity.

Observed in Aside on 2026-10-19; no paid comparison generations submitted yet.

| Area | Observed Higgsfield surface | Viral Hit acceptance | Status |
|---|---|---|---|
| Images | Multi-model generation, image edit, references, upscale | Import/generate/edit/save images; provider capabilities validated | Target |
| Video | Text/image/video conditioning, model and duration selection | Actual asynchronous generation, playable durable assets, aspect and fps checks | Target |
| Cinema | Film/camera/palette/light; composable camera moves; 50 reference slots; batches | Structured shot controls, characters/elements, multi-shot sequence, per-shot regeneration | Target |
| Genjutsu | Motion transfer and object swap; 4–30 s reference; up to 30 images | Preserve motion/scene while replacing intended subject; temporal consistency benchmark | Target |
| Katana | Reference edit + character references + optional instructions, Claude handoff | Analyze edit grammar; replace inputs; deliver editable project and final render | Target |
| Layers | Relight, inpaint, decomposition, text editing, effects | Mask/layer operations, original retention, reversible edits, flattened and layered exports | Target |
| Canvas | Connected media workspace | Connected typed nodes, branching, shared assets, provenance, partial recomputation | Target |
| Editor | Reference-driven edits plus image layer editor | Integrated multitrack NLE, trim/split/reorder, captions, audio, keyframes, transitions, export | Target |
| Audio | Dedicated audio navigation and lipsync surfaces | TTS/cast, music/SFX, measured alignment, mixing/ducking, lipsync | Needs deeper UI audit |
| Characters | Soul ID, influencers, reusable elements | Identity library, reference consistency, permission and provenance records | Target |
| Agent | Supercomputer: projects, skills, connectors, memory, ask-before-generation mode | Same project operations as UI; durable jobs; revisions, retries, cancellation, budget ledger | Target |
| Templates | VFX, UGC, explainers, marketing, photography | Versioned, forkable workflows with editable parameters and actual execution | Target |
| Extensibility | MCP, CLI and API | Versioned APIs, MCP, local/server providers, capability discovery | Target |
| Publishing | Additional requested scope: Meta/Instagram and YouTube | Generic destination connectors, export identity, approval/schedule, remote receipt and reconciliation | YouTube connector, durable intents, retained-video review/approval UI, shared HTTP/MCP/CLI and separate worker fixture-tested; encrypted accounts and browser connection management implemented; Instagram local-upload/second-write protocol fixture-tested; Instagram explicit account/Page connections implemented; Instagram Reel/Story admission, preview and shared approval/delivery flow implemented; Instagram local scheduling implemented; images/carousels, retention cleanup and authorized live verification remain pending |
| Measurement | Additional requested scope: creative performance feedback | Versioned metrics linked to published creative, partial collection states and analysis | Source audit only; not implemented |
| Collaboration | Team/project sharing and community | Shared projects, comments, permissions, reproducible remix packages | Target |

## Verified subset (not full-row completion)

Local asset import, canvas/UI/MCP state sharing, multitrack timeline foundation, clip split, caption persistence, actual browser and server MP4 export, durable job recovery tests, project-scoped Runs UI/API/MCP and the SDK Router adapter are implemented. See `VALIDATION.md` for evidence and limits. Provider-receipt-to-asset import and revision-checked attachment pass fixture and browser tests. Image, video and binary audio recipe paths share the materializer and editor; byte-receipt recovery and a mixed recipe-output export are fixture-tested. Native ComfyUI execution/import passes a real model-free run, including an independently imported API graph discovered as a recipe and edited through the generated form. Project image input → native resize → durable output → editor is also verified with real bytes; this does not establish image-editing model quality. Native node/model-choice inspection is shared across UI, CLI and MCP and runs without job submission; its advisory schema report is not full runtime or model-quality validation. Materialized results can be applied as reversible same-kind clip takes with revision checks and preserved neighboring edits; this does not evaluate the creative quality of a take. The studio can inspect, install, fork and export portable recipe manifests through a persistent local library shared with HTTP/MCP; an imported model-free native recipe has executed and produced a durable timeline asset. The studio can also convert an API-format ComfyUI graph into a reviewed recipe by selecting exposed controls, attribution and output; actual image upload, native execution and timeline persistence are verified. This does not establish a hosted marketplace, a node-authoring canvas or arbitrary custom-node compatibility. Workspace native-server connection check/save/disconnect now shares persistent revision-checked settings across UI, HTTP, MCP and worker; a real run after UI configuration passed without restarting either process. Native jobs pin their original server and ambiguous recovery cannot become a resubmission after a connection change. Authenticated native endpoints and multi-server/per-project routing remain open. Actual paid Comfy Router generation/import together remains unverified; no entire area above is marked complete.

Interrupted timeline edits now have browser-local draft recovery, exact-snapshot JSON download, disjoint merge, conflict preservation and undoable restoration. In-flight saves preserve newer edits and check their rebase conflicts. This is not cloud synchronization, per-field conflict resolution or a portable project/media archive; see [recovery limits](EDITING-RECOVERY.md).

Independently installed `ext.*` execution adapters now share discovery, typed input schemas, pinned plan admission and the durable worker. Code/configuration fingerprints fence old jobs; scoped binary receipts flow through media import and timeline attachment. The procedural WAV example has executed on the production build and exported with a visual clip. This proves extension plumbing and a real local processor, not third-party model quality, isolated plugin execution or a marketplace. See [external adapters](EXTERNAL-ADAPTERS.md).

[Reference intake](REFERENCE-INTAKE.md) supports portable YouTube collection and project-video sampling recipes through Runs, HTTP/MCP and the worker, plus CLI input for explicit Instagram direct-video item payloads. A real public YouTube example was collected through the production UI, sampled and attached to its timeline. Independently installed adapters can consume the verified resulting video. Instagram payload parsing/download boundaries are tested, but live login/inbox polling, shared-reel acquisition and full audiovisual analysis remain open. This is source acquisition, not outbound publishing or generation-quality parity.

## Performance gates

Optional music2 and vid2 adapters execute authored scores/procedural timelines and compositions of verified project images, video and audio through the real harness, produce WAV/MP4 assets, attach to the editor and export together. Optional media slots and upstream materializer bindings allow general compositions and specialized forkable recipes. The built-in `editor.sequence` step prepares separately editable visual, image-overlay, audio and caption tracks from project assets or materializer bindings; explicit attachment preserves prior edits. Native vid2 layer round-trip remains open. This is a bounded subset of Audio/Editor/Templates, not full-row completion. ima2 now has optional prompt/reference image adapters with exact provider/model selection and read-only recovery. Actual ima2 3.26.3 routes/storage plus harness/materialization/timeline are verified with synthetic AI output; live provider quality, masks, branches and alpha verification remain open. [Publishing](PUBLISHING.md) has a fixture-tested YouTube connector/store/step worker and encrypted OAuth account service with a browser connection/reconnect/disconnect flow; publication review/approval/delivery UI, shared HTTP/MCP/CLI and a separate worker are implemented. Instagram local streaming upload and final publication fencing are fixture-tested; Instagram account/Page connections are implemented; Instagram Reel/Story publication admission and shared UI/HTTP/MCP/CLI flow are implemented; Instagram local scheduling is implemented; images/carousels and authorized live publishing remain open. See [source coverage](LOCAL-MEDIA-SOURCES.md) and [measured performance/bundle budgets](PERFORMANCE.md).

Measure cold and warm runs separately on fixed machine/browser/model versions. Report p50/p95, failures, external generation cost and number of rerun nodes. Never compare different providers as if only the harness changed.

- Preview: measure dropped frames and scrubbing latency on 1080p/4K, landscape/portrait, short and multi-minute projects.
- Export: compare identical media/timeline with baseline FFmpeg and candidate engines; frame count, A/V offset, captions and transforms must agree.
- Revision: editing one shot must preserve unrelated accepted shots; changes to shared character inputs invalidate dependent generations.
- Reliability: injected network timeout, process death, provider failure, duplicate submission, cancellation and stale callbacks cannot silently corrupt the project or duplicate paid work.
- Quality: blinded pairwise rating of prompt adherence, identity, temporal consistency, motion, typography, pacing, audio; retain failed runs, full distributions and total cost, not only cherry-picked outputs.
- Model boundary: proprietary-model quality may require the same provider/API or equivalent model. Open-source orchestration is not a replacement for unavailable proprietary weights.

## Submission checklist

- [ ] Full acceptance matrix with evidence and honest remaining gaps
- [ ] Comfy Router/SDK real generation receipt
- [x] Local install tested from a clean checkout (`29672cd`; see validation ledger)
- [ ] Open-source license and third-party notices
- [ ] Sanitized public release with no private brand/IP/account data
- [ ] ≤2 minute demo covering creation, targeted revision, timeline edit, export
- [ ] Public social demo with required tag, then submission

Registering, social posting, and submitting are not performed by creating this repository.
