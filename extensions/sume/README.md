# Sume creative APIs

Optional provider for Viral Hit. Thirty explicit model/operation profiles join the existing Studio, Canvas, model recipes and MCP generation interface. No model weights, new worker queue or runtime SDK dependencies.

## Install and connect

```sh
npm ci --prefix extensions/sume
npm run --prefix extensions/sume build
```

Import `extensions/sume/dist/sume.runtime.json` in Runtime packages, review and activate it, then restart Studio, MCP and workers together. Alternatively set `VIRAL_HIT_PROVIDERS_DIR` to the absolute `extensions/sume/dist/providers` directory on each process (do not install the same provider twice).

Open **Extensions → Connect creative APIs**, save a Sume API key, and choose **Check connection**. Keys are encrypted in the private workspace data directory; their values are never returned to the browser. An operator may instead set `SUME_API_KEY` on every process; environment configuration takes precedence. All processes must use the same workspace data directory. Finish pending work before replacing keys: changing credentials fences existing tasks until their original configuration is restored.

The check calls `GET /v1/open/balance`. It verifies authentication, not a paid generation or output quality. Generation requires Sume account balance and may be gated by model/account. A model catalog read checks current supported options before uploading references or submitting a router job.

Create or open a project, choose a Sume model in Studio, enter a prompt, and select references from project assets. Results are saved through the existing generation output pipeline, can become new generation inputs, and can be placed on the editable timeline and exported. Processing-only models still use the app's required prompt field; enter a short description of the task. The connector omits that field from endpoints that reject it.

## Included

| Family | Profiles |
| --- | --- |
| Images | GPT Image 2 (including masks), GPT Image 2.5, Nano Banana 2.1, Seedream 5 Lite, Higgsfield Soul |
| Video | Seedance 2.5 reference and first/last-frame variants, Kling 3, Veo 3.1, Grok Imagine Video 1.5 |
| Remix | Motion transfer, object swap, 20 restyle presets; Kling motion control |
| Speech/video | Portrait and video lip sync, translation with lip sync, animated captions |
| Editing | Video upscale, image background removal, video trim, audio extraction |
| Audio | Seven music models; speech with four engine choices and an existing Sume voice ID |

For first/last-frame generation, the first selected image is the start frame and the second is the end frame. Remix accepts one 4–15 second clip and 1–8 images; restyle takes one clip and a preset. Source-duration options must match the selected clip/audio, rounded up; they are not automatically measured by this connector. Speech requires a Sume voice UUID or `voi_` library ID belonging to the selected engine's family. Music duration/lyrics can be requested in the prompt; a universal duration parameter is deliberately not sent because support varies by model. Korean captions should use a Hangul style such as `korean-ad` or `black-outline`.

## Execution and limits

- The app admits owned local references, pins hashes and provides a call-scoped reader. Upload is sequential, deduplicated within a call, limited to 64 MiB per reference and 256 MiB total by the host.
- Sume receives the selected media only when generation is submitted. Signed PUT uploads have no API authorization header; redirects and unrecognized destinations are rejected.
- Submit uses a stable idempotency key derived from the durable generation ID and model. There is no automatic paid POST retry. If the response is lost, inspect the original Viral Hit intent and Sume job history before creating another generation. Automatic discovery of an unknown upstream job is not implemented.
- Public reserved/captured/refunded/released credit amounts and available USD-cent amounts are retained in generation output as `providerCost`. Unreported cost is explicitly unknown, never zero. Final settlement is not inferred from a completed video.
- Original Sume job IDs are retained through the installed-provider runtime pin and existing persistent poller. Status/result GETs retry through that poller, with bounded `Retry-After`/poll hints. This connector does not claim cancellation of running remote work.
- Result URLs must use `https://media.sume.com`; downloads receive no provider credential. The app owns media persistence, decoding checks, asset provenance, editor attachment and export.
- Avatars/face-swap resources, voice creation/cloning, voice change, arbitrary router model registration, pre-submit price estimates, billing reconciliation after the final receipt, webhooks and remote cancellation are not included. Caption output is a rendered video, not editable word timing; use the existing local transcript/editor workflow when editable captions are needed.

## Validation

```sh
npm run --prefix extensions/sume test
# After installing Studio dependencies and building this extension:
VIRAL_HIT_FFMPEG=/path/to/ffmpeg VIRAL_HIT_FFPROBE=/path/to/ffprobe \
  pnpm --dir apps/studio exec tsx --test ../../extensions/sume/test/studio.integration.ts
```

Transport fixtures verify signed uploads, credentials, catalog rejection, idempotency, polling, result ownership, timeline editing and a real FFmpeg MP4 export. They do **not** demonstrate AI generation quality or real Sume-account acceptance. Source contracts and observed UI: [Sume research](../../docs/research/SUME.md).

Browser regression is optional and needs a separate test workspace. Build Studio, initialize its database with `VIRAL_HIT_DATA_DIR=/absolute/test-data pnpm --dir apps/studio db:push`, then start the built server from the repository root:

```sh
PORT=3830 HOST=127.0.0.1 VIRAL_HIT_SUME_TEST_FIXTURE=1 \
  VIRAL_HIT_DATA_DIR=/absolute/test-data \
  VIRAL_HIT_PROVIDERS_DIR="$PWD/extensions/sume/dist/providers" \
  node --import ./extensions/sume/test/connection-fixture.mjs ./apps/studio/.output/server/index.mjs
```

In another terminal run `VIRAL_HIT_QA_URL=http://127.0.0.1:3830 node extensions/sume/test/browser.mjs`. It enters a fixture credential, verifies the connection form and HTTP trust boundaries, captures desktop/mobile evidence, and removes the credential. This preloader mocks only balance authentication; do not use it for real production or submit generation from that test workspace. Stop this server and omit the preloader/test flag before real API use.
