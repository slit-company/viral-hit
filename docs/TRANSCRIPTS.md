# Speech transcripts and editable captions

Viral Hit accepts a provider-independent transcript result from an installed execution adapter. The [optional local Whisper package](../extensions/whisper/README.md) supplies one implementation; other engines can emit the same result shape through the ordinary external-adapter contract. No speech model is a default studio dependency.

A completed run shows original video/audio playback, source-time segment buttons, model/language information and **Download SRT**. The SRT starts at zero for the selected source range. Caption recipes prepare a separate editable sequence; adding it appends to the current timeline with the normal revision checks. Text/timing changes in the editor do not rewrite the original recognition receipt. Project-file export carries the resulting editable timeline/media through its existing contract.

## Public result contract

The outer adapter output may include other JSON. Its `transcript` member must match `src/core/transcripts/contract.ts`:

```json
{
  "schemaVersion": 1,
  "basis": "machine-transcription",
  "source": { "projectId": "project", "assetId": "asset", "kind": "video", "sha256": "64-lowercase-hex-characters", "sizeBytes": 12345 },
  "engine": { "id": "independent-engine", "version": "1", "model": "chosen-model" },
  "language": "en",
  "range": { "start": 12, "end": 17 },
  "segments": [{ "start": 12.5, "end": 14, "text": "Recognized words" }],
  "timingAdjusted": 0,
  "segmentsOmitted": 0
}
```

The digest above is an explanatory placeholder; an actual result requires the verified source SHA-256. Source kind is video or audio. Engine metadata may also include `cliSha256` and `modelSha256`. Source-time ranges are bounded to one hour and at most 120 seconds per result. At most 120 nonoverlapping, nonempty segments fit entirely within that range. Empty `segments` is a valid unconfirmed no-speech result. Contract validation establishes shape and timing bounds, not recognition accuracy or trust in an independently installed engine.

For editable assembly, a recipe can bind an adapter's relative caption clip array into an `editor.sequence` caption track. The selected original remains a separately pinned sequence asset, not an unverified asset ID accepted from arbitrary JSON. Empty caption tracks are allowed so a no-speech result does not manufacture text; source tracks still require clips and sequence inspection still requires a playable visual.

The optional Whisper recipes bind `captionClips`, `mediaClips` and `duration` outputs into a video or audio-with-cover sequence. Maximum source bytes, explicit language/range selection, code/configuration pinning and recovery use the existing adapter/harness services. See [architecture](architecture/TRANSCRIPTS.md) for ownership and [validation](VALIDATION.md) for actual evidence. Speech recognition is distinct from scene detection, semantic video analysis, storyboard acceptance and publishing.
