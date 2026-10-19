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
| Collaboration | Team/project sharing and community | Shared projects, comments, permissions, reproducible remix packages | Target |

## Verified subset (not full-row completion)

Local asset import, canvas/UI/MCP state sharing, multitrack timeline foundation, clip split, caption persistence, actual browser and server MP4 export, durable job recovery tests, project-scoped Runs UI/API/MCP and the SDK Router adapter are implemented. See `VALIDATION.md` for evidence and limits. Provider-receipt-to-asset import and revision-checked attachment pass fixture and browser tests. Image, video and binary audio recipe paths share the materializer and editor; byte-receipt recovery and a mixed recipe-output export are fixture-tested. Actual Comfy generation/import together remains unverified; no entire area above is marked complete.

## Performance gates

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
