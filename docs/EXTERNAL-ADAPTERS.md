# Install a runtime without editing the studio

The [optional local-media package](../extensions/local-media/README.md) now connects real music2 score synthesis and vid2 procedural motion rendering through this contract. It is installed separately and adds no engine dependencies to the browser/studio. See its exact bridge limits and live verification command.

Viral Hit can load explicitly installed execution adapters alongside its built-in Comfy Router, ComfyUI and media import operations. Recipes remain data-only; importing a recipe never installs or executes its adapter. An operator installs trusted code on the host, and UI, HTTP, MCP and worker discover the same operation catalog.

## Try the independent audio example

The repository includes a standalone procedural tone adapter. It synthesizes a quiet PCM WAV, publishes an immutable binary receipt, then uses the existing `asset.materialize` step to create an ordinary project asset. Its output can be added to an audio track, used as a take or exported with visual media. The current browser MP4 action requires a visual clip; audio-only file export remains separate work. It is a calibration example, not a speech/music model or a generation-quality benchmark.

From the repository root:

```sh
# Use absolute paths, and use the same settings for every application/MCP/worker process.
export VIRAL_HIT_ADAPTERS_DIR="$PWD/examples/adapters/tone"
export VIRAL_HIT_RECIPES_DIR="$PWD/examples/adapter-recipes"
pnpm dev
```

In a project, open **Runs**, select **Procedural tone**, choose frequency and duration, then **Queue workflow**. Once the materializer reports **Asset ready**, choose **Add to timeline**. The normal development/production launcher starts the worker automatically. If you start the app, MCP or worker separately, provide the same environment to each. To keep the standard recipe catalog, omit `VIRAL_HIT_RECIPES_DIR` and install `examples/adapter-recipes/procedural-tone.json` through **Recipe library** instead.

Without `VIRAL_HIT_ADAPTERS_DIR`, no external code is enabled. The directory is a process-lifetime snapshot: after installing/updating adapters, restart the studio, MCP and worker together. There is no browser-side code upload, automatic package download or hot replacement.

## Package contract

Use the [descriptor JSON Schema](schemas/adapter.schema.json) for authoring. `pnpm --dir apps/studio adapter inspect /absolute/adapter-directory` validates descriptors, hashes and schemas without importing code; `adapter list` inspects the configured process catalog.

A directory contains up to 32 JSON descriptors and their `.mjs` files. Other JSON files in that directory are also interpreted as descriptors. Keep recipes in a different directory. Each descriptor contains:

- `schemaVersion: 1`, a namespaced `operation` starting with `ext.`, an implementation `version`, `label`, `author` and `license`.
- `entry`: a filename in that directory, and `sha256`: the SHA-256 of its exact bytes.
- `recovery`: `manual`, `replay` or `reconcile`, matching the module export; `generation`: whether the operation generates media through a model/provider.
- `configuration`: declared environment variables with `{name, required}`. Include **all** credentials, endpoints, account selections and other environment settings that can change job identity. Values never appear in capability discovery; their fingerprint pins each queued job to its original configuration.
- Optional `assetInputs`: up to 16 named project media inputs, each with `{id, pointer, kind, maxBytes}`. `pointer` addresses an asset ID inside the raw payload; `kind` is `image`, `video` or `audio`. The default per-input limit is 32 MiB. Individual and aggregate declared limits cannot exceed 512 MiB; IDs and pointers must be unique and nonoverlapping.
- `inputSchema`: synchronous JSON Schema draft-07, checked by Ajv in strict mode. No coercion, default insertion, remote schema fetching or custom validation keywords are enabled.

Descriptors are bounded to 64 KB, individual modules to 2 MB and aggregate source to 8 MB. Duplicate operations, builtin names, mismatched hashes, invalid schemas and relative directory settings fail catalog loading. This is an operator configuration error; correct it and restart the processes.

Export a default adapter object with the methods in [the TypeScript contract](../apps/studio/src/core/harness/external-adapter-api.ts). The worker imports the exact verified bytes through a data URL. Bundle external dependencies into the `.mjs`; `node:` built-ins are supported, relative imports are not. JSON inspection and capability discovery do not import the module. The implementation version in each recipe node must match the descriptor version. Recipe identity/version continues to participate in plan fingerprints.

Adapters run with the worker's normal filesystem, environment and network privileges. The digest pins identity; it is not a sandbox, author signature or quality certification. Review code and its license before installing it. Code that loads additional mutable executable files can defeat reproducibility; bundle dependencies and declare configuration. Process isolation and signed installation packages remain future work.

## Inputs, recovery and output

Admission wraps each external node's input with immutable adapter/configuration fingerprints. Dependency bindings are rewritten beneath the payload, so their output cannot replace those fingerprints. Fully supplied input is schema-checked before enqueue. Bound placeholders are checked after dependency resolution and before submission. Resolved input is persisted by the existing durable harness. Inputs should reference declared recipe parameters; never place provider secrets in recipes.

`submit(input, context)` returns a real recoverable `{id}`. It receives the stable idempotency key, dependency outputs, AbortSignal and project/run/job identifiers. `poll(id, input, signal, context)` returns an actual `running`, `succeeded`, `failed`, `canceled` or `uncertain` result. JSON results are bounded to 1 MB. Obey the supplied signal; the host cannot forcibly stop arbitrary in-process JavaScript.

Use `manual` unless replay or read-only reconciliation is actually supported. `replay` means the same idempotency key always recovers the same external job. `reconcile` requires a read-only `reconcile(input, {key, signal})` method returning the original ID or null. The existing **Find original job** UI and reconciliation HTTP/MCP action include installed adapters declaring this capability. The framework cannot prove that a third-party implementation obeys its declaration; test the provider behavior.

A worker with different code, descriptor or declared configuration refuses an old pinned job before importing or calling that implementation. Ambiguous submissions remain uncertain; the mismatch is not converted into a definitive failure that could authorize resubmission. Polling an already accepted job also refuses a mismatched runtime. Restore the original installed version/configuration to inspect it. Missing required configuration pauses that operation. Updating an adapter does not migrate queued/running jobs.

Optional `cancel(id, input, signal)` requests cancellation. Return `{state: 'canceled'}` only with confirmed cancellation; otherwise the next poll must establish the actual outcome. A provider refusal or unsupported cancellation is not reported as successful cancellation.

For binary outputs, submit/poll contexts provide:

```ts
const existing = await context.readBinary();
if (existing) return { state: 'succeeded', output: existing };
const output = await context.publishBinary(bytes, {
  model: 'provider-model-version',
  providerJobId: id,
  contentType: 'audio/wav',
  creditsUsed: null, // Record actual provider units when known; never estimate as fact.
});
return { state: 'succeeded', output };
```

These functions are scoped to the current project/job. Publication atomically retains bytes, SHA-256, provider job ID, model, content type and adapter digest. Repeated publication must match the original receipt. The returned `binaryReceipt` binds to `asset.materialize` exactly like built-in outputs; it is not itself a registered asset. Media probing and project membership remain part of materialization/attachment. A trusted adapter can publish its own bytes, but cannot make an invalid file pass the media probe merely by labeling it as audio/video/image.

Public HTTPS URL outputs can instead bind to materializer `url`.

## Project media inputs

A recipe exposes `{ "id": "source", "label": "Source audio", "type": "asset", "kind": "audio" }` and maps it to the adapter’s declared payload pointer. The generated form offers matching local project assets, applies the declared byte limits and previews images, video or audio. Existing native ComfyUI image controls retain their PNG/JPEG/WebP and 32 MiB restrictions. The HTTP and MCP paths enforce admission independently of the form.

Declare the corresponding adapter input:

```json
"assetInputs": [
  { "id": "source", "pointer": "/sourceAssetId", "kind": "audio", "maxBytes": 67108864 }
]
```

In `submit` or `poll`, call `await context.readAsset('source')`. It returns `{projectId, assetId, kind, sha256, sizeBytes, bytes, mimeType, filename}`. It does not return a host path. These helpers check active project membership, local storage, registered kind, byte limit, exact file size and SHA-256. The host rejects symlinks at the final file component. The MIME label comes from asset metadata; the processor must still validate/decode supported formats. This helper is not a security sandbox for trusted executable code.

Selected inputs are verified at admission and pinned by complete identity. Every declared input is checked again before the implementation is imported or submitted. Changed or missing originals block replay without turning an ambiguous submission into a failed/retryable new job. During polling, bytes are checked only when `readAsset` is called: an adapter can recover an already-published output through `readBinary` even if the source was later removed. Inputs are bounded in-memory bytes, not streams; at most 512 MiB of declared inputs are admitted per adapter invocation. Multi-gigabyte/streaming media needs a separate interface. `reconcile` and `cancel` do not currently receive the media reader.

To consume another node’s result, bind the input pointer to an explicit `asset.materialize` dependency’s `/assetId`. Admission checks its declared kind and adds bindings for the project, kind, size and hash. The durable harness freezes all those values together in the resolved execution input before submission. Arbitrary provider URLs, parent-object replacements and non-materializer sources are not accepted for this input bridge. A recipe that needs a different kind should materialize it explicitly first.

## Try a source-to-output processor

`examples/adapters/audio-gain/` is a standalone FFmpeg processor with no studio imports. Install it by choosing that adapter directory and an absolute FFmpeg executable:

```sh
export VIRAL_HIT_ADAPTERS_DIR="$PWD/examples/adapters/audio-gain"
export VIRAL_HIT_FFMPEG="$(command -v ffmpeg)"
export VIRAL_HIT_RECIPES_DIR="$PWD/examples/adapter-recipes"
pnpm dev
```

Import an audio file into a project, then select **Runs → Audio gain**. Select **Source audio**, a volume multiplier and maximum duration, and queue the workflow. The example decodes at most the first 30 seconds of a local input up to 64 MiB into a new 48 kHz stereo PCM WAV. It preserves the original, and gain above 1 can clip loud inputs. Its declared executable path is pinned with the job configuration; the binary itself is operator-managed, so pin its version in your deployment too. The processor does not call an AI model or paid service. Install both examples by copying their descriptor/module pairs into one adapter directory; recipes stay in a separate directory.

Adapter isolation, streaming inputs, hot upgrades and automatic environment repair remain separate work.

The implementation follows [Ajv's draft-07 schema contract](https://ajv.js.org/json-schema.html#draft-07-default) and [Node's data URL module loading rules](https://nodejs.org/api/esm.html#data-imports). See [validation evidence](VALIDATION.md) for tested behavior and limitations.
