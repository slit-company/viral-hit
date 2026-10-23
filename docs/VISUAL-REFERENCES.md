# Independent visual models with mixed sources

Installed image and video models can declare `referenceInputs` using the same per-kind count contract as audio models. This supports general multimodal services and specialized frame extraction, video editing or audio-conditioned processors without adding a model-specific component or changing application code.

```json
{
  "id": "your-video-model",
  "name": "Your video model",
  "kind": "video",
  "aspectRatios": ["16:9", "9:16"],
  "referenceInputs": {
    "image": { "min": 0, "max": 2 },
    "video": { "min": 1, "max": 1 },
    "audio": { "min": 0, "max": 1 }
  }
}
```

This is a model fragment inside `provider.json`. Each range is 0–20, `min` cannot exceed `max`, and the sum of maxima is 1–20. Output kind does not determine input kind: an image model can require a video. Analysis continues to use `analysisInputs`.

Omitting `referenceInputs` preserves the legacy visual declaration: `maxReferenceImages` and `requiresImageInput`, with no video/audio input. Do not mix nonzero legacy image settings with the new declaration. Omission adds no normalized field and does not change old runtime fingerprints. Aspect ratio and optional video durations still come from their existing fields; model controls remain under `parameters.provider_options`.

## Shared input path

Discovery returns the count declaration and media slots. Studio, Canvas, asset-first HTTP/MCP/CLI requests and `generation.model` recipes use the same model registration. Server admission and adapter entry validate required/maximum counts, accepted aspect ratios/durations, distinct reference URLs and supported array fields before importing provider code. Internal `video_url`, `image_url`, frame aliases or forged parameters do not override the owned references.

Providers receive ordered `input.imageUrls`, `input.videoUrls` and `input.audioUrls`. These preserve order within each kind, not cross-kind interleaving. `referenceDelivery: "project-media"` provides verified call-scoped `media` and `readMedia`; otherwise the existing managed upload path supplies authorized delivery URLs. Counts alone do not establish that a model understands a reference, performs lip-sync, or maintains identity/motion. Models that need to know what each reference is for declare [reference roles](#reference-roles); semantic quality still needs separate evaluation.

## Studio selection and recovery

The image/video composer now has **Sources** and **Upload files**. The source dialog shows each selected file's kind, its required/maximum counts and a deduplicated project library. Uploads are local project assets; selecting them does not start generation. A whole excessive selection fails before upload. If a later individual upload fails, successfully uploaded sources remain selected.

Switching visual models preserves selected originals and disables generation when counts no longer match. The source selection survives reload in the same browser tab and project. This storage contains sources only, not a complete visual prompt/options draft. An unreadable stored selection remains until explicit replacement. Generation history reuse restores all image/video/audio IDs, including known local files outside the recent library window, without re-uploading them. Original ownership is checked again on submission.

Canvas continues to use its per-kind media slots and server validation. Studio count feedback does not imply that every Canvas interaction has identical presentation. External module/configuration changes still require coordinated process restart.

## Optional real processor

[Visual conform](../examples/providers/visual-conform/README.md) independently implements video-to-image frame extraction and short video formatting with an optional image overlay and soundtrack. It uses actual local PNG/MP4/WAV files and separately installed FFmpeg/FFprobe. A durable video → frame recipe and a browser Studio → frame → editable sequence → MP4 flow are verified. This processor does not interpret prompts or perform AI inference. Contributors can implement other general or specialized models behind the same declaration.

## Edit a marked area

A model that changes part of an image declares `maskInput` next to its reference counts:

```json
{ "referenceInputs": { "image": { "min": 1, "max": 1 }, "video": { "min": 0, "max": 0 }, "audio": { "min": 0, "max": 0 } }, "maskInput": { "required": true } }
```

Only image and video models can declare it, and the model must accept at least one image or video to apply the mask to. The mask is a separate project image: white marks the area to change, black keeps the original. Requests send it as a reference with role `mask`; the provider receives it as `input.maskUrl`, kept apart from `imageUrls`, and reads it through the same verified `readMedia` call when `referenceDelivery` is `project-media`. A mask does not have to match the source resolution.

Admission rejects a mask for a model without `maskInput`, a missing mask when it is required, more than one mask, a mask that is not an image, a mask reused as the edited media, and a mask with nothing to apply to. All of these fail before an intent, upload or generation record exists, through UI, HTTP, MCP, CLI and `generation.model` recipes alike. Built-in models do not declare masks, so a mask is never silently dropped.

In Studio, choosing a mask-capable model shows **Mark area**. The painter draws over the first selected image with brush, eraser, whole-image and clear actions, and saves the mask as a new project file; the original is never modified. The mask stays with the selection after reload and is restored when a request is reused from history. Removing its image drops the mask.

The optional [masked edit processor](../examples/providers/masked-edit/README.md) blurs, desaturates, pixelates or fills only the marked area with FFmpeg. It proves the contract with real pixels; it is not generative inpainting. A diffusion inpainting model, ComfyUI graph or hosted editing API plugs into the same declaration without app changes.

## Reference roles

A model that needs to know what each reference is for declares the specific roles it understands:

```json
{ "referenceInputs": { "image": { "min": 1, "max": 2 }, "video": { "min": 0, "max": 0 }, "audio": { "min": 0, "max": 0 } }, "referenceRoles": ["subject", "style"] }
```

Specific roles are `style`, `subject` and `pose`. Every model accepts `reference`, `source` and `audio_track`; `mask` has its own [contract](#edit-a-marked-area). A request that gives a specific role to a model that did not declare it is rejected before any intent, upload or generation record, through UI, HTTP, MCP, CLI and recipes alike, so roles are never silently dropped. Analysis models describe sources with `analysisInputs` instead.

Providers receive `input.references`, a list of `{ url, role }` in request order next to the existing per-kind arrays, and read files with the same verified `readMedia`. This is the extension point for motion transfer (a source video and a subject image), subject replacement, style transfer or pose-guided generation from independent contributors.

In Studio, a model that declares roles shows a role picker for each visual file in **Sources**. Roles survive reload and are restored when a request is reused from history. The optional [role collage](../examples/providers/role-collage/README.md) processor centers the subject over a blurred style image with FFmpeg, so swapping roles visibly swaps the result; it is not a generative model.
