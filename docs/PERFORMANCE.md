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

Authoring size, duration, deadlines and accepted output are bounded; video segments serialize. Add streaming/project-media bindings and a persistent background-render protocol before substantially larger jobs.

## Retained publication media — 2026-10-20

The publishing storage path adds no runtime package or browser import. Preparation streams full SHA-256 verification with a reusable 8 MiB buffer; range reads use an output buffer up to 8 MiB plus one verification block. Block hashes are individually indexed in SQLite, so an upload step does not load/parse the complete hash list of a large export.

Two fresh Node 24.19.0 processes on the local macOS host measured synthetic bytes through retention and complete range reads, after removing each source. Each also checked an unaligned 8 MiB range. Memory was sampled every 5 ms plus operation boundaries, following an explicit GC before baseline.

| Fixture size | Prepare / complete sequential reads | Sampled RSS increase over baseline | Sampled peak ArrayBuffer bytes |
|---|---|---|---|
| 256 MiB + 137 bytes | 299 / 253 ms | 64.8 MiB | 67,254,627 |
| 1 GiB + 137 bytes | 1,228 / 1,008 ms | 56.9 MiB | 67,254,627 |

Both received full hashes matched their sources. Garbage-collection timing and sampling can make larger-file RSS observations lower rather than monotonically greater. Reports: `research/evidence/publishing/media-256/report.json` and `media-1024/report.json`. Reproduce with the script in [retained media](PUBLICATION-MEDIA.md). This excludes network/OAuth/provider processing, rendering, UI/browser memory and the cost of initially importing an export into the project library. No end-to-end publishing or Higgsfield performance comparison is implied.

### Reference recipes and result previews

After reference workflow UI/HTTP/MCP integration, the production public build contains 173 files totaling 8,396,833 bytes. JavaScript totals 1,835,764 bytes raw and 536,671 bytes gzip, an increase of 686 gzip bytes over the prior intake-only build.

The new frame selector inspects bounded timestamp windows with ffprobe (2 MiB response cap per sample) before extraction, rather than assuming a fractional duration always identifies an existing frame. Individual probes and extractions retain their 15-second limits; the complete reference operation has a four-minute execution budget and a five-minute lease.

## Browser account connections — 2026-10-20

The account page adds no runtime package. The production public output contains 177 files and 8,407,661 bytes; JavaScript totals 1,845,842 raw bytes and 541,210 summed gzip bytes, an increase of 4,539 gzip bytes from the preceding reference-recipes build. The route is a separate lazy page. OAuth, hashing, credential storage and the account database remain outside browser imports. Account management opens/closes the existing SQLite/vault service per request and uses the existing bounded OAuth network operations.

## Editable image motion — 2026-10-20

Production public assets: 180 files / 8,472,832 bytes; JavaScript 1,909,899 raw bytes / 559,829 summed gzip bytes, +3,237 gzip bytes over the preceding editable-sequence build. Existing 10 MB asset / 600 KB gzip-JS gates pass. No runtime package was added. The contract bounds each overlay to 32 keyframes and server rotation rejects working canvases above 64 megapixels. Constant opacity uses a static filter; varying opacity/fades use FFmpeg expressions. These bounds are not a measured host memory limit, timeline throughput result, or competitor performance comparison. Real browser/server export frames are covered in the [validation ledger](VALIDATION.md).

## Browser storyboards and media ZIP downloads — 2026-10-21

The production build contains **204 files / 8,538,279 public bytes**, with **1,971,150 raw JavaScript bytes / 582,295 summed gzip bytes**. This is 17,454 fewer gzip bytes than the preceding 599,749-byte build, including the new storyboard route. The unchanged 10 MB public-assets and 600 KB summed gzip-JS budgets pass. These totals cover every generated browser script, not a measurement of first-page transfer.

Canvas bulk downloads now use a small ZIP32/STORE writer for already-compressed media. It computes CRCs through Blob streams, checks the complete archive layout before reading bytes, and rejects ZIP32 overflow. JSZip remains installed for server packaging and independent reader tests but is no longer imported by the Canvas download path. No default dependency changed.

## Portable storyboard review — 2026-10-21

Adding project-file storyboard transfer and downloadable recipe requirements yields **204 public files / 8,539,278 bytes**, **1,972,149 raw JavaScript bytes / 582,647 summed gzip bytes**. The gzip increase is **352 bytes** over browser storyboard authoring. Existing 10 MB/600 KB gates pass; no dependency, worker or poller was added. Media packaging retains its existing streaming/size bounds. The existing 5 MiB manifest now also bounds board and recipe metadata; individual board and recipe limits are 256 KB and 128 KB.

## Local visual-cut analysis — 2026-10-21

Final public build: **204 files / 8,544,046 bytes**, **1,976,611 raw JavaScript bytes / 583,828 summed gzip bytes**. The increase is **1,181 gzip bytes** over portable storyboard review, within the unchanged 10 MB/600 KB gates. No package, worker or background poller was added. The new browser result uses the existing shared controls and one native video player, with at most 64 range buttons.

The worker copies at most 64 MiB, verifies hashes through the existing file path and scans at most ten minutes of video. FFmpeg uses one decoding thread, one filter thread, a 320×320 analysis frame bound and 8 fps sampling. Decoding still processes source frames; these controls do not eliminate source-resolution cost. The scan's combined captured diagnostics are capped at 1 MiB and its deadline is 180 seconds. Abort/timeout waits for process closure, with SIGKILL escalation after five seconds. Tool version probes have separate five-second/64 KiB bounds. The adapter keeps the existing four-minute execution/five-minute lease policy.

## Optional speech recognition — 2026-10-21

The transcript UI adds no studio runtime package. The final production build contains 204 public files (8,549,271 bytes) and 584,986 bytes of individually gzipped JavaScript, within the existing 10 MB/600 KB limits. The optional whisper.cpp CLI/model are external; inspecting/discovering the extension starts no model service.

The exercised multilingual tiny model is 77,691,713 bytes. A 3.876-second English source completed the production worker in 2,190 ms; an earlier direct run took 13,680 ms. A separate 4.953-second Korean audio invocation took 1,198 ms. These single observations are not labeled cold/warm samples or a model-quality/performance comparison. CPU threads are bounded to 1–4 (default 2), GPU is disabled, and decoded PCM is capped at 4 MiB/120 seconds. Larger optional model files can still require considerable RAM; no process RSS cap or complete host-footprint benchmark is claimed.

## Reference-to-storyboard preparation — 2026-10-21

This handoff adds no runtime dependency, model service or poller. The final production build contains 204 public files totaling 8,554,211 bytes; cumulative individually gzipped client JavaScript is 586,345 bytes (1,359 bytes above the transcript build). Both existing budgets pass. Discovery returns at most 100 recent analysis summaries with an omitted count; preparation verifies one original video and uses selected receipt JSON. Source verification is streamed through the existing media boundary and does not decode a second analysis.

## Independent analysis models — 2026-10-22

Final public build: **204 files / 8,556,038 bytes**, **1,988,094 raw JavaScript bytes / 586,862 individually gzipped JavaScript bytes**. The gzip increase is **517 bytes** over the reference-to-storyboard build. Existing 10 MB/600 KB gates pass. Discovery reuses the existing cached model request; analysis reuses the existing generation poller. No new default runtime package, daemon or periodic discovery was introduced.

The optional technical inspector streams at most 64 MiB into a private temporary file, caps FFprobe output at 1 MiB, and has a two-minute signal plus a twenty-second subprocess deadline. FFprobe is separately installed.

## Local input delivery to installed providers — 2026-10-22

The final public bundle remains **204 files / 8,556,038 bytes**, **1,988,094 raw JavaScript bytes / 586,862 summed gzip bytes**, with no increase over independent analysis. No default dependency, service or poller was added. Existing 10 MB/600 KB gates pass.

Project-media preflight now verifies content with a reusable 64 KiB buffer. A module reads only requested verified copies: 64 MiB per input, 256 MiB across at most 20 unique references, and 256 MiB cumulative returned bytes per create call. Revalidation deliberately rereads sources before invocation and on each read. Async providers must retain necessary inputs before returning a task ID. The inspector makes a temporary copy for FFprobe and restricts demuxing to local file/pipe protocols and supported video containers. Actual small-media processing and restart persistence passed; large-project throughput and representative model performance remain unmeasured. This supersedes the preceding limitation that all local model-provider inputs need managed uploads.

## Structured analysis handoff — 2026-10-22

Final build: **204 public files / 8,560,884 bytes**, **1,992,915 raw JavaScript bytes / 587,740 individually gzipped JavaScript bytes**. The increase is **878 gzip bytes** over local provider media; unchanged 10 MB/600 KB gates pass. No default dependency, model service, worker or background poller was added.

A report is bounded to 256 KB UTF-8 and 64 observations. Discovery examines at most 100 recent completed generations and discloses older candidates; preparation selects at most 16 observations and rejects a draft that cannot fit the existing storyboard storage bound. Source bytes are verified and probed only when preparing a draft. These bounds and bundle measurements are not a large-history latency, whole-process memory or competitor benchmark.

## Independent model controls — 2026-10-22

Final public build: **203 files / 8,566,568 bytes**, **1,998,504 raw JavaScript bytes / 589,365 individually gzipped JavaScript bytes**. The gzip increase is **1,625 bytes** over structured analysis; unchanged 10 MB/600 KB gates pass. Chunk count reflects bundler grouping and is not an initial-transfer measurement.

Controls reuse cached workspace metadata and existing generation/storage paths. No new dependency, inference runtime, worker or polling loop was added. Each model has at most 16 controls with primitive values, strings at most 4,000 characters and select lists at most 32 choices.

## Declared multimodal analysis — 2026-10-22

Final public build: **203 files / 8,571,292 bytes**, **2,003,228 raw JavaScript bytes / 590,925 individually gzipped JavaScript bytes**. Increase: **1,560 gzip bytes** over model controls. Both unchanged budgets pass. Model discovery and the new Canvas picker share the cached workspace metadata query; submission and polling use the existing generation ledger. No default runtime dependency, model service or background loop was added.

Declarations cap the sum of per-kind maxima at 20 and reject empty requests. Project-media delivery retains 64 MiB/file and 256 MiB total/cumulative-read bounds. The optional batch inspector reads/probes/deletes one temporary source at a time, with 1 MiB probe output, a twenty-second child timeout and a two-minute batch signal. Real small-file PNG/MP4/WAV processing and production restart passed; these are not whole-host memory, representative inference speed or competitor benchmarks.

## Studio independent analysis — 2026-10-22

Final public build: **203 files / 8,581,258 bytes**, **2,012,881 raw JavaScript bytes / 593,725 individually gzipped JavaScript bytes**. The gzip increase is **2,800 bytes** over declared multimodal analysis. Both unchanged budgets pass. No new default dependency, runtime, worker or background polling loop was added.

Studio reuses cached model metadata and queries the bounded project library only while the picker is open. It deduplicates up to 500 membership entries and displays at most 50 search matches, with at most 20 selected sources. Uploads run sequentially, validate the entire selection before writing and preserve successfully stored originals on a later failure. Source/history reuse sends existing asset IDs rather than repeating uploads. Browser scratch drafts validate a 128,000-character storage bound before parsing.

## Source-specific report version 2 — 2026-10-22

Final public build: **203 files / 8,581,660 bytes**, **2,013,283 raw JavaScript bytes / 593,892 individually gzipped JavaScript bytes**. Increase over Studio independent analysis: **167 gzip bytes**. Unchanged 10 MB/600 KB budgets pass. Source identities reuse the existing analysis/history and storyboard services; no default dependency, inference service, worker or poller was introduced.

Reports retain the 64-observation/256 KB bound and selection retains the 16-shot limit. Source mapping admits at most 20 pinned originals/256 MiB; each original is already capped at 64 MiB by provider media delivery. Preparation hashes/probes originals sequentially, including companions not selected as shots, to preserve report context. The optional inspector processes/deletes one temporary file at a time. Every explicit preparation rereads the originals; no added background scan or cache claims validity after source changes. Small real-file processing, project transfer and decoded MP4 export passed; large-workspace latency, whole-process memory and AI-quality/competitor comparisons remain unmeasured.

## Runtime package discovery — 2026-10-22

Final build: **203 public files / 8,585,012 bytes**, **2,016,635 raw JavaScript bytes / 594,790 individually gzipped JavaScript bytes**. Increase over source-specific reports: **898 gzip bytes**. Unchanged 10 MB/600 KB gates pass. The new form uses shared SEED controls; no default dependency, inference service, worker or background poller was introduced.

Runtime link downloads have a 12,000,000-byte limit and a 20-second deadline with caller cancellation. Public DNS/socket pinning and redirect validation reuse the streaming downloader. Raw-file hashing streams in 1 MiB chunks before bounded JSON parsing; temporary files are always cleaned up. Package normalization and existing 8 MB aggregate source/entry limits still apply. Discovery transfers metadata only; no runtime is fetched until explicit review.

## Independent audio generation — 2026-10-22

Final build: **203 public files / 8,591,337 bytes**, **2,022,882 raw JavaScript bytes / 596,046 individually gzipped JavaScript bytes**. Increase over runtime discovery: **1,256 gzip bytes**. The unchanged 10 MB/600 KB gates pass. Audio uses the existing cached model catalog, generation intents/history, polling and retained asset store. No default engine, dependency, daemon, migration or worker was added; model implementations remain optional.

Output storage caps each generated audio file at 64 MiB; the example caps duration at ten seconds and produces mono 24 kHz PCM16. Real WAV playback and a short mixed image/audio browser export passed. These bounds and short fixtures do not measure whole-host memory, sustained inference speed, long music tracks, high track counts or competitor performance.

## Audio reference delivery — 2026-10-22

Final build: **203 public files / 8,593,619 bytes**, **2,025,164 raw JavaScript bytes / 596,397 individually gzipped JavaScript bytes**. Increase over independent audio generation: **351 gzip bytes**. Both unchanged 10 MB/600 KB gates pass. Analysis/audio now reuse one source picker, upload/recovery hook and source identity helpers. No runtime dependency, model, migration, daemon or polling loop was added.

The optional audio-conform provider uses separately installed FFmpeg/FFprobe with existing 64 MiB/file and 256 MiB total/cumulative-read limits. Its example-specific limits are 0.1–30 seconds output, 60 seconds overall, 15 seconds/probe and 30 seconds/conversion, with 1 MiB logs. Short reference processing, native playback and browser export passed; long projects, simultaneous inference and competitor benchmarks remain unmeasured.

## Generation receipt inspection — 2026-10-22

Final public output is unchanged: **203 files / 8,593,619 bytes**, **2,025,164 raw JS / 596,397 summed gzip bytes**. Existing 10 MB/600 KB limits pass. Receipt binding and inspection use existing SQLite rows by project and primary-key identity; no new schema, default dependency, background service or poller is added. Inspection does not contact providers. This does not measure high-concurrency database throughput or external model costs.

## Installed-model recipes — 2026-10-22

Final build: **203 public files / 8,594,026 bytes**, **2,025,571 raw JavaScript bytes / 596,488 individually gzipped JavaScript bytes**. Increase over generation receipt inspection: **91 gzip bytes**. Existing 10 MB/600 KB limits pass. There is no new dependency, migration, queue or daemon. The existing sequential worker uses the existing intent/history stores and disables submission's extra background polling timer for its own generations.

Inputs stream through existing 64 KiB hash buffers with 64 MiB per reference and 256 MiB total limits. Completed generation assets are verified/probed and reused directly, without a second materializer copy. The four-step local proof retained three unique media assets and exported a one-second image/audio timeline. This does not measure whole-host RSS, large model inference, long-project latency, concurrency throughput or competitor performance. Installed code is trusted and cooperative deadlines cannot forcibly stop a module that ignores its signal.

## Visual model reference declarations — 2026-10-22

Final build: **203 public files / 8,596,577 bytes**, **2,028,171 raw JavaScript bytes / 597,047 individually gzipped JavaScript bytes**. Increase over installed-model recipes: **559 gzip bytes**. The unchanged 10 MB/600 KB gates pass. Source selection reuses the existing picker, upload fencing, project asset store and generation ledger; no default runtime dependency, queue or worker is added.

New declarations allow at most 20 references in total and retain existing local reader bounds (64 MiB each, 256 MiB total/cumulative read). The optional visual-conform processor caps output at 320 pixels on the longest side, ten seconds of video, two FFmpeg threads, 60 seconds overall and bounded probe/conversion processes. Real short media/export passed; these caps and bundle measurements are not whole-host RSS, inference cost, long-project latency or competitor benchmarks.

## Installed-model recipe authoring — 2026-10-22

The final production build has **203 public files / 8,604,730 bytes** and **2,036,324 raw JavaScript / 598,918 summed gzip bytes**, an increase of **1,871 gzip bytes** over mixed visual reference support. The unchanged 10 MB/600 KB gates pass. UI browser imports are type-only at the server contract boundary. No default dependency, database, queue or background loop was added; discovery reads the existing bounded installed metadata snapshot, and builds are limited to 20 source slots and 128 KB recipe JSON. Real execution uses the existing source/worker bounds.

## Installed-model requirements — 2026-10-22

The final production build contains **203 public files / 8,605,280 bytes** and **2,037,049 raw JavaScript / 599,183 summed gzip bytes**: **265 gzip bytes** above model recipe authoring. The unchanged 10 MB/600 KB budgets pass. Model metadata is indexed once per inspection; the report does not load project media or import executable provider modules. Shared result rendering replaces the prior inline native-only report. No dependency, database schema, worker or polling loop was added.

## Typed upstream model controls — 2026-10-22

Production output remains **203 public files / 8,605,280 bytes**, **2,037,049 raw JavaScript / 599,183 summed gzip bytes**: no browser bundle increase. The unchanged 10 MB/600 KB gates pass. Placeholder preparation is bounded by existing recipe/model metadata limits and runs in the server admission/inspection path. No dependency, migration, execution queue, background service or inference model was added. The optional measured-calibration recipe reuses FFprobe and the existing short procedural tone provider. Actual two-second production media/export and restart passed; this is not a whole-host memory, concurrency, long-project or competitor benchmark.

## Video overlays — 2026-10-22

Final output: **203 public files / 8,607,684 bytes**, **2,039,453 raw JavaScript / 599,831 summed gzip bytes**. This adds **648 gzip bytes** and passes the unchanged 10 MB/600 KB budgets. There is no new dependency, schema migration, model, worker or polling service. Only currently visible overlay videos mount a native preview decoder; export uses the existing media decoders and FFmpeg filter graph. Tests cover a short moving inset with audio and both real export paths. High layer counts, long sources, whole-host RSS and competitor throughput remain unmeasured.

## Video color agreement — 2026-10-23

Final output: **203 public files / 8,608,399 bytes**, **2,040,168 raw JavaScript / 600,037 summed gzip bytes**, **206 gzip bytes** more than video overlays. The script budget changed from 600,000 to **601,000** gzip bytes in this reviewed decision. The added bytes are the H.264 color-tag parser and decoder color configuration in the lazily loaded media chunk, which is fetched only for local media inspection and browser export; initial route chunks are unchanged. Before changing the budget we checked for removable code of comparable size: every bundled container format backs an editor import field, query devtools are excluded from production, and smaller patch variants measured 600,064–600,078 bytes. Upgrading Mediabunny to 1.62.0 instead measured 658,749 gzip bytes and still interpreted untagged H.264 differently from FFmpeg. No dependency, worker or service was added.

## Masked edits — 2026-10-23

Summed script gzip: **602,096 bytes**, **2,059 bytes** more than the color patch. The script budget changed from 601,000 to **603,000** in this reviewed decision. The added code is the Studio mask painter, its canvas helpers and the browser mask rules, in the Studio route chunk; other routes' first load is unchanged. Phosphor icons appeared as a possible saving but are used only by the reused SEED dialog and back button, so they stay to keep those components faithful. No dependency, worker or service was added.

## Home as Explore — 2026-10-23

Summed script gzip: **606,691 bytes**, **4,595 bytes** more than masked edits; public files **8,903,281 bytes**. The script budget changed from 603,000 to **607,000** in this reviewed decision. The increase is the tool bento, template gallery, recipe link handling and 31 new home messages in three languages; seven unused home messages and three duplicates were removed first. Thirteen cover images add 236 KB of WebP, loaded lazily below the fold. No dependency, worker or service was added.

## Workspace sidebar — 2026-10-23

Summed script gzip: **608,656 bytes**, **1,965 bytes** more than the explore home. The script budget changed from 607,000 to **610,000** in this reviewed decision: the sidebar component and its 16 messages in three languages. The sidebar reuses the existing project list request with a 30 second cache; no dependency or service was added.

## Studio results grid — 2026-10-23

Summed script gzip: **608,985 bytes**, 329 bytes more than the sidebar and within the unchanged 610,000 budget.

## Project search — 2026-10-23

Summed script gzip: **610,824 bytes**, **1,839 bytes** more than the results grid. The script budget changed from 610,000 to **612,000** in this reviewed decision: project search and sort controls, paging and six messages in three languages. Search runs in SQLite on the existing project table; no index, dependency or service was added.

## Creative performance readings — 2026-10-23

Summed script gzip: **613,977 bytes**, **2,576 bytes** more than source roles. The script budget changed from 612,000 to **614,000** in this reviewed decision. The added code is the Performance section, its manual entry dialog and number formatting in the publishing route chunk; other routes' first load is unchanged and the dialog, input and action components were already shared. Readings run only when someone asks for one, through the existing publication runtime. There is no background poller, new dependency, worker or service; observations go to one append-only SQLite file beside publications.

## Editor transitions — 2026-11-02

Summed script gzip: **728,029 bytes**, **5,220 bytes** more than the Cinema/worker build; public files **9,203,088 bytes**. The script budget changed from 725,000 to **729,000** in this reviewed decision. The added code is the transition contract, canvas compositor, preview layers and inspector in the editor route chunk, plus 21 messages in four languages; kind labels use literal message keys so unused messages stay out. No dependency, worker or service was added; server export reuses FFmpeg `xfade`.

## Spoken-word captions — 2026-11-02

Summed script gzip: **731,790 bytes**, **3,761 bytes** more than editor transitions; public files **9,213,805 bytes**. The script budget changed from 729,000 to **732,000** in this reviewed decision. The added code is the caption tokenizer, re-timing and cue grouping (applied in the browser by the shared editor commands), the canvas highlight path, preview text, the highlight picker and eight messages in four languages. Moving caption drawing out of the media exporter brought that module and the server renderer under 400 lines. No dependency, worker or service was added; the server export uses FFmpeg's libass filter.

## Cinema sequences — 2026-11-02

Summed script gzip: **735,115 bytes**, **3,325 bytes** more than spoken-word captions; public files **9,226,529 bytes**. The script budget changed from 732,000 to **736,000** in this reviewed decision: the sequence strip and banner, shot actions (continue, edit, render again) and 15 messages in four languages, all in the Cinema route chunk. Sequence placement is one small table in the existing harness database; no dependency, worker or service was added.

## Service credits — 2026-11-02

Summed script gzip: **735,995 bytes**, **880 bytes** more than Cinema sequences and within the unchanged 736,000 budget; public files **9,228,879 bytes**. The added code is the balance line and actions on the Connections page. Balance checks run on the server; no dependency, worker or service was added.

## Continuous playback — 2026-11-02

Summed script gzip: **736,392 bytes**, **397 bytes** more than service credits; public files **9,230,188 bytes**. The script budget changed from 736,000 to **737,000** in this reviewed decision: the playback clock hook in the editor route chunk and one message in four languages. The clock replaced the per-clip image ticker; no dependency or service was added.

## Captions from voice — 2026-11-02

Summed script gzip: **737,198 bytes**, **806 bytes** more than continuous playback; public files **9,232,478 bytes**. The script budget changed from 737,000 to **738,000** in this reviewed decision: the voice caption action, its timeline mapping, the orphan rule in cue grouping and two messages in four languages, in the editor route chunk. Speech timing is read on the server from the existing generation record; no dependency or service was added.

## Remix — 2026-11-02

Summed script gzip: **743,115 bytes**, **5,917 bytes** more than captions from voice; public files **9,250,604 bytes**. The script budget changed from 738,000 to **744,000** in this reviewed decision: the new Remix route (asset picker, rhythm and shot list) and 20 messages in four languages. Detection reuses the existing scene detector and worker; soundtrack extraction runs FFmpeg on the server. No dependency or service was added.

## Layer export — 2026-11-02

Summed script gzip: **743,969 bytes**, **854 bytes** more than Remix; public files **9,252,899 bytes**, within the unchanged 744,000-byte budget. The browser gains one toolbar button and three messages in four languages; it reuses the existing layers icon, and a spinner replaces a busy label. Rendering runs FFmpeg on the server, and the ZIP uses JSZip, which the server already depended on. No dependency or service was added.

## Agent memory and approvals — 2026-11-02

Summed script gzip: **751,599 bytes**, **7,630 bytes** more than layer export; public files **9,277,200 bytes**. The script budget changed from 744,000 to **752,000** in this reviewed decision: the new Agent route (3.15 KB gzip for the mode switch, approval cards and memory list), 41 messages in four languages in the shared message chunk, and the header badge that polls the waiting count every 15 seconds. Approvals and memory are stored in the existing harness database. No dependency or service was added.

## Canvas branches and runs — 2026-11-03

Summed script gzip: **755,964 bytes**, **3,966 bytes** more than the ComfyUI canvas import (751,998); public files **9,288,464 bytes**. The script budget changed from 752,000 to **756,000** in this reviewed decision: Branch and Run changed with the plan list load as their own 2.09 KB chunk only when a generation card is selected, 17 short messages in four languages add about 1.3 KB to the shared message chunk, and the canvas shell gains a small poller that refreshes takes while a canvas run is active. Planning and caching run on the server and in the existing worker. No dependency or service was added.

## Instagram images and carousels — 2026-11-03

Summed script gzip: **761,744 bytes**, **5,780 bytes** more than canvas branches and runs (755,964); public files **9,305,433 bytes**. The script budget changed from 756,000 to **762,000** in this reviewed decision. 29 new messages in four languages (about 6 KB of text before compression) go into the shared message chunk. The Publish page chunk, loaded only on `/publish`, gains the format choice, the ordered carousel picker and the swipeable review strip. Two duplicate labels and a hint were removed before raising the budget. Image conversion (FFmpeg), public hosting (the existing `s3mini` dependency) and container handling run on the server and in the existing publication worker. No dependency, service or background process was added.

## Instagram DM collection — 2026-11-03

Summed script gzip: **765,045 bytes**, **3,301 bytes** more than Instagram images and carousels (761,744); public files **9,314,943 bytes**. The script budget changed from 762,000 to **766,000** in this reviewed decision: the Connections page gains the DM collection panel and its small status hook, and 15 messages in four languages join the shared message chunk. Checks, downloads and frame sampling run in a loop inside the existing publication worker; no dependency, service or process was added.

## Edit analysis — 2026-11-03

Summed script gzip: **767,093 bytes**, **2,048 bytes** more than Instagram DM collection (765,045); public files **9,321,442 bytes**. The script budget changed from 766,000 to **768,000** in this reviewed decision: 16 Remix messages in four languages (camera moves, pace, analysis status and two build options) join the shared message chunk, and the shot list gains its chips. Motion estimation, text reading and the rebuild operations live in server-only modules (`grammar-read.ts`, `rebuild.ts`); the Remix page keeps importing only material assignment, so the browser-reachable module count stays at 358. Analysis runs in the existing harness worker with FFmpeg and an optional, separately installed Tesseract; no dependency was added.

## Audio screens — 2026-11-03

Summed script gzip: **769,836 bytes**, **2,743 bytes** more than Edit analysis (767,093); public files **9,328,774 bytes**. The script budget changed from 768,000 to **771,000** in this reviewed decision. 15 messages in four languages join the shared message chunk: file requirements, prompt names for each audio job, the no-prompt note and the voice picker. The Studio route gains three small components (`source-requirements`, `studio-prompt-field` additions and `suggested-text-input`). Prompt rules reuse the existing validation module, and voice names arrive as provider catalog data. No dependency was added, and browser-reachable modules went from 358 to 360.

## Face match — 2026-11-03

Summed script gzip: **771,269 bytes**, **1,433 bytes** more than Audio screens (769,836); public files **9,332,882 bytes**. The script budget changed from 771,000 to **773,000** in this reviewed decision: 7 face messages in four languages join the shared message chunk, and the Cinema take card gains its face chip, query and best-take rule (`best-take.ts`, `face-match.ts`; browser-reachable modules 360 → 362). Detection and recognition run in a short-lived Python process from server-only modules; the 39 MB of models stay in the data directory, outside the app and its install, and are downloaded only by `pnpm character face-setup`.

## Collaboration — 2026-11-03

Summed script gzip: **780,021 bytes**, **8,752 bytes** more than Face match (771,269); public files **9,358,446 bytes**. The script budget changed from 773,000 to **781,000** in this reviewed decision. About half is 40 messages in four languages in the shared message chunk (now 118,834 bytes): the review page, the share dialog and the comments dialog. The rest is code split by route: the review page loads only at `/shared/<token>` (1,793 bytes), the comments dialog loads with the editor (1,523), the share dialog sits in the project header (about 1,000), and the shared hooks take 418. No dependency was added. Tokens, hashing, storage and the role check are server-only, and browser-reachable modules went from 362 to 366.

## Ducking — 2026-11-03

Summed script gzip: **781,358 bytes**, **1,337 bytes** more than Collaboration (780,021); public files **9,362,138 bytes**. The script budget changed from 781,000 to **783,000** in this reviewed decision. The ducking curve (`audio-ducking.ts`) is shared by the editor preview and the browser export. The inspector gains one select, and six messages in four languages join the message chunk. FFmpeg rendering uses the same module on the server, and no dependency was added.

## Clip speed — 2026-11-03

Summed script gzip: **782,424 bytes**, **1,066 bytes** more than Ducking (781,358). This is within the 783,000 budget: the speed select, the mapping in the preview and browser export, and three messages. The FFmpeg speed pass runs on the server only.

## Dialogue — 2026-11-03

Summed script gzip: **785,111 bytes**, **2,687 bytes** more than Clip speed (782,424); public files **9,375,433 bytes**. The script budget changed from 783,000 to **786,000** in this reviewed decision. The editor gains the dialogue dialog and the script parser it shares with the server, and 13 messages in four languages join the message chunk. Lines are generated and placed on the server, no dependency was added, and the architecture check still finds no server module reachable from the browser.

## Costs — 2026-11-03

Summed script gzip: **790,196 bytes**, **5,085 bytes** more than Dialogue (785,111); public files **9,389,836 bytes**. The script budget changed from 786,000 to **791,000** in this reviewed decision. The cost estimate line appears in Studio, Cinema, Canvas, the dialogue dialog and approvals, the Connections page gains the spending section, and 20 messages in four languages join the message chunk. Prices travel with the model list that is already loaded; spending reads the generation history on the server. No dependency was added.

## Character swap — 2026-11-03

Summed script gzip: **793,320 bytes**, **3,124 bytes** more than Costs (790,196); public files **9,402,089 bytes**. The script budget changed from 791,000 to **794,000** in this reviewed decision. The editor gains the swap dialog (character and model pickers, plan, per-piece progress and face verdicts) and 21 messages in four languages. Cutting pieces, generation, face matching and placement run on the server, and no dependency was added.

## Relight and Edit text — 2026-11-03

Summed script gzip: **797,472 bytes**, **4,152 bytes** more than Character swap (793,320). The script budget changed from 794,000 to **798,000** in this reviewed decision. Studio gains the Relight and Edit text forms, the source-length fitting for models that follow a clip, and 28 messages in four languages. Text detection runs on the server with Tesseract, and no dependency was added.

## Image layers — 2026-11-03

Summed script gzip: **808,337 bytes**, **10,865 bytes** more than Relight and Edit text (797,472). The script budget changed from 798,000 to **809,000** in this reviewed decision. The Layers page is its own route chunk of 6,044 bytes, loaded only when the page opens; its 47 messages in four languages add 3,728 bytes to the shared message chunk, and the Studio handoff adds a 746-byte chunk. Splitting, flattening and the ZIP run on the server, and no dependency was added.

## Soul ID — 2026-11-03

Summed script gzip: **811,819 bytes**, **3,482 bytes** more than Image layers (808,337). The script budget changed from 809,000 to **813,000** in this reviewed decision. The character page gains the trained-identities panel, Studio's model settings offer each character's Soul ID, and 12 messages in four languages join the message chunk. Training and status checks run on the server, and no dependency was added.
