# Optional ima2 image generation

Connect an independently installed **ima2-gen 3.26.3** server to the Viral Hit harness. The extension has no npm dependencies and adds no code or dependencies to the studio browser bundle. ima2 owns provider authentication and generation; Viral Hit owns the approved recipe, pinned reference asset, durable request, immutable binary receipt and editable project asset.

Two data-only recipes are included. They are also offered together as the **ima2 image generation** pack in **Runs → Recipe library**, from [pack.json](pack.json):

- `ima2-image`: one prompt → one image → project asset.
- `ima2-reference`: a pinned project image and direction → one new image → project asset. This is reference-guided generation, not mask/inpainting support. The original stays in the project.

## Installation

Install and configure ima2 separately, following its [documentation](https://github.com/lidge-ai/ima2-gen/tree/bc58b964cc7f40223d7ebda8e9f6446da688973b). Select a provider account there. Viral Hit does not install ima2, discover its port, import browser sessions or choose a billing lane automatically.

From the repository root:

```sh
node extensions/ima2/scripts/build.mjs
node --test extensions/ima2/test/*.test.mjs
```

Install both `.json` descriptors and their `.mjs` entries from `extensions/ima2/dist/adapters/` into your `VIRAL_HIT_ADAPTERS_DIR`, or point that variable directly at this absolute directory if these are your only adapters. Preserve any adapters already installed. Set these variables in **every studio/MCP/worker process**, then restart them together:

```sh
export VIRAL_HIT_IMA2_URL=http://127.0.0.1:3333
# For an authenticated LAN deployment, use its HTTPS origin and server-side token:
# export VIRAL_HIT_IMA2_TOKEN=...
```

The URL must be an origin without a path, query or credentials. Plain HTTP is limited to loopback. Requests never follow redirects. An optional token is sent only as `x-ima2-token`; both endpoint and token participate in the harness configuration fingerprint. Secrets never belong in recipes.

Import `recipes/ima2-image.json` and `recipes/ima2-reference.json` through **Runs → Recipe library**, or copy them into your existing recipe catalog. Choose an explicit lane and **canonical model ID** from ima2. No default model or automatic provider fallback is supplied. Supported lanes in this adapter are `api`, `oauth`, `grok-api`, `gemini-api`, `atlascloud`, `minimax` and `comfy`; availability and reference support depend on that server's configuration. Matching lane/model metadata is required when receiving a result. Provider aliases which resolve to a different canonical ID must be entered in canonical form.

Review the generation plan before running. A completed result is available in Assets and can be attached to the existing timeline. Generation may incur provider charges. Actual cost is recorded as unknown because the upstream history API does not provide a final monetary receipt.

## Recovery contract

The original request ID is derived from the durable job key. Submission uses async `POST /api/generate` and an idempotency header as additional protection. **ima2 expires those keys after 24 hours, so this adapter declares `reconcile`, never `replay`.** Recovery only reads `/api/history?requestId=...` and `/api/inflight?includeTerminal=1`; it never sends another generation request. Missing, expired or incomplete evidence remains uncertain. Restore the original server/configuration and inspect the original job before deciding to create a new run.

Saved binary receipts recover without any server call. Downloads come only from the configured server's `/generated/` path, not the arbitrary URL returned in metadata. References and results are limited to 32 MiB each; JSON responses to 4 MiB; each HTTP request to 20 seconds. PNG/JPEG/WebP signatures are checked, then the normal materializer decodes the image. A PNG signature is **not** evidence of transparency.

Cancel sends the upstream abort request and then observes the job. An abort acknowledgement alone does not mark it canceled; a result that already completed can still be retained. An upstream failed or missing result stays uncertain because a provider may already have charged or generated an output.

## Verification

`npm test` exercises request loss, read-only recovery, cancellation, metadata identity, bounds, redirects and binary retention against an HTTP contract fixture.

An opt-in integration verifier runs **the actual pinned ima2 application** with isolated storage and synthetic outbound AI responses. It runs both recipes through the Viral Hit harness, simulates an interruption after acceptance, verifies exactly two upstream generation calls for the two recipes, materializes images and attaches both to a timeline:

```sh
pnpm --dir apps/studio exec tsx scripts/verify-ima2.ts \
  /absolute/ima2-install/node_modules/ima2-gen /absolute/evidence-directory
```

The separate ima2 installation must have its native dependencies built. The verifier's child environment has isolated HOME/config/storage and blocks other outbound fetches. It does not use personal provider credentials. This proves integration, not paid generation quality or support for every listed model. Masks, branching UI, alpha verification, ima2 video, model discovery UI and live provider quality checks remain separate work.
