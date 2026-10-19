# Validation ledger — 2026-10-19

Local machine: macOS arm64, Node 24.19.0, pnpm 10.32.1. Source tests and browser tests run against this checkout. Raw logs and captures are local ignored evidence under `research/evidence/` and `apps/studio/test-results/`.

| Check | Result | Limit |
|---|---|---|
| Production build | Passed | Local build; not public deployment |
| Clean checkout setup/build | Passed | Fresh local clone at `29672cd`, no preexisting node_modules or database; `pnpm run setup` and `pnpm build` both passed and tracked files remained clean |
| TypeScript and translation key check | Passed | New Runs panel currently English only |
| Unit/integration tests | 473 passed | Includes seven workflow-import tests, five input-upload integration tests and seven native ComfyUI integration tests; SDK tests use fixtures |
| Browser E2E | 10 passed | One sequential run, local Chromium; provider credentials deliberately removed |
| Shared UI/MCP editing | Passed | Canvas drag alongside MCP prompt revision; no lost prompt change; persisted after reload |
| Imported image → timeline → MP4 download | Passed | Actual H.264 1920×1080, 30 fps, 60 decoded frames, 2.000 s, 46,381 bytes; still-image fixture, not a video quality benchmark |
| Captions | Passed | Remote edit visible without reload, local text edit persisted; desktop/mobile captures |
| Runs HTTP/UI | Passed | Schema, trust header, missing run and missing-key UI; no paid submission |
| Worker recovery | Passed in deterministic tests | Restart, same-key replay, uncertain outcome, lease fencing, dependency invalidation and cancellation races; not an actual provider outage test |
| Video/audio/caption server render | Passed | Original 3s motion split into two shots, rendered through MCP to project-owned H.264/AAC MP4: 1920×1080, 90 video frames, both streams 3.000s; requires full FFmpeg with drawtext |
| Visual feedback loop | Passed, 4.205/5 | Actual editor at 1440×1000; not a rating of generation quality |
| Extensible recipes | Passed | Separate manifest directory, dynamically rendered third-party form, MCP discovery, offline compile and persisted output binding/restart tests; no live generation |
| Recipe visual feedback | Passed, 4.15/5 | Fixed long-form action clipping after real desktop/mobile inspection |
| Durable media import | Passed | Live recipe enqueue → separate worker → public HTTPS PNG → local asset → timeline passed, with the pinned upstream SHA-256 verified; PNG, MP4/audio and WAV probe fixtures passed; not an actual model output |
| Recovery and timeline attachment | Passed | Immutable file recovered after injected interruption without redownload; worker restart, one-clip attachment replay, stale revision rejection, cross-project rejection and corrupt-file rejection |
| Empty editor regression | Fixed and tested | Initial empty autosave previously erased a first externally inserted clip. New browser test requires live appearance and persistence after reload with no document-replacement write |
| Materialized media visual feedback | Passed, 4.255/5 | Runs and attached editor reviewed at 1440×1000; real fixture explicitly labeled, no clipping |
| Video and speech recipes | Contract/fixture tests passed | Model-specific public schemas checked and hashed; typed controls, native request bodies and output bindings tested; no paid model calls |
| Binary result recovery | Passed | Real encoded MP3 with fixture SDK; interrupted after atomic receipt publication, recovered without another submit/get; altered bytes and cross-project references rejected; mislabeled HTML never registers as audio |
| Recipe outputs → mixed timeline → MP4 | Passed | Browser attached both recipe assets, reload preserved video/audio tracks, MCP export decoded without errors: H.264 1920×1080, 90 frames, AAC, both streams 3.000s; procedural video/tone fixtures, not model-quality evidence |
| Multimodal form/editor visual feedback | Passed, 4.28/5 | Fixed identifier textareas and clipped desktop controls; motion/speech forms and mixed editor reviewed at 1440×1000; existing mobile form checked at 390×844 |
| Native ComfyUI workflow | Passed | Real model-free native server run; see [local ComfyUI](LOCAL-COMFYUI.md). No diffusion quality claim |
| User graph → portable recipe → native execution → editor | Passed | Offline CLI import, external recipe directory, UI parameter edits, real ComfyUI 720×480 PNG, durable import and timeline reload; model-free graph |
| Project image input → ComfyUI → editor | Passed | Real 640×640 RGBA output, original retained, input upload recovery fixture tests; visual review 4.335/5 |
| Light UI and generated branding | Passed, visual review 4.325/5 | Actual desktop 1440×1000 and mobile 390×844 captures; self-review is not user design acceptance |
| Actual paid Comfy Router generation | Not run | Server `COMFY_API_KEY` absent; no quality/latency/cost claim |
| Higgsfield comparative benchmark | Not run | Full feature/performance parity is not established |

Reproduce with `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm --dir apps/studio test:e2e`. E2E creates an isolated temporary database and calls the real local UI/MCP/FFmpeg tools without provider keys. `test-results/verified-local-export.mp4` is the actual browser export, not a fake fixture labeled as generated output.

## SEED design and Viral Hit branding

The current UI uses SEED-based light tokens, Pretendard, SEED actions/dialogs/text fields and the adapted shared BackButton. See [design provenance](DESIGN.md) and [generated assets and prompts](BRAND.md). Both the transparent app symbol and the “Viral Hit” wordmark were generated with the built-in image_gen tool and integrated into the app.

Typecheck, all 461 source tests, the existing eight browser tests, the new theme/focus browser test, and the production build passed. Browser rendering tests used `VIRAL_HIT_FFMPEG=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`; the default FFmpeg lacks drawtext. A production-server smoke test loaded home/editor, opened and dismissed Runs, and recorded no page errors. This is local validation, not a deployment.

Visual evidence is under `research/evidence/redesign/`. Round 1 found a dialog obscured by its backdrop, residual dark panels and mobile overflow. After fixes, round 2 scored 4.325/5 with no hard failures. Home, projects, editor, studio, canvas and assets were inspected at 1440×1000; Runs and projects were also checked at 390×844. The browser test verifies light surfaces even under a dark OS preference, dialog keyboard focus containment, Escape and focus restoration, visible branding, and mobile bounds. Historical visual scores above describe earlier snapshots and do not imply user approval of the rejected dark design. Model quality and Higgsfield parity remain unmeasured.

## Imported workflow evidence

Workflow importer evidence: `research/evidence/comfy-import/` contains CLI inspection, the generated manifest, 467-test log, desktop captures and the actual run receipt. The source graph and definition are committed examples under `examples/comfy-*`. A separate server and database discovered only the imported recipe through `VIRAL_HIT_RECIPES_DIR`. Browser edits changed width/height from 512×512 to 720×480; the native ComfyUI 0.42.0 server returned a 2,409-byte PNG with SHA-256 `f8b98ac2dc429c516bce2a4423504630f4b0ea00be9a5e6c3bc9c14fc986d546`. Both execution and materialization succeeded. The browser added one three-second image clip and verified persistence after hydration on reload. No provider key, paid call or model weights were used. The importer does not validate arbitrary custom-node semantics or install their dependencies.

## Project image inputs

`research/evidence/comfy-inputs/` retains the selected project asset, generated recipe, native upload/workflow/materialization receipts, screenshots and test logs. The transparent Viral Hit symbol was selected through Runs, sent to the configured native ComfyUI server and resized to 640×640. The first resize graph dropped alpha; the corrected graph rejoins the native loader's mask using JoinImageWithAlpha. Its 148,139-byte RGBA PNG has SHA-256 `122f247ab73fc6e39c8527c22f4312b979677af4d57518a1e86808f972bdae4a` and alpha range 0–254 after interpolation. The unchanged original and new output remain distinct assets; the output persisted as one three-second timeline clip after reload. No model weights or paid provider were used. This proves the image-input bridge and the example transform, not arbitrary custom-node quality.

All 473 source tests, TypeScript, production build and 10 browser tests passed. New fixture tests cover project isolation, modified source bytes, server changes, lost upload response/restart, deterministic filenames, redirect refusal and output-name rejection. Browser checks cover project-scoped selection, preview and mobile action visibility. The first full browser run overlapped a build and dev startup, causing generated Paraglide files to disappear/change during requests; seven tests failed. Running build and E2E sequentially passed all ten. Both logs are retained. Development React state-update warnings remain; the final production UI smoke recorded no page errors.

The actual production selector was reviewed at 1440×1000 and 390×844. A large full-width preview hid dimension fields on mobile; compacting the preview beside selection improved the fixed rubric from 3.94 to 4.335/5. The queue action remains visible and the Height control is reachable by scrolling. The first controller attempt stopped on an artifact/source metadata mismatch; it is retained under `review/`. The corrected evidence-source run is under `visual-review/`. This review is not user design acceptance.

## Quality and speed protocol

Before claiming parity, freeze a test suite covering at least image generation/edit, image-to-video, multi-shot character continuity, motion/object transfer, reference edit reconstruction, masks/layers, captions, music/voice and export. Use the same available model/version, prompt, references, seed, duration, resolution and retry policy in both products wherever possible. Record where provider contracts differ.

Retain all attempts, provider receipts, full wall times, costs, failure types, output hashes, accepted revisions and final exports. Measure orchestration overhead separately from provider generation time. Compare p50/p95 only after enough repeated runs; one successful short export proves neither editor throughput nor generation quality. For subjective quality, use blinded pairwise review with prompt adherence, identity, motion continuity, typography, pacing and audio alignment scored separately. Record ties and failures.

Release gates include real provider artifact localization, crash recovery at every persistence boundary, visual review at fixed sizes, long/4K/multi-track playback tests, A/V drift measurement and a clean-checkout install. The clean-checkout install/build gate passed; the remaining release gates stay open until actual evidence is attached.

Browser motion demo export also decoded to 90 video frames (3.000s) and AAC audio (3.072s). The 72ms container/audio tail is recorded as a remaining browser-export alignment issue; no exact audio-duration parity is claimed. Server export of the motion/caption fixture has matching 3.000s streams.

The first clean-checkout attempt exposed a documentation error: `pnpm setup` invokes pnpm’s own shell setup instead of the package script. Use the explicit `pnpm run setup` shown in the corrected README. The corrected command installed dependencies and initialized the SQLite schema before a successful build.
