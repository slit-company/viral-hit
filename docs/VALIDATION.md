# Validation ledger — 2026-10-19

Local machine: macOS arm64, Node 24.19.0, pnpm 10.32.1. Source tests and browser tests run against this checkout. Raw logs and captures are local ignored evidence under `research/evidence/` and `apps/studio/test-results/`.

| Check | Result | Limit |
|---|---|---|
| Production build | Passed | Local build; not public deployment |
| TypeScript and translation key check | Passed | New Runs panel currently English only |
| Unit/integration tests | 445 passed | Includes 28 new harness/Router/recipe contract tests; SDK tests use fixtures |
| Browser E2E | 6 passed | Local Chromium; provider credentials deliberately removed |
| Shared UI/MCP editing | Passed | Canvas drag alongside MCP prompt revision; no lost prompt change; persisted after reload |
| Imported image → timeline → MP4 download | Passed | Actual H.264 1920×1080, 30 fps, 60 decoded frames, 2.000 s, 46,381 bytes; still-image fixture, not a video quality benchmark |
| Captions | Passed | Remote edit visible without reload, local text edit persisted; desktop/mobile captures |
| Runs HTTP/UI | Passed | Schema, trust header, missing run and missing-key UI; no paid submission |
| Worker recovery | Passed in deterministic tests | Restart, same-key replay, uncertain outcome, lease fencing, dependency invalidation and cancellation races; not an actual provider outage test |
| Video/audio/caption server render | Passed | Original 3s motion split into two shots, rendered through MCP to project-owned H.264/AAC MP4: 1920×1080, 90 video frames, both streams 3.000s; requires full FFmpeg with drawtext |
| Visual feedback loop | Passed, 4.205/5 | Actual editor at 1440×1000; not a rating of generation quality |
| Extensible recipes | Passed | Separate manifest directory, dynamically rendered third-party form, MCP discovery, offline compile and persisted output binding/restart tests; no live generation |
| Recipe visual feedback | Passed, 4.15/5 | Fixed long-form action clipping after real desktop/mobile inspection |
| Actual Comfy generation | Not run | Server `COMFY_API_KEY` absent; no quality/latency/cost claim |
| Higgsfield comparative benchmark | Not run | Full feature/performance parity is not established |

Reproduce with `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm --dir apps/studio test:e2e`. E2E creates an isolated temporary database and calls the real local UI/MCP/FFmpeg tools without provider keys. `test-results/verified-local-export.mp4` is the actual browser export, not a fake fixture labeled as generated output.

## Quality and speed protocol

Before claiming parity, freeze a test suite covering at least image generation/edit, image-to-video, multi-shot character continuity, motion/object transfer, reference edit reconstruction, masks/layers, captions, music/voice and export. Use the same available model/version, prompt, references, seed, duration, resolution and retry policy in both products wherever possible. Record where provider contracts differ.

Retain all attempts, provider receipts, full wall times, costs, failure types, output hashes, accepted revisions and final exports. Measure orchestration overhead separately from provider generation time. Compare p50/p95 only after enough repeated runs; one successful short export proves neither editor throughput nor generation quality. For subjective quality, use blinded pairwise review with prompt adherence, identity, motion continuity, typography, pacing and audio alignment scored separately. Record ties and failures.

Release gates include real provider artifact localization, crash recovery at every persistence boundary, visual review at fixed sizes, long/4K/multi-track playback tests, A/V drift measurement and a clean-checkout install. These remain open until actual evidence is attached.

Browser motion demo export also decoded to 90 video frames (3.000s) and AAC audio (3.072s). The 72ms container/audio tail is recorded as a remaining browser-export alignment issue; no exact audio-duration parity is claimed. Server export of the motion/caption fixture has matching 3.000s streams.
