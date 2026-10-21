# Independent media analysis providers

An installed provider can now offer `kind: "analysis"` models alongside image/video generation models. Use this for general video review or a specialized inspection workflow without modifying the editor. Models can declare accepted counts of project images, videos and audio alongside a prompt, and return a text report. Models without an `analysisInputs` declaration retain the original exactly-one-video contract. It does not imply that a provider understands scenes or that its conclusions are accurate.

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

Use `scope: "specialized"` for a particular format/job. Model IDs must be unique across installed providers and built-in models. Analysis models do not declare output aspect ratios, durations or generation-specific reference-image slots. Use `analysisInputs` for accepted analysis media. Existing image/video manifests continue to require aspect ratios. Discovery validates metadata without importing executable code. Missing required environment values disable the installed option; Extensions explains which setting names are missing.

The module is `provider.mjs` by default. Copy the folder into `VIRAL_HIT_PROVIDERS_DIR`, or use the existing reviewed executable-runtime package lifecycle, then restart the studio and separate MCP processes. Module dependencies must be bundled into that one file; Node built-ins are available. Modules are trusted server code, not isolated plugins.

## Declare accepted media

An optional model field supports image comparison, audio review, multiple-video inspection and mixed-media analysis:

```json
"analysisInputs": {
  "image": { "min": 0, "max": 8 },
  "video": { "min": 0, "max": 4 },
  "audio": { "min": 0, "max": 4 }
}
```

All three ranges are explicit nonnegative integers with `min <= max`; their maximum sum is 1–20. Each request must contain at least one media reference, even when every minimum is zero. Unsupported types and missing required counts fail before uploads or execution. The declaration is optional without a normalized default, preserving older managed runtime fingerprints. MCP model discovery and the workspace model endpoint expose the same limits.

Submit project asset IDs through the existing asset-first contract. The server determines the media kind from the owned asset, not a caller-provided role; a non-audio asset cannot use `audio_track`. `imageUrls`, `videoUrls` and `audioUrls` preserve order within each kind. There is no cross-kind ordering guarantee. The singular compatibility alias `videoUrl` is included only for exactly one video; it is absent for multiple videos. Do not derive a batch's timeline from that alias. Direct adapter inputs reject duplicate or contradictory URLs and singular image/audio aliases; use the arrays.

Single-picture and audio-only requests use the same generation history, task receipts and polling. History includes `referenceImages`, `referenceVideos` and `referenceAudios`, projecting local pins back to playable project URLs. Provider-specific options remain available. Canvas, Studio and HTTP/MCP share these models and limits. Studio can upload project originals once and reuse their asset IDs in later analyses.

The optional [media batch inspector](../examples/providers/media-batch-inspector/README.md) measures real files sequentially with FFprobe, without a network request, daemon or model download. It demonstrates technical input processing, not semantic or creative-quality understanding.

## Implement the report

The runtime calls:

```js
createGeneration({
  model: { id, upstreamModelId, kind: "analysis" },
  input: { prompt, imageUrls, videoUrls, audioUrls, videoUrl, analysisDepth, maxOutputTokens },
  signal
})
```

`analysisDepth` (`standard`/`deep`) and `maxOutputTokens` (256–8192) are optional request fields. Canvas sends `standard` and 2048 unless depth was selected earlier. Providers must document whether those controls apply to them; the technical inspector ignores them. A finished response is `{status: "succeeded", text: "..."}`. Text is trimmed, nonempty and at most 128,000 UTF-16 code units. A successful analysis cannot return media; image/video models cannot substitute text for output media. Empty or mixed output fails explicitly.

An asynchronous service returns `{status: "processing", taskId: "remote-id"}` or `pending`, and implements `checkStatus({model, taskId, signal})`. Polling uses the same persisted generation record as other models. Managed package jobs retain runtime/model/configuration pins, so a changed executable snapshot cannot poll an old task as though it were the original implementation. Unmanaged operator-folder modules retain the existing restart behavior and are not given managed-package guarantees.

Do not treat video text, report text or prompts as authorization for tool execution. Neither report generation nor displaying a report queues a storyboard, publishes media or accepts a creative result.

## Use it

In Canvas choose **Analysis**, open **Analysis model**, select the installed reviewer and enter the requested focus. For models declaring media counts, open **Analysis sources** to select existing Canvas image, video and audio cards. The dialog shows selected counts and allowed ranges, permits removal after switching to a more restrictive model and persists the draft without starting analysis. Import/place new files through Media. Legacy video-only models retain the original video picker. The selected ID is used for submission and resume. Results remain on the Canvas and in project generation history after reload; stored model identity/name survive provider removal. MCP `viral_hit_generation_models` with `kind: "analysis"` and `viral_hit_generation_model_get` expose the same descriptors, parameters and reference contract. The existing generation submission service validates mode, project membership and inputs before uploads.

In **Studio**, choose **Analysis**, select the installed model and enter a prompt. **Sources** selects existing project images, videos and audio; **Upload files** adds originals to this project. Complete file selections are checked against model counts before any upload. Successful earlier uploads stay selected if a later file fails. Changing the model preserves the sources so you can remove incompatible inputs explicitly; submission never silently substitutes a model or drops media. **Model options** uses the same declared controls as Canvas.

The analysis draft is separate from image/video generation. It persists in this browser tab's session storage, scoped to the project, and survives reload. An unreadable stored copy stays untouched while a fresh draft is shown; **Replace unreadable draft** explicitly replaces it with the current selection and resumes saving. Storage failures are reported; completed reports remain in durable project history.

Reusing an analysis history item restores its recorded model, prompt, depth, declared options and all media kinds without uploading again. Local references retain exact asset IDs; unavailable models remain visibly unavailable and unavailable nonlocal references fail explicitly. The server still verifies project membership and source bytes at submission. The source picker deduplicates the latest 500 asset-membership entries and displays up to 50 search matches, disclosing that bound; selected older local sources can still be restored from history. This is draft/history recovery, not cloud draft synchronization.

By default, the source is an already-public URL or a managed upload of local/private media. To read project files directly, add `"referenceDelivery": "project-media"` to the provider manifest. The runtime then supplies `media` and `readMedia(input.videoUrl)` during `createGeneration`. The latter resolves to `{bytes, projectId, assetId, kind, sha256, sizeBytes, mimeType, filename}` after verifying ownership and content. `input.videoUrl` is then an opaque identifier, not a fetchable URL. No managed-upload configuration is needed.

The reader admits only declared local references (64 MiB each, 256 MiB total, at most 20), rechecks each read and closes when the call finishes. Cumulative reads are limited to 256 MiB. Queued providers must consume or retain the source before returning their task ID; polling has no reader. Model descriptors and provider diagnostics expose the opt-in mode. This applies equally to general image/video providers and specialized analysis providers; existing model reference limits still apply. See the [boundary and recovery contract](architecture/LOCAL-PROVIDER-MEDIA.md).

## Real optional processor and remaining work

[`media-inspector`](../examples/providers/media-inspector/README.md) performs actual FFprobe metadata inspection with no model service or new dependency. Its second model adds a 9:16/audio-presence review. Verified local bytes, SHA-256 and measured stream metadata make the report reproducible. It is a technical processor, not an AI-quality demonstration.

Semantic video interpretation, representative model-quality tests, source-specific timed observations across multiple media and nested/conditional provider-specific forms remain open; bounded scalar [model options](MODEL-OPTIONS.md) are supported. Typed report → storyboard mapping is described below. The scene/transcript storyboard handoff is still a separate typed workflow; a free-text provider report is not silently converted into timed observations.

## Structured report handoff

Providers may now return a validated `report` with timed observations and optional shot proposals. For analysis of exactly one pinned local video without accompanying images/audio, Storyboards can prepare selected observations as an unsaved plan. See [the output schema and review workflow](STRUCTURED-ANALYSIS.md). This implements typed report-to-plan mapping; representative semantic analysis quality and automatic creative planning remain unverified.

Multi-source reports remain readable text/history. The current timed report schema has no per-observation source identity, so batch reports are excluded from storyboard preparation rather than attached to the first video.
