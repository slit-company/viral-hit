# Optional audio conform processor

An independently installable **real FFmpeg processor**, not a speech/music model. It trims one project audio source, applies gain, pads silence if needed and returns mono 24 kHz PCM16 WAV. An optional video sets output length to its measured duration; otherwise the Length control applies. The prompt is retained in history but is not interpreted. There is no fixed voice, language or marketing format.

Set `VIRAL_HIT_FFMPEG` and `VIRAL_HIT_FFPROBE` to installed executables. Copy this folder under `VIRAL_HIT_PROVIDERS_DIR` or distribute it as a reviewed runtime package, then restart the studio/MCP server. In Studio choose Audio → Conform a soundtrack. Upload/select one audio file and optionally one video, review Model options and generate. No model/service/package download or background process is added.

`referenceInputs` declares one required audio and one optional video; other independently authored models can declare image, video and audio ranges. `referenceDelivery: project-media` supplies bounded, verified original files through the call-scoped reader. No original path or credential is passed to the module. This example uses the same interface as general or specialized generative models; it does not establish those models' quality.

Processing is limited to 0.1–30 seconds output, a 60-second overall signal, 15-second probes, 30-second conversion and 1 MiB subprocess logs. Readers retain the core's per-file/aggregate limits. Inputs are written as private temporary copies and removed on success/failure; FFmpeg accepts only specified containers and the file protocol. Source start must precede the measured source end. Extra audio/video tracks are not mixed: the first audio stream is used. Stereo is downmixed to mono, short sources are padded with silence and gain above one can clip. These are explicit example choices, not limitations imposed on all providers.

[Audio provider contract](../../../docs/AUDIO-PROVIDERS.md).
