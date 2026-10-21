# Optional media batch inspector

This independently installed provider measures project image, video and audio files with FFprobe. It supports a single picture, sound, multiple videos or mixed sources. It is a technical inventory, not a semantic AI model or a quality benchmark.

Copy this folder into `VIRAL_HIT_PROVIDERS_DIR`, set `VIRAL_HIT_FFPROBE` to the existing FFprobe executable and restart. No dependency, daemon or model download is added by default. Choose **Media batch review** in Canvas Analysis, open **Analysis sources**, select media already placed on the Canvas, close the dialog and choose **Analyze**. The same `analysisInputs` contract is exposed to HTTP/MCP clients.

The model permits up to eight images, four videos and four audio files, with at least one source. The common project reader enforces ownership, hashes, 64 MiB/file and 256 MiB total/read limits. The processor reads and probes one file at a time, deletes each temporary file, bounds probe output to 1 MiB and each child to 20 seconds, and bounds the whole batch to 120 seconds. Unsupported formats or streams fail explicitly. It never accesses a network URL.

Text lists measured dimensions, codecs, duration where present, audio metadata and original checksums. Order is image, video, audio; order within each group matches the submitted references. This processor does not output timed storyboard observations because a batch has no single source timeline.
