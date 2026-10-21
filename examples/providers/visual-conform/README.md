# Local visual conform

Copy this directory into your operator provider directory, or package it through the runtime library. Install FFmpeg/FFprobe separately and set `VIRAL_HIT_FFMPEG` / `VIRAL_HIT_FFPROBE` if needed. Restart the Studio and workers together.

- **Frame from video** produces a cropped PNG at an explicit source time.
- **Video with image and audio** crops a short source clip, optionally adds a small top-left image and replaces its audio with the selected soundtrack (padding short audio).

The manifest declares source types/counts independently of output kind. Studio, Canvas, MCP/CLI and `generation.model` recipes use the same declarations. The first model accepts only video; the second accepts video plus optional image/audio. Prompt text records the operator's direction; this processor follows numeric controls, not prompt semantics.

Outputs are 240×240, 320×180 or 180×320, with 0.1–10 second video ranges contained in the original. The processor uses verified local bytes, private temporary files, restricted protocols/formats, two FFmpeg threads, bounded subprocess output/deadlines and cleanup. Runtime source limits also apply. It is a small independent implementation of the interface, not a semantic edit, lip-sync model, arbitrary format handler or inference benchmark.
