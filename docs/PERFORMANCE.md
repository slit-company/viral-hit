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
