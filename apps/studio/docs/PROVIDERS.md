# Provider configuration

Cloud API is the built-in hosted generation/analysis provider. It talks to any service that implements the task and file contract below. The operator sets the endpoint with `VIRAL_HIT_CLOUD_API_URL` (HTTPS, or HTTP on a loopback host for local development) and, when that service serves uploaded and generated files from a separate host, `VIRAL_HIT_CLOUD_MEDIA_HOST`. Users add only the API key in the workspace dialog; the endpoint cannot be changed from the browser, so a saved key is sent only to the operator's chosen origin. Without an endpoint, hosted generation stays off while local editing, ComfyUI, ima2 and adapter recipes keep working.

The connected service owns account-level generation concurrency. Viral Hit does not impose a separate cross-Project or per-Project generation limit; it submits each confirmed request and surfaces the provider's admission error when the connected account has no remaining capacity.

Configure it in the Provider dialog in the workspace header. The key is encrypted in the local `config` table with a per-install key stored under `data/`.

The adapter uses:

- `POST /v1/images/tasks`
- `POST /v1/videos/tasks`
- `POST /v1/video-analysis/tasks`
- `GET /v1/tasks/:id`
- `POST /v1/files` for supported reference files

User-facing capabilities of built-in models are defined in `src/core/effects/effect-registry-images.ts` and `effect-registry-videos.ts`; installed providers declare theirs in `provider.json`. Provider bindings live in `src/core/generation-providers/`; MCP and UI use the logical model id and capability schema, not Cloud API `effectId` or raw upstream fields.

UI precheck and submission accept the asset-first generation contract. Studio,
Canvas, Editor redo, and MCP share the server-side preflight and submission
service. Preflight validates project ownership, readable references, model
parameters, and provider configuration without uploading files. Only the
subsequent confirmed submission prepares remote delivery URLs. Browser status
requests read local task state; provider synchronization runs server-side.

The built-in catalog includes the current Cloud API GPT Image 2.5 Flare/Sunburst, Wan 3.0/Prime, HappyHorse 1.0/1.1, and MiniMax H3 Max/Max Turbo contracts. Their resolution casing, duration ranges, reference limits, required-image rules, seed support, and upstream request field names are preserved by the adapter.

Image attachments remain generic references in the shared Viral Hit request contract. Most first-frame and last-frame intent uses explicit prompt directives such as `Use @Image1 as the first frame.` and `Use @Image2 as the last frame.` The MiniMax H3 Max pair is an upstream exception: its dedicated two-slot media schema maps attachment order directly to first frame then last frame, matching Cloud API's published contract.

Kling 2.6 and Kling 3.0 Motion Control are exposed as Cloud API models. Each run requires exactly one character image and one MP4/MOV motion video uploaded through the connected Cloud API account. The Workspace never asks users for a KIE key; Cloud API owns the upstream provider route, billing, polling, and output persistence.

Video Analysis is exposed as a stable Cloud API workflow with Standard and Deep depth controls. The Workspace uploads one MP4/MOV input, submits the analysis task, polls `GET /v1/tasks/:id`, and stores the returned report text and usage in the local project history. Provider-specific Gemini routing remains private to Cloud API.

## Install a provider without changing the app

Any service or local model with its own API can become a provider: a hosted API Viral Hit does not ship, a company's internal model server, a model on your own GPU, or a model tuned for one brand or format. Put each provider in its own folder inside one providers folder, set `VIRAL_HIT_PROVIDERS_DIR=/absolute/path/to/providers` and restart the studio and MCP server. Its models then appear in the Canvas and Studio model pickers and in `viral_hit_generation_models` next to the Cloud API models, and generation, status polling and saving results into project assets work the same way.

```text
providers/
└── procedural-images/
    ├── provider.json
    └── provider.mjs
```

`provider.json` follows [provider.schema.json](../../../docs/schemas/provider.schema.json): `id` (equal to the folder name), `label`, `scope` (`general` for models that fit any project, `specialized` for one format, job, audience or brand), optional `author` and `license`, `entry` (the module file), `mediaHosts` and `models`. Each model declares its id, name, `image` or `video`, aspect ratios, video durations, how many reference images it accepts and whether one is required. Model ids must not reuse a built-in or another provider's id.

The module exports `createGeneration` and, for APIs that queue work, `checkStatus`:

```js
export async function createGeneration({ model, input, signal }) {
  // model: { id, upstreamModelId, kind }; input: { prompt, aspectRatio?, duration?, seed?, imageUrls }
  return { status: 'succeeded', media: [{ data: pngBytes, mimeType: 'image/png' }] };
  // or { status: 'processing', taskId } and finish later in checkStatus
}
export async function checkStatus({ model, taskId, signal }) {
  return { status: 'succeeded', media: [{ url: 'https://media.example.com/result.png' }] };
}
```

Media comes back either as bytes (PNG, JPEG, WebP, MP4 or WebM) or as a URL on a host listed in `mediaHosts` (HTTPS, or HTTP for localhost). A URL on any other host fails the generation and is never downloaded. Unfinished work is checked by the same server poller as Cloud API tasks, and each task records its provider, so a restart or a later change of providers does not lose it.

[examples/providers/procedural-images](../../../examples/providers/procedural-images) is a working provider without dependencies: it draws a gradient from the prompt, instantly or as a queued task. Check a folder with `pnpm provider check <folder>`, see what an installation loads with `pnpm provider list`, and find folders that failed to load (with the reason) in the same list.

Rules and limits:

- A provider module runs inside the server with its permissions, like an external adapter. Install only code you trust; keep its credentials in its own environment variables or files, never in `provider.json`.
- The module must be one self-contained file: `node:` built-ins work, other dependencies must be bundled into it. It is read once at startup; restart after changing it.
- Reference images reach the module as `imageUrls` prepared the same way as for Cloud API, so local images need the storage setting below (Cloud API files or your S3 bucket).
- Viral Hit does not measure the quality of a provider's output.

## Forking the built-in provider

To replace the default provider itself, a fork can register one in `src/config/generation-providers.ts`, bind only the logical models they support, and change `ACTIVE_GENERATION_PROVIDER_ID` in the same file. Cloud API remains the built-in default; an unknown configured id fails explicitly so it cannot accidentally submit a task to another provider. This repository does not ship placeholder KIE, Vidu, Evolink, Gemini, Fal, Replicate, or payment-provider integrations.

A custom provider definition owns adapter construction, readiness checks, parameter validation, model bindings, upstream model names, and upload paths. Provider credentials must stay server-side. Switching providers does not change Canvas nodes, Editor clips, Asset IDs, or MCP requests; each submitted task also records its provider/model identity so polling does not silently follow a later default-provider change.

## Storage

Storage is independently configurable from generation:

- `cloud-api` uses the configured Cloud API endpoint with the user's Cloud API key. File selection stays local; after generation precheck, supported references go to `POST /v1/files` immediately before task submission.
- Precheck creates a one-time SQLite generation intent that binds project, model, upload count, uploaded URLs, and final task submission. Selecting a file alone never uploads it, and uploaded inputs are not indexed as project assets until Cloud API accepts the task.
- Users may select `s3` to send generation references to their own public R2/S3-compatible bucket under the same intent rules. Credentials are encrypted in local SQLite rather than read from environment files.

Remote generation providers require public HTTPS media URLs. A custom bucket therefore needs a public base URL, normally an R2 custom domain or public bucket domain.
