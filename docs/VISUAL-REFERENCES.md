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

Providers receive ordered `input.imageUrls`, `input.videoUrls` and `input.audioUrls`. These preserve order within each kind, not cross-kind interleaving. `referenceDelivery: "project-media"` provides verified call-scoped `media` and `readMedia`; otherwise the existing managed upload path supplies authorized delivery URLs. Counts alone do not establish that a model understands a reference, performs lip-sync, or maintains identity/motion. Custom per-reference roles and semantic quality need separate contracts/evaluation.

## Studio selection and recovery

The image/video composer now has **Sources** and **Upload files**. The source dialog shows each selected file's kind, its required/maximum counts and a deduplicated project library. Uploads are local project assets; selecting them does not start generation. A whole excessive selection fails before upload. If a later individual upload fails, successfully uploaded sources remain selected.

Switching visual models preserves selected originals and disables generation when counts no longer match. The source selection survives reload in the same browser tab and project. This storage contains sources only, not a complete visual prompt/options draft. An unreadable stored selection remains until explicit replacement. Generation history reuse restores all image/video/audio IDs, including known local files outside the recent library window, without re-uploading them. Original ownership is checked again on submission.

Canvas continues to use its per-kind media slots and server validation. Studio count feedback does not imply that every Canvas interaction has identical presentation. External module/configuration changes still require coordinated process restart.

## Optional real processor

[Visual conform](../examples/providers/visual-conform/README.md) independently implements video-to-image frame extraction and short video formatting with an optional image overlay and soundtrack. It uses actual local PNG/MP4/WAV files and separately installed FFmpeg/FFprobe. A durable video → frame recipe and a browser Studio → frame → editable sequence → MP4 flow are verified. This processor does not interpret prompts or perform AI inference. Contributors can implement other general or specialized models behind the same declaration.
