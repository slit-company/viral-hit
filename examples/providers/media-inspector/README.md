# Optional technical video inspector

This is an independently installable **real FFprobe processor**, not a vision-language model. It adds two analysis models: a general technical report and a vertical-delivery checklist. It does not understand prompts, scenes or dialogue. The prompt is retained as the requested focus; the report explicitly says it was not interpreted.

Set `VIRAL_HIT_FFPROBE` to your installed FFprobe executable. Copy this entire folder under `VIRAL_HIT_PROVIDERS_DIR` and restart the studio and any separate MCP process. Alternatively package the manifest and single module with the existing runtime-package format. In Canvas choose Analysis, then Technical video review or Vertical delivery review, attach one project video and run. No package, model download, service or installation script is required.

The existing generation reference-delivery service supplies `input.videoUrl`. Already-public media needs no upload; private/local media still uses the studio's configured managed-upload service. Installing this processor does not make private local media available to it without that upload configuration. For direct integration tests the module also accepts HTTP loopback sources. HTTPS sources may be operator-controlled; the module runs as trusted server code and is not sandboxed.

The processor streams at most 64 MiB into a private temporary directory, refuses redirects, uses a two-minute overall signal and a twenty-second FFprobe deadline, limits subprocess output to 1 MiB, and removes temporary bytes after completion/failure. These are task bounds, not a complete process/RAM cap. It reports the acquired SHA-256, stream dimensions/codecs, nominal frame rate, duration and audio stream metadata. It does not use `analysisDepth` or `maxOutputTokens` because the report is deterministic and small.

The generic analysis provider contract also supports asynchronous AI services: return `{status:"processing",taskId}` and implement `checkStatus({model,taskId,signal})`, eventually returning `{status:"succeeded",text}`. This example needs no polling. See `docs/ANALYSIS-PROVIDERS.md` for the shared contract and limits.
