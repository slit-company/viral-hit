# Optional technical video inspector

This is an independently installable **real FFprobe processor**, not a vision-language model. It adds two analysis models: a general technical report and a vertical-delivery checklist. It does not understand prompts, scenes or dialogue. The prompt is retained as the requested focus; the report explicitly says it was not interpreted.

Set `VIRAL_HIT_FFPROBE` to your installed FFprobe executable. Copy this entire folder under `VIRAL_HIT_PROVIDERS_DIR` and restart the studio and any separate MCP process. Alternatively package the manifest and single module with the existing runtime-package format. In Canvas choose Analysis, then Technical video review or Vertical delivery review, attach one project video and run. No package, model download, service or installation script is required.

The manifest opts into `referenceDelivery: "project-media"`. Import a local video and the studio supplies a call-scoped `readMedia(input.videoUrl)` reader with verified project-owned bytes, hash and metadata. No Cloud API upload or model key is required. Remote-only videos must first be imported locally. The module also retains a bounded HTTPS/loopback download fallback for standalone callers that do not use the installed-provider contract. Modules run as trusted server code and are not sandboxed.

The processor accepts at most 64 MiB and writes a private temporary copy. Its standalone URL fallback streams downloads and refuses redirects. It uses a two-minute overall signal and a twenty-second FFprobe deadline, limits subprocess output to 1 MiB, and removes temporary bytes after completion/failure. These are task bounds, not a complete process/RAM cap. It reports the acquired SHA-256, stream dimensions/codecs, nominal frame rate, duration and audio stream metadata. It does not use `analysisDepth` or `maxOutputTokens` because the report is deterministic and small.

The generic analysis provider contract also supports asynchronous AI services: return `{status:"processing",taskId}` and implement `checkStatus({model,taskId,signal})`, eventually returning `{status:"succeeded",text}`. This example needs no polling. See `docs/ANALYSIS-PROVIDERS.md` for the shared contract and limits.

The processor also returns a version-1 structured report containing one measured whole-video observation. With local project-media delivery, open Storyboards → Start from a model report to prepare it as an unsaved reference plan. It supplies no creative direction or caption proposal; those remain yours to author. Independent vision models can return their own timed observations and optional proposals through the same contract described in `docs/STRUCTURED-ANALYSIS.md`.

Whole-video structured intervals use the editor’s millisecond timebase and 0.01–3600 second range. Videos outside that range still receive the technical text report; no unsupported storyboard interval is fabricated.
