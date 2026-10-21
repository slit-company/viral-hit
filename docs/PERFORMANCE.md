# Performance rules and measured scope

Optional generators/renderers execute outside the browser and start only for work. Normal studio setup does not install music2, vid2, ima2 or Bun. This extension changes no studio runtime dependency, frontend source or production build artifact.

Run `pnpm performance:check` after a build. It refuses those packages in the studio manifest and enforces [the budget](performance-budget.json): **10,000,000 bytes** of public files and **600,000 bytes** for all JavaScript files individually gzip-compressed. The cumulative-chunk metric includes lazy routes; it is not initial page transfer or the server's compression policy. The manifest check does not inspect arbitrary package internals. Investigate a regression before increasing the budget; moving heavy runtimes into the default install requires an architectural decision.

Local macOS arm64 production build, Node 24.19.0, 2026-10-19:

| Measurement | Result | Conditions |
|---|---|---|
| Public files, logical bytes | 8,393,761 | 173 files including fonts/branding; allocated disk usage differs |
| All client JS, raw / individually gzipped | 1,832,755 / 535,985 bytes | Same production build before/after optional installation |
| Optional runtime disk usage | About 125 MiB | music2, vid2, Bun and esbuild development dependency; separate from studio |
| Idle app processes | 219.5 MiB aggregate RSS; zero engine processes | One snapshot of production launcher/server/worker with both adapters enabled; browser excluded |
| Music render → asset registration | 770 ms | One 4s three-track score, 48kHz stereo 16-bit PCM, 768,044 bytes |
| Motion render → asset registration | 1,473 ms | One 4s 640×360/30fps title, 120 frames, 29,113 bytes |
| Music / motion observed descendant RSS peak | 164.6 / 235.8 MiB | Aggregate child RSS sampled every 100ms; excludes studio/browser; not exact peak/cap |
| Editor route readiness, p50 / p95 | 126 / 137 ms | Five local navigations, warm server/OS, fresh Chromium contexts, Runs button visible |
| Runs form visibility after click, p50 / p95 | 105 / 128 ms | Same five samples, 1440×1000; not scrub/edit latency |
| Mixed editor export | 4.000s video/audio | H.264/AAC, 120 decoded video frames; full decoder check passed |

Ignored evidence: `research/evidence/local-media/footprint.json`, `navigation.json`, `idle.json`, `run-QEeF5G/result.json`. Render timings are single small fixtures, not percentiles. Full install time, cold startup, sustained idle/browser memory, long scores, 1080p/4K projects, dropped frames, scrub/edit latency and model cost/quality still need fixed-dataset measurement. No Higgsfield comparison has run.

Authoring size, duration, deadlines and accepted output are bounded; video segments serialize. This does not establish that every accepted document is cheap. Add streaming/project-media bindings and a persistent background-render protocol before substantially larger jobs. Compare generation using identical providers/models/settings and retain failures/cost; orchestration alone does not prove model superiority.

## Retained publication media — 2026-10-20

The publishing storage path adds no runtime package or browser import. Preparation streams full SHA-256 verification with a reusable 8 MiB buffer; range reads use an output buffer up to 8 MiB plus one verification block. Block hashes are individually indexed in SQLite, so an upload step does not load/parse the complete hash list of a large export. A retained copy and temporary preparation file consume local disk; cleanup/quotas remain open.

Two fresh Node 24.19.0 processes on the local macOS host measured synthetic bytes through retention and complete range reads, after removing each source. Each also checked an unaligned 8 MiB range. Memory was sampled every 5 ms plus operation boundaries, following an explicit GC before baseline. These are single observations, not an exact peak, enforced process limit or repeatable throughput benchmark; the 1 GiB run overlapped source validation in another process.

| Fixture size | Prepare / complete sequential reads | Sampled RSS increase over baseline | Sampled peak ArrayBuffer bytes |
|---|---|---|---|
| 256 MiB + 137 bytes | 299 / 253 ms | 64.8 MiB | 67,254,627 |
| 1 GiB + 137 bytes | 1,228 / 1,008 ms | 56.9 MiB | 67,254,627 |

Both received full hashes matched their sources. Garbage-collection timing and sampling can make larger-file RSS observations lower rather than monotonically greater. Reports: `research/evidence/publishing/media-256/report.json` and `media-1024/report.json`. Reproduce with the script in [retained media](PUBLICATION-MEDIA.md). This excludes network/OAuth/provider processing, rendering, UI/browser memory and the cost of initially importing an export into the project library. No end-to-end publishing or Higgsfield performance comparison is implied.

### Reference recipes and result previews

After reference workflow UI/HTTP/MCP integration, the production public build contains 173 files totaling 8,396,833 bytes. JavaScript totals 1,835,764 bytes raw and 536,671 bytes gzip, an increase of 686 gzip bytes over the prior intake-only build. The existing 10 MB public-assets / 600 KB gzip-JS gates pass. .NET/YoutubeExplode remain separately installed; no new default studio dependency was added.

The new frame selector inspects bounded timestamp windows with ffprobe (2 MiB response cap per sample) before extraction, rather than assuming a fractional duration always identifies an existing frame. Individual probes and extractions retain their 15-second limits; the complete reference operation has a four-minute execution budget and a five-minute lease. These are cancellation/recovery bounds, not measured p95 latency or total-host resource quotas.


## Browser account connections — 2026-10-20

The account page adds no runtime package. The production public output contains 177 files and 8,407,661 bytes; JavaScript totals 1,845,842 raw bytes and 541,210 summed gzip bytes, an increase of 4,539 gzip bytes from the preceding reference-recipes build. The route is a separate lazy page. OAuth, hashing, credential storage and the account database remain outside browser imports. This is a bundle observation, not a publishing throughput or app-wide memory benchmark. Account management opens/closes the existing SQLite/vault service per request and uses the existing bounded OAuth network operations.


## Editable image motion — 2026-10-20

Production public assets: 180 files / 8,472,832 bytes; JavaScript 1,909,899 raw bytes / 559,829 summed gzip bytes, +3,237 gzip bytes over the preceding editable-sequence build. Existing 10 MB asset / 600 KB gzip-JS gates pass. No runtime package was added. The contract bounds each overlay to 32 keyframes and server rotation rejects working canvases above 64 megapixels. Constant opacity uses a static filter; varying opacity/fades use FFmpeg expressions. These bounds are not a measured host memory limit, timeline throughput result, or competitor performance comparison. Real browser/server export frames are covered in the [validation ledger](VALIDATION.md).


## Browser storyboards and media ZIP downloads — 2026-10-21

The production build contains **204 files / 8,538,279 public bytes**, with **1,971,150 raw JavaScript bytes / 582,295 summed gzip bytes**. This is 17,454 fewer gzip bytes than the preceding 599,749-byte build, including the new storyboard route. The unchanged 10 MB public-assets and 600 KB summed gzip-JS budgets pass. These totals cover every generated browser script, not a measurement of first-page transfer.

Canvas bulk downloads now use a small ZIP32/STORE writer for already-compressed media. It computes CRCs through Blob streams, checks the complete archive layout before reading bytes, and rejects ZIP32 overflow. It does not add compression or support ZIP64. JSZip remains installed for server packaging and independent reader tests but is no longer imported by the Canvas download path. No default dependency changed. This is a verified bundle-size reduction and byte-integrity result, not a measured browser-memory improvement, large-project latency result or model/Higgsfield performance comparison.


## Portable storyboard review — 2026-10-21

Adding project-file storyboard transfer and downloadable recipe requirements yields **204 public files / 8,539,278 bytes**, **1,972,149 raw JavaScript bytes / 582,647 summed gzip bytes**. The gzip increase is **352 bytes** over browser storyboard authoring. Existing 10 MB/600 KB gates pass; no dependency, worker or poller was added. Media packaging retains its existing streaming/size bounds. The existing 5 MiB manifest now also bounds board and recipe metadata; individual board and recipe limits are 256 KB and 128 KB. Retained bundle files and unactivated metadata are not automatically collected. These are bundle observations and limits, not a measured large-project memory/latency or competitor comparison.

## Local visual-cut analysis — 2026-10-21

Final public build: **204 files / 8,544,046 bytes**, **1,976,611 raw JavaScript bytes / 583,828 summed gzip bytes**. The increase is **1,181 gzip bytes** over portable storyboard review, within the unchanged 10 MB/600 KB gates. No package, worker or background poller was added. The new browser result uses the existing shared controls and one native video player, with at most 64 range buttons.

The worker copies at most 64 MiB, verifies hashes through the existing file path and scans at most ten minutes of video. FFmpeg uses one decoding thread, one filter thread, a 320×320 analysis frame bound and 8 fps sampling. Decoding still processes source frames; these controls do not eliminate source-resolution cost. The scan's combined captured diagnostics are capped at 1 MiB and its deadline is 180 seconds. Abort/timeout waits for process closure, with SIGKILL escalation after five seconds. Tool version probes have separate five-second/64 KiB bounds. The adapter keeps the existing four-minute execution/five-minute lease policy.

These are explicit workload/output/deadline bounds, not a measured whole-process memory cap, p95 scan rate or competitor comparison. Real small-fixture scans and browser/server exports passed; representative high-resolution, long-video accuracy and performance measurements remain open.

## Optional speech recognition — 2026-10-21

The transcript UI adds no studio runtime package. The final production build contains 204 public files (8,549,271 bytes) and 584,986 bytes of individually gzipped JavaScript, within the existing 10 MB/600 KB limits. The optional whisper.cpp CLI/model are external; inspecting/discovering the extension starts no model service.

The exercised multilingual tiny model is 77,691,713 bytes. A 3.876-second English source completed the production worker in 2,190 ms; an earlier direct run took 13,680 ms. A separate 4.953-second Korean audio invocation took 1,198 ms. These single observations are not labeled cold/warm samples or a model-quality/performance comparison. CPU threads are bounded to 1–4 (default 2), GPU is disabled, and decoded PCM is capped at 4 MiB/120 seconds. Larger optional model files can still require considerable RAM; no process RSS cap or complete host-footprint benchmark is claimed.

## Reference-to-storyboard preparation — 2026-10-21

This handoff adds no runtime dependency, model service or poller. The final production build contains 204 public files totaling 8,554,211 bytes; cumulative individually gzipped client JavaScript is 586,345 bytes (1,359 bytes above the transcript build). Both existing budgets pass. Discovery returns at most 100 recent analysis summaries with an omitted count; preparation verifies one original video and uses selected receipt JSON. Source verification is streamed through the existing media boundary and does not decode a second analysis. This is not a complete long-history or large-project latency benchmark.

## Independent analysis models — 2026-10-22

Final public build: **204 files / 8,556,038 bytes**, **1,988,094 raw JavaScript bytes / 586,862 individually gzipped JavaScript bytes**. The gzip increase is **517 bytes** over the reference-to-storyboard build. Existing 10 MB/600 KB gates pass. Discovery reuses the existing cached model request; analysis reuses the existing generation poller. No new default runtime package, daemon or periodic discovery was introduced.

The optional technical inspector streams at most 64 MiB into a private temporary file, caps FFprobe output at 1 MiB, and has a two-minute signal plus a twenty-second subprocess deadline. FFprobe is separately installed. These limits and the successful small-media test do not establish a whole-host RAM cap, representative latency, semantic model quality or superiority to Higgsfield. Private/local media still needs the existing managed-upload path for model providers.

## Local input delivery to installed providers — 2026-10-22

The final public bundle remains **204 files / 8,556,038 bytes**, **1,988,094 raw JavaScript bytes / 586,862 summed gzip bytes**, with no increase over independent analysis. No default dependency, service or poller was added. Existing 10 MB/600 KB gates pass.

Project-media preflight now verifies content with a reusable 64 KiB buffer. A module reads only requested verified copies: 64 MiB per input, 256 MiB across at most 20 unique references, and 256 MiB cumulative returned bytes per create call. These are interface bounds, not whole-process RAM measurements. Revalidation deliberately rereads sources before invocation and on each read. Async providers must retain necessary inputs before returning a task ID. The inspector makes a temporary copy for FFprobe and restricts demuxing to local file/pipe protocols and supported video containers. Actual small-media processing and restart persistence passed; large-project throughput and representative model performance remain unmeasured. This supersedes the preceding limitation that all local model-provider inputs need managed uploads.
