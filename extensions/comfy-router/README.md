# Comfy Router provider

28 models (18 video, 10 image) through one [Comfy API key](https://platform.comfy.org/profile/api-keys). Uses the shared generation ledger, project assets and timeline in Studio, Cinema, Canvas and MCP. No runtime dependencies or model downloads.

| Family | Models | Inputs |
| --- | --- | --- |
| Seedance | 2.5, 2.0, 2.0 Fast, 2.0 Mini | Text, first/last frame or image references; WAV/MP3 reference |
| Veo | 3.1, 3.1 Fast, 3.1 Lite | Text or first/last frame |
| Kling | V3 Omni, O1, V3 | Omni/O1: text, frames or references; V3: text |
| Wan | 3.0, 3.0 Prime | Text, first/last frame or image references |
| Grok Video | Imagine Video 1.5, 1.5 Lite | Text, one start frame or image references |
| FLUX | 3 Image, 3 Video | Text and project images |
| LTX | 2.5 Pro, 2.5 Fast | Text |
| MiniMax | H3 | Text or first/last frame |
| Nano Banana | Pro, 2.1 | Text or image edit |
| GPT Image | 2.5 Sunburst, 2.5 Flare | Text or image edit |
| Seedream | 5.0 Pro | Text or image edit |
| Grok Image | Imagine Image 2.0 | Text |
| Ideogram | V4 | Text |
| Bria | Relight, Remove Background | One project image |

Native fields follow the [official per-model schemas](https://docs.comfy.org/router-schemas/veo/veo-3.1-generate-001.json), checked 2026-11-02. Unsupported video references, masks and combinations are rejected before submission. **Use images as** selects ordered frames or reference images. Seedance 2.5 frames use adaptive aspect; Seedance 2.0 excludes 1080p; Veo 1080p/4k needs 8 seconds.

## Install

```sh
pnpm --dir extensions/comfy-router install --frozen-lockfile
pnpm --dir extensions/comfy-router build
pnpm --dir extensions/comfy-router test
pnpm --dir apps/studio provider check ../../extensions/comfy-router/dist/providers/comfy
```

Run `pnpm providers` at the repository root to build bundled providers, then restart Studio and its worker. Or import `dist/comfy.runtime.json` through **Extensions → Manage runtime packages**. Save `COMFY_API_KEY` in **Connections → Model APIs → Comfy**. **Check** reads the catalog without generating anything. A server environment variable takes precedence.

## Execution and limits

- The queued [Router API](https://docs.comfy.org/router-openapi.yaml) receives native JSON and a stable idempotency key from the durable generation ID. Polling honours retry delays. Uncertain submissions never become a new paid request.
- Results are downloaded immediately into project assets, or decoded from inline image/video bytes. Credentials only go to the API host. Media signatures are checked; private/unsupported download URLs are rejected.
- Inputs: 20 MiB per image (Kling: 10 MB, PNG/JPEG), 15 MiB per WAV/MP3, 40 MiB total references, 64 MiB serialized JSON. Veo needs PNG/JPEG. Reference audio is currently a Seedance-only subset.
- Results: 64 MiB image, 512 MiB downloaded video or 96 MiB inline video. Catalog/status JSON stays capped at 4 MB; only result reads allow larger inline media.
- Accounts without queue access use the synchronous route and recover timeouts under the same key. Its in-memory fallback is capped at eight requests/64 MiB; restarting it requires checking Comfy usage history. It never evicts live work.
- Costs stay unknown unless reported. Real paid Comfy generation, quality and latency remain unverified. Fourteen mocked contract tests cover native bodies, admission, media, idempotency, polling and recovery.
