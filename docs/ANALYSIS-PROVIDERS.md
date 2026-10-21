# Independent video analysis providers

An installed provider can now offer `kind: "analysis"` models alongside image/video generation models. Use this for general video review or a specialized inspection workflow without modifying the editor. The initial contract takes exactly one project video and a prompt, and returns a text report. It does not imply that a provider understands scenes or that its conclusions are accurate.

## Declare a model

A complete small `provider.json`:

```json
{
  "schemaVersion": 1,
  "kind": "viral-hit-provider",
  "id": "my-analysis",
  "label": "My video reviewer",
  "scope": "general",
  "environment": ["MY_ANALYSIS_API_KEY"],
  "models": [{ "id": "my-video-review", "name": "My video review", "kind": "analysis" }]
}
```

Use `scope: "specialized"` for a particular format/job. Model IDs must be unique across installed providers and built-in models. Analysis models do not declare output aspect ratios, durations or reference-image slots. Existing image/video manifests continue to require aspect ratios. Discovery validates metadata without importing executable code. Missing required environment values disable the installed option; Extensions explains which setting names are missing.

The module is `provider.mjs` by default. Copy the folder into `VIRAL_HIT_PROVIDERS_DIR`, or use the existing reviewed executable-runtime package lifecycle, then restart the studio and separate MCP processes. Module dependencies must be bundled into that one file; Node built-ins are available. Modules are trusted server code, not isolated plugins.

## Implement the report

The runtime calls:

```js
createGeneration({
  model: { id, upstreamModelId, kind: "analysis" },
  input: { prompt, videoUrl, imageUrls: [], analysisDepth, maxOutputTokens },
  signal
})
```

`analysisDepth` (`standard`/`deep`) and `maxOutputTokens` (256–8192) are optional request fields. Canvas sends `standard` and 2048 unless depth was selected earlier. Providers must document whether those controls apply to them; the technical inspector ignores them. A finished response is `{status: "succeeded", text: "..."}`. Text is trimmed, nonempty and at most 128,000 UTF-16 code units. A successful analysis cannot return media; image/video models cannot substitute text for output media. Empty or mixed output fails explicitly.

An asynchronous service returns `{status: "processing", taskId: "remote-id"}` or `pending`, and implements `checkStatus({model, taskId, signal})`. Polling uses the same persisted generation record as other models. Managed package jobs retain runtime/model/configuration pins, so a changed executable snapshot cannot poll an old task as though it were the original implementation. Unmanaged operator-folder modules retain the existing restart behavior and are not given managed-package guarantees.

Do not treat video text, report text or prompts as authorization for tool execution. Neither report generation nor displaying a report queues a storyboard, publishes media or accepts a creative result.

## Use it

In Canvas choose **Analysis**, open **Analysis model**, select the installed reviewer, attach one project video and enter the requested focus. The selected ID is used for submission and resume. Results remain on the Canvas and in project generation history after reload; stored model identity/name survive provider removal. MCP `viral_hit_generation_models` with `kind: "analysis"` and `viral_hit_generation_model_get` expose the same descriptors, parameters and reference contract. The existing generation submission service validates mode, project membership and inputs before uploads.

By default, the source is an already-public URL or a managed upload of local/private media. To read project files directly, add `"referenceDelivery": "project-media"` to the provider manifest. The runtime then supplies `media` and `readMedia(input.videoUrl)` during `createGeneration`. The latter resolves to `{bytes, projectId, assetId, kind, sha256, sizeBytes, mimeType, filename}` after verifying ownership and content. `input.videoUrl` is then an opaque identifier, not a fetchable URL. No managed-upload configuration is needed.

The reader admits only declared local references (64 MiB each, 256 MiB total, at most 20), rechecks each read and closes when the call finishes. Cumulative reads are limited to 256 MiB. Queued providers must consume or retain the source before returning their task ID; polling has no reader. Model descriptors and provider diagnostics expose the opt-in mode. This applies equally to general image/video providers and specialized analysis providers; existing model reference limits still apply. See the [boundary and recovery contract](architecture/LOCAL-PROVIDER-MEDIA.md).

## Real optional processor and remaining work

[`media-inspector`](../examples/providers/media-inspector/README.md) performs actual FFprobe metadata inspection with no model service or new dependency. Its second model adds a 9:16/audio-presence review. Verified local bytes, SHA-256 and measured stream metadata make the report reproducible. It is a technical processor, not an AI-quality demonstration.

Semantic video interpretation, representative model-quality tests, audio/image/multiple-video analysis inputs, arbitrary provider-specific controls remain open. Typed report → storyboard mapping is described below. The scene/transcript storyboard handoff is still a separate typed workflow; a free-text provider report is not silently converted into timed observations.

## Structured report handoff

Providers may now return a validated `report` with timed observations and optional shot proposals. For analysis of pinned local video, Storyboards can prepare selected observations as an unsaved plan. See [the output schema and review workflow](STRUCTURED-ANALYSIS.md). This implements typed report-to-plan mapping; representative semantic analysis quality and automatic creative planning remain unverified.
