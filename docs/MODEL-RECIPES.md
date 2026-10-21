# Compose installed models in recipes

`generation.model` lets an independently installed image, video, audio or analysis provider participate in the existing durable worker. The same contract serves general models and specialized processors. It uses Studio's generation admission, original media storage and history; it does not introduce another generation queue or copy retained outputs into a second materializer store.

Install a provider through the runtime package review flow or an operator provider folder, and restart the affected server/MCP/worker processes together. Discover its model ID and controls with `pnpm --silent generation models` or `viral_hit_generation_models`. Import a recipe through Runs → Recipe library, HTTP, MCP or CLI, then queue it within the intended generation scope. Models may charge their own provider account.

A minimal node:

```json
{
  "id": "image",
  "operation": "generation.model",
  "version": "1",
  "input": {
    "schemaVersion": 1,
    "mode": "image",
    "modelId": "your-installed-image-model",
    "prompt": "The intended scene",
    "parameters": { "aspect_ratio": "1:1" },
    "references": [],
    "outputIndex": 0
  }
}
```

`mode` must match the installed model. Model-specific controls belong in `parameters.provider_options`; declared defaults are captured when preparing the plan. Omitted `references` and `outputIndex` default to an empty list and the first output. Reference entries contain `assetId`, `kind` (`image`, `video`, `audio`) and `role`; use `audio_track` for audio and `source` for source video. References must be verified local project media. Providers may consume the existing local reader or the normal managed-upload path, according to their own declaration.

The author does not supply `runtime` or `pins`: admission creates those server-owned identities and rejects pre-pinned public input. Runtime fingerprints include the installed manifest, retained module source and declared configuration. Built-in providers that do not expose that execution identity are not admitted through this operation; their existing Studio or Comfy routes remain separate.

## Bind sources and reuse results

To condition a second model on the first model's output, declare the second node's reference with the expected kind and an `assetId` placeholder, add the producer to `dependsOn`, and bind `/references/0/assetId` to the producer's `/assetId`. Admission adds bindings for the complete ownership/content identity. The worker checks those original bytes again before calling the second model. Same-kind retained outputs from native materializers or reference intake can be used too.

Bindings may change `/prompt`, individual paths under `/parameters`, and declared reference asset IDs. They cannot change model identity, mode, output selection, reference roles/kinds or runtime pins. Input counts and resolved values are validated again before submission. Dynamic values that cannot be validated before their dependencies finish are not evidence that the whole recipe is valid at queue time.

Successful media steps return `generationId`, `assetId`, `projectId`, `kind`, SHA-256, byte size, public URL and measured media dimensions/duration. `outputIndex` selects one of the ordered retained output assets, excluding thumbnails. The worker verifies bytes and probes the real format before marking the job successful; it updates derived measurements without replacing the original asset. The result feeds `editor.sequence`, an installed adapter's declared media input, storyboard result acceptance, or an explicit timeline attachment/take. Those actions retain existing revision checks.

Analysis steps return `generationId`, `kind: "analysis"`, `text` and an optional validated structured `report`. Bind `/text` into a downstream prompt or a compatible adapter input. Reports do not expose media attachment/take actions and cannot masquerade as materialized assets. Analysis has one report output (`outputIndex: 0`). Normal generation history still retains the report and original references for storyboard preparation.

## Recovery and resource boundaries

A deterministic intent UUID comes from the existing project/job idempotency key. Its unique insertion fences competing processes. It is reserved before submission; generation history is linked before provider entry. Repeated execution of that job observes the same intent, even if it is still pending. Reconciliation never creates a replacement request. A crash before an upstream task receipt exists remains uncertain; restoring a process cannot prove that an external provider did no work.

Queued tasks pin their provider callbacks to the original source/configuration, including operator-folder providers used by the harness. Configuration or source changes block observation through the replacement runtime; restore the original release to reconcile. Completed retained outputs can still be inspected when that provider is unavailable. Failed work with an existing intent is not automatically resubmitted. Intentionally regenerate through a new reviewed run/request key.

The existing worker remains sequential. Harness-owned generation disables the submission service's extra background timer and uses the shared status synchronization service with its existing 20-second lease. The step has a five-minute cooperative execution deadline, passed into installed provider code; trusted modules must honor the signal. Upstream cancellation is not declared by the installed-provider contract, so a cancellation after submission remains uncertain rather than claiming the provider stopped.

Reference verification streams through the existing 64 KiB hash buffer; local provider references remain capped at 64 MiB each and 256 MiB total. Retained outputs use existing provider storage limits and format probes. These bounds are not whole-host memory limits or model performance benchmarks. No default model, dependency or schema migration is added.

## Independent examples

- [Image recipe](../examples/provider-recipes/image.json): a general image-model workflow with editable model ID and direction.
- [Calibration-card recipe](../examples/provider-recipes/calibration-card.json): a specialized composition of image generation, tone generation, referenced audio processing and separately editable visual/audio tracks.

The examples use optional procedural image/audio modules and the FFmpeg audio-conform processor. They exercise actual PNG/WAV processing and editing, not semantic model quality. Contributors can replace the model IDs, declare compatible controls and assemble their own recipes without changing application code. Hosted model-quality benchmarks and full Higgsfield parity remain separate requirements.

## Author a recipe from installed model metadata

In a project's **Generation runs → Recipe library → Build from an installed model**, select a model by its name and stable ID. The form shows its output kind, provider, configuration presence, declared input ranges and adjustable controls. Choose the number of image/video/audio source slots, recipe metadata and a general or specialized use-case tag. Every chosen source becomes a required project input; project file IDs and credentials are not embedded in the portable recipe. Analysis needs at least one source and returns a report. For media, output index selects an actual returned item, starting at zero; it does not request additional outputs.

**Build recipe for review** produces an ordinary single-step `generation.model` manifest. Review, download, installation, same-ID updates and execution use the existing recipe library and worker. Prompt, aspect ratio, duration and provider-declared controls become typed run inputs where supported. The model ID stays fixed. The draft can be composed with other steps using the existing recipe format and included in a recipe or creative pack. This is a starting point for independent workflows, not a visual graph editor or a model-quality guarantee.

Providers with missing configuration can still be authored and shared; execution checks configuration separately. The catalog includes providers with an execution identity supported by the durable model adapter. Refresh reads their loaded metadata; changed module manifests require the runtime's normal coordinated restart. A stale catalog digest is rejected before building. That digest describes the public contract, not credential values or a code signature; the worker's runtime/configuration pin is captured later at queue admission. Authoring never imports a provider's executable module or creates a generation intent.

HTTP `POST /api/app/recipes` and MCP `viral_hit_recipe_library` share these requests:

```json
{"action":"model_catalog"}
```

```json
{
  "action": "build_model",
  "expectedModelDigest": "<digest returned by model_catalog>",
  "definition": {
    "schemaVersion": 1,
    "id": "my-source-frame",
    "version": "1.0.0",
    "title": "Source frame",
    "description": "An adjustable frame extraction recipe.",
    "author": "Independent contributor",
    "license": "MIT",
    "category": "creation",
    "tags": ["specialized"],
    "modelId": "visual-frame",
    "referenceCounts": {"image": 0, "video": 1, "audio": 0},
    "outputIndex": 0
  }
}
```

The example requires the separately installed `visual-conform` provider. Other installed models use their own declared counts and controls. Save the `definition` object above to `definition.json` for the CLI:

```sh
pnpm recipe model-catalog
pnpm recipe build-model definition.json <model-digest> new-recipe.json
pnpm recipe inspect new-recipe.json
pnpm recipe install new-recipe.json <inspection-digest>
```

`build-model` refuses an existing output file. Exported JSON retains the same inspection digest; required sources are chosen from the receiving project's library at run time. Source files are limited to 64 MiB each by generation admission and the recipe picker. This does not install a model, include its runtime, or allocate paid work.
