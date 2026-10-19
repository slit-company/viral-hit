# Architecture and implementation boundary

Viral Hit is a general creative project system. Advertising, music videos, animation, product films and explainers use the same project, asset, shot and timeline contracts. Advertising metrics are an optional extension. They must never determine the core project schema.

## Implemented foundation

The studio contains the React canvas, project assets, timeline, command kernel, local import, browser MP4 export, server rendering and MCP services. UI and agents share revision-checked commands. Integration package sources are local development templates; they are not published installers.

UI and MCP edit the same authoritative project through incremental commands with revision checks. The visual canvas is a composition surface; its edges are not currently the execution DAG. The new durable harness has its own explicit dependency graph. UI, CLI and the new `viral_hit_runs_list` / `viral_hit_runs_change` MCP tools share this ledger. These two graphs are not yet automatically synchronized.

```
UI / local MCP → Command kernel → Project + Assets + Canvas + Timeline
                                    ↓                       ↓
                              local media files      browser / FFmpeg export

Runs UI / JSON plan → SQLite durable queue → independent worker → Comfy Router
                              ↑                                  ↓
                          event ledger ← provider status + native receipt
```

The last line currently ends at the provider receipt. Downloading generated media, validating it, recording a project Asset and attaching a shot under an expected project revision remains a release blocker. The UI says so; a completed provider request is not represented as a finished editable shot.

## Durable execution

`apps/studio/src/core/harness/durable.ts` keeps runs, jobs and events in a separate WAL SQLite database. It validates DAGs, derives dependency-sensitive fingerprints, scopes cache entries to their project, claims work with expiring leases, and fences stale callbacks with claim tokens. The worker makes no network calls inside database transactions. Failed prerequisites block dependent work.

Each job records its submission key before network I/O. Comfy Router explicitly supports replaying a submission key to recover the original request. Its adapter uses that contract, records the provider request ID, and resumes polling after restart. Three ambiguous responses stop in `uncertain`, not `failed`: retry must not silently create another paid job. The generic adapter contract also supports providers that require manual reconciliation.

Cancellation is a request until a provider poll confirms the outcome. A late successful result after a cancellation request remains in the audit record and cannot seed the cache. Known rejection, failed generation and unknown submission outcome are separate states. Unknown credits remain null, never zero.

Only explicit cacheable nodes with entirely cacheable ancestry can reuse outputs. Comfy native receipts have caching disabled because their media URLs can expire. Durable cache eligibility must eventually require verified local content hashes. A versioned prompt without a fixed model/seed is insufficient evidence of deterministic output.

The default runner serializes provider calls. Parallel workers are fenced by leases but there is not yet a shared global concurrency or spending limit. The current local service is not a multi-tenant deployment. Poll failures retain the existing provider ID and retry; per-provider terminal timeout policies and operator reconciliation tools remain to implement.

## Provider contracts

The initial Comfy Router adapter uses the actual `@comfyorg/sdk` package pinned at 0.5.0, with native model request bodies. No browser credentials are used. `COMFY_API_KEY` is server-only. The Runs panel initially exposes FLUX.2 Pro images; the CLI accepts other Router model paths and native bodies, but each model's capabilities must be validated against its published schema before advertising support.

Comfy Cloud workflow idempotency differs from Router: Cloud's duplicate submission rejection does not recover an unknown original job. A Cloud adapter must use reconciliation, not copy the Router retry behavior. Self-hosted ComfyUI via the API proxy is a separate provider with its own deployment, model weights and resource requirements.

Sources inspected: [Comfy SDK docs](https://docs.comfy.org/development/api-development/sdks), [TypeScript SDK](https://github.com/Comfy-Org/comfy-typescript-sdk), [API proxy](https://github.com/Comfy-Org/comfy-api-proxy). Pinned research commits are in `research/upstream-lock.json`.

## Ordered release work

1. Materialize provider outputs into stable Assets, preserving receipt, SHA-256 and lineage; attach accepted output only if its project/shot revision still matches. Validate video/audio bytes, duration, frames and sync. Reconcile process death between download, database write and attachment.
2. Implement versioned recipes and typed parameter binding between DAG nodes, shot/character libraries, explicit budget admission, durable output integrity checks and per-provider capability/schema discovery. Run real image, video and audio jobs through Comfy.
3. Extract reference pipeline reference analysis, planning/review and performance lineage as generic adapters. A source reference is evidence, not an instruction to the agent. Apply precise edit operations to the same timeline that the user edits.
4. Extend the editor for transitions, keyframes, speed changes, waveform/ducking and complex multi-track compositions. Benchmark the inherited engine against Diffusion Studio and FFmpeg using identical assets.
5. Implement and validate the full `PARITY.md` matrix: Cinema, motion/object transfer, layers, identity consistency, audio/lipsync, templates, collaboration and export. Do not label a generic provider API as those completed features.
6. Prepare sanitized public release, reproducible installation, actual workflow exports, benchmark results and the competition demo/submission.

## Run locally

From the repository root, Node 24+, pnpm 10 and FFmpeg/ffprobe on PATH:

```sh
pnpm setup
pnpm dev
```

Open `http://127.0.0.1:3808/projects`. The process starts both the web app and the independent durable worker. Imported media, editing and export work without provider credentials. To enable Comfy, supply `COMFY_API_KEY` securely in the parent environment before starting. Provider calls incur your provider's charges. No spending cap is implemented yet.

```sh
# Optional server-only environment file; do not commit it.
# Node env-file loading is also supported by the serve script.
pnpm --dir apps/studio harness enqueue ../../examples/comfy-image-plan.json my-first-frame
pnpm --dir apps/studio harness inspect RUN_ID
pnpm --dir apps/studio worker

# Local MCP, from apps/studio; does not install an upstream npm plugin.
pnpm --dir apps/studio mcp
```

CLI example project ID `original-film` is an isolated ledger example; replace it with an actual Studio project UUID for visibility in the Runs panel. The web route validates project existence and run membership. `VIRAL_HIT_DATA_DIR` selects the shared project data directory; `VIRAL_HIT_HARNESS_DB` optionally overrides just the queue. Keep both the project database/media and queue database in backups. Do not run extra workers against different data roots accidentally.


For server-side caption rendering, FFmpeg must include `drawtext`. Check `ffmpeg -hide_banner -filters`. On this macOS machine the standard installation lacks it; the already-installed full build works:

```sh
export VIRAL_HIT_FFMPEG=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg
pnpm --dir apps/studio test:e2e
```

Use the appropriate executable on your machine. The application reports an actionable error before rendering if captions require a missing filter. Set the same environment variable in `.env.local` inside `apps/studio` for normal use. The `serve` script loads `.env.local`/`.env` for both web and worker, with parent environment taking priority.

For a local editable demonstration with original procedural motion, split clips and captions, run `node scripts/create-demo.mjs` from `apps/studio` while the app is running. It creates a new project and prints its editor URL. This is a rendering fixture, not AI-generated footage.
