# Independent audio models

Audio providers use the same installed provider boundary, model catalog, typed options, generation admission, task polling and retained project assets as image and video models. General models and specialized sound, speech or music services use the same contract; the core does not choose a voice, language, genre, brand or backend for them.

## Implement and install

Declare `kind: "audio"` on a model in `provider.json`. Set provider `scope` to `general` or `specialized`. Declare typed `controls` for provider-specific duration, voice, style or other settings; values reach the module in `input.options`. Visual aspect ratios, frame references and video duration fields are rejected. This initial audio path accepts a required prompt and typed options only; reference-conditioned audio is not implemented.

The optional [procedural audio example](../examples/providers/procedural-audio) implements immediate and queued 24 kHz mono PCM WAV output without dependencies. It synthesizes sine/triangle tones from numeric controls; it does not interpret the prompt, synthesize speech or establish music-model quality. Replace its implementation with a suitable service or local engine to implement those capabilities. Model code remains independently installable and does not import studio internals.

A successful module returns `status: "succeeded"` and `media: [{data, mimeType}]`, or a URL allowed by its declared `mediaHosts`. Binary MIME types are `audio/wav`, `audio/mpeg`, `audio/ogg`, `audio/mp4` and `audio/aac`. Queued models return `status: "processing", taskId` and implement `checkStatus`; polling must observe the original task instead of creating another generation. Results are limited to 64 MiB per audio file. The storage boundary rejects empty data and non-audio response content types. It does not exhaustively decode arbitrary outputs; ensure the engine returns valid playable media.

Put the provider folder under `VIRAL_HIT_PROVIDERS_DIR`, or distribute it in a reviewed [runtime package](RUNTIME-PACKAGES.md). Restart the app, MCP server and workers to activate changed source. Credentials are declared by name and remain server-side. Modules are trusted server code, not sandboxed plugins. Heavy engines and models stay in optional installations.

## Studio

Select **Audio**, choose an available model, enter a prompt and edit **Model options**. Submission uses the existing generation intent and project history. Completed audio opens a native player with a download action. Reusing history restores the original model and its saved options; an unavailable model is retained and cannot silently become another model.

Drafts are scoped to the project in browser session storage. They survive reload in the same browser session, not device transfer. An unreadable saved copy remains until explicit replacement. Completed output is retained in the project independently of browser draft storage. Audio generation is currently in Studio; Canvas generation nodes remain image/video/analysis. Existing timeline operations can use the resulting audio asset with explicit revision-checked editing.

## MCP and CLI

Discover models with `viral_hit_generation_models` and `kind: "audio"`, or run `pnpm --silent generation models` from `apps/studio`. The shared `viral_hit_asset_generation` tool creates project assets without requiring a Canvas generation node. Existing `viral_hit_generation_submit` keeps its Canvas contract.

Prepare this request with `viral_hit_asset_generation` under its `request` argument, or save the inner object to a file and run `pnpm --silent generation request /absolute/path/prepare.json`:

```json
{
  "action": "prepare",
  "generation": {
    "version": 2,
    "projectId": "YOUR_PROJECT_ID",
    "mode": "audio",
    "modelId": "procedural-sound",
    "prompt": "A short calibration sound",
    "references": [],
    "parameters": { "provider_options": { "frequency": 550, "seconds": 1.25, "wave": "triangle" } }
  }
}
```

Preparation validates admission and issues a single-use intent without generation or uploads. Review the returned `generation`, `digest` and `generationIntentToken`. Within the user's authorized generation scope, submit `action: "submit"` with that exact `generation`, `generationIntentToken` and `expectedDigest` equal to `digest`. Submission may spend provider credits. The same service handles CLI and MCP; neither places timeline clips nor publishes.

A consumed token cannot generate again. After an uncertain submission response, inspect generation history/status; do not automatically prepare a fresh token. The digest detects request changes against the reviewed value; it is not a provider-code signature or a guarantee that model defaults cannot change across a restart.

## Validation scope

The example tests use real WAV bytes, decoded durations, queued completion, MIME/size rejection, exact saved options, missing-model recovery and single-use intents. These establish extension behavior, not hosted model availability, music/speech quality, voice cloning, lipsync or full audio-editing parity. Final browser and production evidence is recorded separately in [validation](VALIDATION.md).
