# Local masked edit

Copy this directory into your operator provider directory and restart the Studio and workers together. Install FFmpeg/FFprobe separately and set `VIRAL_HIT_FFMPEG` / `VIRAL_HIT_FFPROBE` if needed.

**Edit marked area** takes one image and a mask. Where the mask is white it applies the chosen change (blur, grayscale, pixelate or a solid fill); where it is black the original pixels stay exactly as they were. The mask is stretched to the source size, so a mask painted at preview resolution still lines up. The output is a PNG at the source size; transparency in the source is not kept.

The manifest declares `"maskInput": { "required": true }`, which makes Studio show **Mark area** and makes every caller send a mask. Prompt text records the direction; this processor follows the numeric controls only. It uses verified local bytes, private temporary files, restricted protocols and formats, two FFmpeg threads, bounded deadlines and cleanup.

This is a small, real implementation of the mask contract. It is not generative inpainting. Replace the module with a call to your own inpainting model to keep the same Studio, MCP, CLI and recipe behavior.
