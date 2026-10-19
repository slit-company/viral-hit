# Extending Viral Hit

The core must support both general creative work and specialized workflows. A new use case must not require forking the editor or inheriting advertising-specific assumptions. There are two extension levels: **data recipes** (implemented) and **execution adapters** (a TypeScript interface implemented in source; dynamic package installation is pending).

## Add a recipe without editing application code

A recipe is a versioned JSON file with identity, author/license, category, typed parameters, nodes and bindings. Put a manifest in `recipes/`, or point `VIRAL_HIT_RECIPES_DIR` to your own manifest directory before starting the app/MCP server. The studio reads the catalog and builds the input form from each manifest. Agents discover the same catalog through `viral_hit_recipes_list`; `viral_hit_runs_change` accepts `action: "recipe"`, `recipeId`, `values` and a stable `requestKey`.

The shipped `open-frame`, `open-motion` and `spoken-line` recipes cover general image, video and speech workflows. `remote-media-import` imports public HTTPS image/video/audio media without a generation key. `editorial-triptych` specializes the same machinery for three directed frames. It does not promise character continuity or automatic film assembly. Add product photography, storyboards, animation keyframes or other recipes without changing core UI components. Each recipe must describe real operation coverage accurately.

Manifests do not execute JavaScript, shell commands, environment expressions or agent instructions. Required operations must exist in the installed runtime. The current web worker supports `comfy.router` and `asset.materialize`. An unknown operation fails before submission. Model schemas and costs still require provider validation; a new model name in JSON is not a verified integration. Native Router output URLs remain temporary; an explicit `asset.materialize` node saves persistent local bytes. The shipped image recipes declare the FLUX response URL at `/data/result/sample`, following the official Comfy cinematic example. The shipped video recipe maps the Kling task-list result at `/data/data/0/outputs/0/url`; other result shapes need their own mapping. It does not currently fall back to a watermark URL. Each other model requires its own declared output mapping.

The [JSON Schema](schemas/recipe.schema.json) supports editor tooling. The runtime compiler additionally verifies graph cycles, parameter types/ranges, duplicate identifiers, pointer safety, dependency membership and overlapping bindings. Root `schemaVersion` versions the manifest format; recipe `version` versions the author's behavior. Node operation version and recipe identity/version enter the execution fingerprint.

```sh
# From repository root: compile offline, without API credentials or paid calls.
pnpm --silent --dir apps/studio recipe compile ../../recipes/open-frame.json ../../examples/open-frame-values.json MY_PROJECT_ID > /tmp/viral-hit-plan.json
# Inspect the plan before using the harness enqueue command.
pnpm --dir apps/studio harness enqueue /tmp/viral-hit-plan.json stable-request-key
```

## Typed parameter and output binding

A node starts with a JSON `input` and existing placeholders. Its `parameters` map a declared recipe parameter to an input JSON pointer:

```json
{
  "input": { "model": "bfl/flux-2-pro", "body": { "prompt": "" } },
  "parameters": [{ "parameter": "prompt", "target": "/body/prompt" }]
}
```

The compiler copies typed values, without string interpolation or evaluation. Parameters can be string, finite number, boolean or an enumerated string. String parameters can declare `multiline: false` for short identifiers, URLs and names; omitted/true retains a multiline text area. This is presentation metadata, not a change to string validation. Unknown values and invalid defaults fail validation.

For multi-stage processing, `bindings` select output JSON from an explicitly declared upstream node. The following is a **contract example**, not a live claim about a particular model's result format:

```json
{
  "id": "animate",
  "operation": "custom.video",
  "version": "1",
  "input": { "image": null },
  "dependsOn": ["frame"],
  "bindings": [{ "target": "/image", "node": "frame", "pointer": "/asset" }]
}
```

Once dependencies succeed, the worker resolves the pointers and persists the exact execution input **before** submission. Restart, replay, polling and cancellation reuse that frozen input. Missing fields fail before any dependent provider call. JSON pointer escaping follows `~0` and `~1`; array entries are indexed explicitly. Bindings may replace existing values, not create prototype properties or expand arrays. Cache invalidation includes upstream inputs and binding definitions. Generated media caching remains disabled until durable files are verified.

## Add an execution adapter in source

Implement `Adapter` in `apps/studio/src/core/harness/durable.ts`: `submit`, `poll`, optional `cancel`, and a truthful `recovery` mode. Register it in the worker and define its validated request policy. `submit` receives a persisted idempotency key, dependency outputs and an AbortSignal. It must return the real external job ID. `poll` returns actual running/succeeded/failed/canceled status; cancellation must not invent provider confirmation.

Use `recovery: "replay"` only if repeated submission with the same key is guaranteed to recover the original job. Otherwise use `manual`, leaving ambiguous outcomes uncertain. Persist provider identity, model/version, actual cost (or null), output metadata and provenance. Do not return success merely because an HTTP request was accepted.

Third-party executable adapters run with local process privileges; a future installer must make that explicit and must not auto-install code from a recipe. Signed packages, an adapter capability registry, isolated workers and schema-driven model discovery remain planned. Today this is a reviewed source contribution, not a plugin marketplace.

## Contributing

Keep general project/asset/timeline contracts free of brand-specific fields. Specialized parameters belong in recipes or optional metadata. Reuse public source only with compatible license/provenance and update `THIRD_PARTY_NOTICES.md`. Preserve existing MCP names when extending the catalog; new Viral Hit tools use `viral_hit_*`.

Validate changes at the affected boundary. Provider logic needs timeout/restart/ambiguous-response tests. Editor changes need real imported media, a decoded export and visual inspection. A model-quality claim needs real paid/open-weight generation evidence, not fixtures. Do not mark broad parity areas complete from narrow tests. Document missing functionality and failed comparisons alongside successful ones.


## Durable media stage

`asset.materialize` takes `{ "url": "", "kind": "image", "label": "Opening frame" }`, with a URL filled by a dependency binding or a user parameter. It requests HTTPS media from public addresses only, pins resolved DNS to the connection, rechecks redirects, forwards no auth/cookies, bounds downloads to 512 MiB and obeys cancellation/time limits. Private/self-hosted media needs an explicit future provider bridge; arbitrary localhost download is not enabled by a recipe.

FFprobe validates supported raster/container types, dimensions, stream presence and duration. This is not exhaustive decoding or a quality rating. A stable asset ID derives from project and job key. Bytes are published without overwriting an earlier artifact, hashed, registered and linked to the project. A restart between file publication and database linkage reuses the file. The paid provider job is a separate DAG node, so retrying local import does not resubmit generation. The original provider receipt remains immutable; the local job returns its own asset record with SHA-256, size, type, duration and local project URL.

`viral_hit_runs_change` action `attach` accepts `runId`, `jobId` and `expectedRevision`. It only accepts successful, uncanceled local-import jobs in the selected project, rechecks file integrity and applies one stable `add_clip` command. It never replaces the entire timeline. Repeated attachment returns the same command receipt; stale revisions fail. The UI fetches the timeline revision before requesting this action.

The default image duration on attachment is three seconds; imported video/audio uses the probed duration. Supported initial containers include PNG/JPEG/WebP/GIF, MP4, WebM, MP3, WAV and Ogg. Expired provider-URL refresh, cross-run media cache validation, per-shot replacement/acceptance, background repair and full decoding still need work. A canceled import can retain an already published asset for audit; its run is not eligible for automatic attachment.

Evidence for the FLUX mapping: [official Comfy cinematic example](https://github.com/Comfy-Org/comfy-cinematic-studio/blob/main/lib/flux-output.ts). Download address classification uses the [ipaddr.js public API](https://github.com/whitequark/ipaddr.js) pinned at 2.5.0.

## Video and speech contracts

`open-motion` exposes a prompt, 16:9/9:16/1:1 framing, integer duration 3–15 seconds and 720p/1080p settings using `kling/kling-3.0-turbo`. `spoken-line` uses `elevenlabs/eleven_v3` with the model-specific `inputs: [{text, voice_id}]` body and a stability setting. There is no fixed brand, narrator, language, advertising format or required aspect ratio in the engine. Voice IDs are supplied by the user; provider access and model capabilities still apply.

These contracts were read from the public [Kling schema](https://docs.comfy.org/router-schemas/kling/kling-3.0-turbo.json) and [Eleven v3 schema](https://docs.comfy.org/router-schemas/elevenlabs/eleven_v3.json). Schema version and SHA-256 are pinned in [model-contracts.json](../research/model-contracts.json). The model-specific schema takes precedence over a generic SDK example. The checked Eleven v3 route uses dialogue inputs, rather than a top-level `text` property. Input-contract inspection and fixture execution do not establish real provider acceptance or generation quality.

For binary-returning models, bind the provider node's `/binaryReceipt` to a materializer input's `/receipt`:

```json
{
  "id": "voice-asset",
  "operation": "asset.materialize",
  "version": "1",
  "cache": false,
  "input": { "receipt": null, "kind": "audio", "label": "Narration" },
  "dependsOn": ["voice"],
  "bindings": [{ "node": "voice", "pointer": "/binaryReceipt", "target": "/receipt" }]
}
```

Use either `url` or `receipt`, never both. The resolved receipt is an opaque job ID plus hash; recipes cannot supply local paths or another project's ID. Binary results are retained before the provider job is marked successful. The materializer verifies and copies them into normal Assets, then the existing revision-checked attachment adds video to a visual track or audio to an audio track. Extending the same pattern to music, effects or other binary models still requires a verified native input contract and a supported output container.
