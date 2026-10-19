# Validation ledger — 2026-10-19

Local machine: macOS arm64, Node 24.19.0, pnpm 10.32.1. Source tests and browser tests run against this checkout. Raw logs and captures are local ignored evidence under `research/evidence/` and `apps/studio/test-results/`.

| Check | Result | Limit |
|---|---|---|
| Production build | Passed | Local build; not public deployment |
| Clean checkout setup/build | Passed | Fresh local clone at `29672cd`, no preexisting node_modules or database; `pnpm run setup` and `pnpm build` both passed and tracked files remained clean |
| TypeScript and translation key check | Passed | New Runs panel currently English only |
| Unit/integration tests | 481 passed | Includes eight native preflight tests, seven workflow-import tests, five input-upload tests and seven native workflow tests; SDK tests use fixtures |
| Browser E2E | 11 passed; affected three rerun after layout changes | Local Chromium; provider credentials deliberately removed |
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
| Native server preflight | Passed | CLI/HTTP/MCP/UI inspect installed schemas without jobs/uploads; missing checkpoint and deferred uploaded filename verified on real server |
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

## Native server preflight

Evidence is under `research/evidence/comfy-preflight/`. On the actual configured native server, `local-canvas` reported its two available node classes; `local-diffusion` reported six available classes but no checkpoint choices; `local-image-resize` reported four classes and deferred its not-yet-uploaded filename. Empty user values were inspected without becoming executable plans. CLI exit codes were respectively 0, 2 and 0. Native history gained no new jobs. The production UI repeated the check, retained an empty harness run list and recorded no page errors.

Eight source tests cover GET-only behavior, class deduplication, reported choices/ranges, missing graph inputs, dangling links, deferred values, missing user selections, malformed/failed/oversized/redirected/timed-out responses and path normalization. Ordinary compilation continues to reject missing/cleared required inputs. HTTP/MCP/UI E2E verifies unconfigured reporting, no run creation and clearing a late response after input edits. The first test run exposed an outdated shared MCP catalog after the new tool was registered; the catalog and exact-inventory test now list all 33 tools. All 481 source tests, typecheck and build passed. All 11 browser tests passed, then the three affected UI/focus tests passed again after layout changes.

The initial visual inspection caught the queue action clipped by the modal even though a window-coordinate check passed. The final layout uses a compact action row, a bounded result panel and a shorter parameter scroller while the report is visible; tests now compare action coordinates with modal bounds. Desktop 1440×1000 and mobile 390×844 production captures verify the correction; the fixed visual rubric improved from 3.39/5 with hard failures to 4.28/5 without hard failures. This schema snapshot does not verify custom runtime semantics, model quality or successful generation, and never substitutes for ComfyUI execution-time validation.

## Reversible generated takes

The common materializer output now supports targeted alternatives through HTTP/MCP action `take`, with a target clip and expected revision. Source/unit integration tests exercise image, audio and video takes, original trim preservation, unchanged neighboring clips and captions, same-kind enforcement, duration rejection, track locks, stale revisions, cross-project isolation, file corruption and one-time import per job/clip. Replaying an import after restoring Original does not reactivate the take. The editor exposes its take selector on desktop and mobile; audio and image-overlay previews now resolve the active source as the exporters already do.

The first end-to-end run exposed a real conflict when browser and server exports updated render receipts before Original was restored: `timeline.lastRenderAssetId` blocked the pending edit. Timeline merging now separates derived render receipts from source edits and retains a receipt only when its normalized source matches the merged document. A regression test checks both invalidation after a take change and retention for an unchanged source. This does not suppress conflicting edits to the same clip field.

The first mobile capture also showed the dialog title/Close scrolling out of view. Runs now scrolls its body under a fixed heading. Bounding-box checks then caught SEED's default negative margin clipping the Close hit area by 2px; the shared wrapper clears that margin. Evidence and earlier failures remain under `research/evidence/harness-takes/`.

Final verification passed 484 source tests, TypeScript, production build and all 12 browser tests. The new browser flow applies the lime fixture only to the opening two-second scene, leaves the coral closing scene unchanged, reloads the active take, exports through both the browser and server, restores Original, then replays the old import and reloads again without reactivation or duplication. Decoded RGB samples at 0.5s/2.5s were `[151,237,47]`/`[231,67,83]` for browser export and `[151,237,49]`/`[232,68,84]` for server export. These are procedural color fixtures, not model-generated imagery or model-quality evidence. This end-to-end pixel check covers image takes; audio/video take contracts are covered by integration tests, not a new perceptual-quality benchmark.

Actual desktop 1440×1000 and mobile 390×844 captures passed the fixed visual rubric at 4.315/5 after an initial 3.655/5 with the hidden Close hard failure. This is an internal visual assessment, not user acceptance. Existing development React state-update warnings remain; the new browser scenario recorded no uncaught page errors. Provider/model quality, long/4K timelines and the broader feature-parity gates remain open.

## Portable local recipe library

Runs now imports/pastes recipe JSON, inspects structure and bindings offline, installs an immutable local copy, duplicates with a new ID while retaining attribution, and exports portable JSON. HTTP and the 34-tool MCP catalog share the same library. Six source tests cover no-write inspection, persistence and compilation, canonical identical replay, stale-digest and changed-ID rejection, file-catalog preservation, invalid defaults/graphs/pointers/size, unknown-adapter execution rejection, competing installs from separate Node processes, the 200-recipe limit and database-symlink rejection.

All 490 source tests, TypeScript and production build passed. All 14 browser tests passed, then the three affected library/focus tests passed again after the final review-scrolling change. Browser evidence covers file import, attribution review, exact JSON export, installation visible in HTTP and MCP, an identical MCP replay, reload persistence, fork identity/attribution, invalidation after editing and no run creation. HTTP checks reject untrusted/cross-origin, oversized and changed-after-review requests. Existing development React state-update warnings remain; the new scenario and the live native-server exercise recorded no uncaught page errors.

A real local-server exercise installed `atelier-color-study` through the UI without modifying application source or the file catalog. Native history contained four jobs before inspection/installation and still four afterward. Only a separate Queue action submitted its EmptyImage/SaveImage workflow. Both native execution and materialization succeeded; the resulting PNG is 640×360 RGB, 1,720 bytes, center pixel `[202,255,81]`, SHA-256 `2da03beaa286f3cd0feac3222d63328a9f64a1da8958ed477dde0a244877a64c`. It was added to a three-second timeline clip and remained visible after reload. This is an actual model-free ComfyUI workflow, not a model-quality or paid-generation comparison.

Evidence is retained in `research/evidence/recipe-library/`: test/build logs, imported manifest, native receipt/local asset record, decoded output and desktop/mobile screenshots. The first review left some inspection content below the visible area despite a visible sticky Install action; after bringing completed inspections into view, the fixed rubric improved from 3.69 to 4.353/5 at 1440×1000 and 390×844. Final geometry checks place the whole inspection panel above Install at both sizes. This internal assessment is not user design acceptance. The library does not yet provide in-place version history, removal UI, a graphical workflow authoring canvas, signatures, remote publication or automatic adapter installation; full extensibility/collaboration parity remains open.

## Quality and speed protocol

Before claiming parity, freeze a test suite covering at least image generation/edit, image-to-video, multi-shot character continuity, motion/object transfer, reference edit reconstruction, masks/layers, captions, music/voice and export. Use the same available model/version, prompt, references, seed, duration, resolution and retry policy in both products wherever possible. Record where provider contracts differ.

Retain all attempts, provider receipts, full wall times, costs, failure types, output hashes, accepted revisions and final exports. Measure orchestration overhead separately from provider generation time. Compare p50/p95 only after enough repeated runs; one successful short export proves neither editor throughput nor generation quality. For subjective quality, use blinded pairwise review with prompt adherence, identity, motion continuity, typography, pacing and audio alignment scored separately. Record ties and failures.

Release gates include real provider artifact localization, crash recovery at every persistence boundary, visual review at fixed sizes, long/4K/multi-track playback tests, A/V drift measurement and a clean-checkout install. The clean-checkout install/build gate passed; the remaining release gates stay open until actual evidence is attached.

Browser motion demo export also decoded to 90 video frames (3.000s) and AAC audio (3.072s). The 72ms container/audio tail is recorded as a remaining browser-export alignment issue; no exact audio-duration parity is claimed. Server export of the motion/caption fixture has matching 3.000s streams.

The first clean-checkout attempt exposed a documentation error: `pnpm setup` invokes pnpm’s own shell setup instead of the package script. Use the explicit `pnpm run setup` shown in the corrected README. The corrected command installed dependencies and initialized the SQLite schema before a successful build.
