# Editable overlay motion

Image and video overlays support position (`x`, `y`), output-relative width, opacity and rotation keyframes. This is a generic editor capability: the inspector, HTTP editor commands, MCP `viral_hit_editor_edit`, and portable `editor.sequence` recipes share one validated contract. The optional `animated-image-story` recipe demonstrates it without requiring model credentials or a specialized advertising workflow.

## Contract

Timeline schema 6 adds optional `motion` to image overlay clips. Version 1–5 timelines migrate on read; existing caption/overlay settings survive version 5 migration. An absent `motion` keeps static behavior.

```json
{
  "type": "set_overlay_motion",
  "clipId": "overlay-id",
  "motion": {
    "version": 1,
    "keyframes": [
      { "id": "start", "time": 0, "x": 0.25, "y": 0.3, "width": 0.2, "opacity": 0.25, "rotation": -15, "easing": "ease-in-out" },
      { "id": "finish", "time": 3, "x": 0.7, "y": 0.45, "width": 0.4, "opacity": 1, "rotation": 15, "easing": "linear" }
    ]
  }
}
```

Each pose contains all five values. Times are **source-relative seconds**, evaluated at `clip.inPoint + timelineTime - clip.startTime`. IDs are unique, times strictly increase, and each overlay has 1–32 keyframes. Coordinates and opacity range from 0–1; width from 0.05–2; rotation from −180–180 degrees. Rotation interpolates the supplied degrees directly. Easing belongs to the segment leaving a keyframe: linear, quadratic ease-in/ease-out, or symmetric quadratic ease-in-out. Before the first and after the last keyframe, the nearest pose holds.

Splitting/trimming crops the original motion, including its easing curve. Moving a clip retains its local motion. Extending an animated image retains its source in-point and holds the final pose; it does not automatically stretch keyframe times. Keys outside a trimmed range remain stored, but are disabled in the inspector until that range is restored. Setting `motion: null` removes animation and restores the clip's static transform.

`update_overlay` accepts optional timeline `atTime`. When an animated transform changes, `atTime` is required; it inserts or updates the pose at the clamped clip position, retaining existing keyframe IDs. Fade-only changes remain clip-wide. The inspector, preview drag and arrow-key nudges supply this time. Clip fades multiply the interpolated opacity by the minimum of the fade-in/out envelopes. The overlay is visible on `[startTime, startTime + duration)`.

## Persistence and rendering

Motion uses the existing revision-checked commands and undo/draft recovery. Pose changes invalidate a rendered-media receipt. Disjoint keyframe insertions merge by stable ID and chronological order; concurrent different keys at the same time require review. The standalone sequence JSON schema includes the same bounds; motion on audio, captions or base visual tracks is rejected.

The browser preview and Canvas exporter evaluate the same pure interpolation. Preview and both exporters share the current output-frame policy: the first visible, unmuted visual determines 1920×1080 or 1080×1920. Other source ratios are contained in that frame; selecting a later portrait clip does not change a landscape project’s output. The preview fits both available width and height without distorting the frame. The server compiles only validated numerical values into FFmpeg expressions. Opacity/rotation run at fixed input dimensions, followed by dynamic scaling; rotation paints a transparent background every frame to avoid retained-buffer trails. Rotation working canvases over 64 megapixels fail with an actionable error. No dependency, remote call or model runtime is added to the default studio.

This contract does not provide arbitrary Bezier curves, masks, perspective, transition graphs, or import of foreign native keyframe formats. Those need explicit adapters with semantic validation.

## Verification

`overlay-motion.test.ts` covers interpolation, source-time edits, migration, strict inputs, sequence transport, invalidated exports, incremental commands and concurrent inserts. `overlay-render.test.ts` compares real FFmpeg pixels with expected poses, including delayed start and half-open visibility. `tests/e2e/overlay-motion.spec.ts` edits and reloads keyframes through the UI, applies the same contract through MCP, and checks actual browser/server MP4 frames. Fixtures establish editing/rendering behavior, not provider generation quality or competitor parity.

[Video layers](VIDEO-OVERLAYS.md) reuse these same transforms with decoded source frames, source-range trimming and audio. The image-overlay examples below remain historical image-only verification; video-specific evidence is recorded separately.
