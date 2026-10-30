# Comfy Router provider

Adds [Comfy Router](https://docs.comfy.org) models to Studio, Canvas and MCP with one Comfy API key. It is an installed provider: no studio code changes, no runtime dependencies and no model downloads.

| Studio model | Router ID | Studio task |
| --- | --- | --- |
| FLUX 3 Image | `bfl/flux-3-image` | Create image, Edit image (up to 10 references) |
| FLUX 3 Video | `bfl/flux-3-video` | Create video (text, or 1–10 keyframes) |
| LTX 2.5 Pro | `ltx/ltx-2-5-pro` | Create video (720p or 1080p) |
| LTX 2.5 Fast | `ltx/ltx-2-5-fast` | Create video (720p to 2160p) |
| MiniMax H3 | `minimax/minimax-h3` | Create video (text, first and last frame) |

Request fields follow the per-model schemas published at `docs.comfy.org/router-schemas`, checked on 2026-10-30.

## Install

```sh
pnpm --dir extensions/comfy-router install --frozen-lockfile
pnpm --dir extensions/comfy-router build
pnpm --dir extensions/comfy-router test
pnpm --dir apps/studio provider check ../../extensions/comfy-router/dist/providers/comfy
```

Copy `dist/providers/comfy` into the server's `VIRAL_HIT_PROVIDERS_DIR`, or import `dist/comfy.runtime.json` in **Extensions → Manage runtime packages**, then restart the studio and worker. Save `COMFY_API_KEY` in **Extensions → Connect creative APIs → Comfy** and press **Check connection**, which reads one page of the model catalog and starts nothing. A server environment variable with the same name takes precedence over the saved key.

## How a generation runs

1. Inputs are checked against the model's options before any media is read or credit is used.
2. Selected project images are read once and sent inline: base64 for FLUX, data URIs for MiniMax. Each must be PNG, JPEG or WebP and at most 20 MiB.
3. The request goes to the Router queue (`POST /v2/models/{provider}/{model}/requests`) with an `Idempotency-Key` derived from the studio's durable generation ID. An uncertain submission is reported as unknown; it is never submitted again under a new key.
4. The studio polls `.../status`, honouring `Retry-After`. On `COMPLETED` it reads the native result, takes the documented media field (`result.sample` for FLUX, `result.video_url` for LTX, `task.content.url` for MiniMax) and downloads the file into the project immediately, because Router links expire within hours. Only public HTTPS URLs are fetched; credentials are never sent to the media host.
5. Failures reported by Router (`content_policy_violation`, `insufficient_credits`, `result_expired` and similar) end the job with that reason. Transient errors keep the job waiting.

If the queue is not enabled for an account (`403 not_enabled`), the provider uses the synchronous route and collects a timed-out run with the same key, as the Router contract describes. That fallback keeps the request body in memory, so a restart during it ends the job and points to Comfy usage history.

## Evidence and limits

Six contract tests cover request bodies for every model, key reuse, queued polling and download, Router error mapping, private media URLs, the synchronous fallback and the read-only connection check. They use mocked HTTP. No paid Comfy generation has been run from this repository yet, so output quality, latency and cost are unverified. Costs are reported as unknown rather than estimated.
