# Editable video layers

An overlay track accepts images or videos. Use **Overlay** in the editor to import either kind, or compose `editor.sequence` recipes with `kind: "video"` assets on an `overlay` track. General presentations, tutorials and reaction videos can share the same contract with specialized recipes. The original media stays in the project's asset library; compositing does not replace it.

Video overlays use the existing position, width, rotation, opacity and source-relative keyframe controls. Trim/split keeps source timing. The visible clip occupies `[startTime, startTime + duration)`; its source time is `inPoint + timelineTime - startTime`. The browser preview seeks and plays a native video only while that layer is visible. Browser export decodes that source time into the shared overlay transform; FFmpeg trims the source before applying the same transform. A selected same-kind take uses its own source range while retaining the clip's animation clock.

Video overlays retain audio. The inspector's **Audio volume** controls 0–100%; set zero for a silent inset without hiding its picture. Existing `update_audio` commands support video as well as audio clips. As with prior image overlays, a muted/hidden overlay track or muted overlay clip hides that layer; use volume zero for audio-only silence. Media codecs remain subject to the browser and installed FFmpeg. The browser preview clamps volume to one; the existing command/export contract permits gain up to four.

UI, HTTP commands and MCP `viral_hit_editor_edit` share `add_overlay`:

```json
{
  "type": "add_overlay",
  "clipId": "demo-inset",
  "assetId": "<project video asset>",
  "name": "Product demo",
  "sourceType": "video",
  "sourceDuration": 12,
  "inPoint": 2,
  "startTime": 1,
  "duration": 4,
  "x": 0.75,
  "y": 0.7,
  "width": 0.35
}
```

`sourceType` defaults to `image` for existing commands. Video commands require a positive `sourceDuration` and a range that fits it; the command boundary resolves the actual project-owned asset and rejects another kind or project. The editable-sequence worker probes retained media and checks the requested range against its real duration. `replace_overlay_asset` remains image-only; use same-kind video takes for video replacements. Existing timeline schema 6 already stores video clips and motion; its track compatibility now admits video overlays. Older clients that only accept image overlays cannot read these new compositions.

[Picture in picture](../recipes/picture-in-picture.json) is an editable, general recipe exposing both videos, shared duration, inset source start, inset width and audio volume. The source start plus duration must fit the inset, and the background must cover the duration. Fork the JSON to add captions, change layout, expose more controls or bind outputs from generation steps. No private brand, channel, narrator or model is built into the editor.

This adds moving layers, not masks, chroma key, arbitrary blend modes, HDR grading, transitions or full Higgsfield editor parity. Browser export and server render now share one SDR H.264 color rule: declared container or bitstream tags win, and untagged video uses limited-range BT.601, which is FFmpeg's default. A browser test exports untagged and BT.601 tagged color patches through both paths and requires every channel to agree within 8 levels; they agree within 1. Fully saturated primaries in BT.709 sources can still differ by about 10 levels in one channel because of decoder rounding. HDR, wide gamut, non-H.264 color tags, the native preview's own interpretation, a complete color-management policy and high-layer-count memory/latency benchmarks remain open.
