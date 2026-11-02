# Transitions

A transition decides how a clip on a base visual track enters. Select an image or video clip in the editor and pick one in **Transition**. **Apply to all cuts** copies the selected transition to every clip that directly follows another clip; **Remove all** clears them.

| Kind | What you see |
|---|---|
| Crossfade | The previous picture dissolves into the new one |
| Dip to black / white | The picture fades to a colour, then the new clip fades in |
| Wipe left / right / up / down | A hard edge sweeps across and reveals the new clip |
| Slide left / right / up / down | The new clip pushes the previous picture out of frame |
| Circle open | The new clip opens from the centre with a soft edge |
| Zoom in | The previous picture zooms in, then gives way to the new clip |

Transitions never change timing. A transition plays during the first `duration` seconds of the incoming clip, over the last visible frame of the clip that ends exactly where it starts. After a gap, or for the first clip, it starts from black. The duration is 0.1–3 s and cannot exceed the incoming clip. Splitting a clip keeps the transition on the left part. **Play** previews transitions in motion: playback continues from one clip into the next.

## Commands

UI, HTTP commands and MCP `viral_hit_editor_edit` share two operations:

```json
{ "type": "set_transition", "clipId": "shot-2", "transition": { "kind": "crossfade", "duration": 0.5 } }
{ "type": "set_transitions_at_cuts", "transition": { "kind": "slide-left", "duration": 0.4 } }
```

Use `"transition": null` to clear one clip, or every base-track transition with `set_transitions_at_cuts`. Overlay, audio and caption clips have no transitions, and locked tracks reject the change.

## One look in every renderer

`core/editor/transition-contract.ts` defines each kind as per-frame layer weights, offsets, scales and masks. The editor preview turns them into CSS, the browser export draws them on a canvas, and the server export renders FFmpeg `xfade` segments in planar RGB. The kinds were chosen because FFmpeg implements them; the shared math was derived from and tested against FFmpeg's output, so all three renderers show the same frame at the same time.

Evidence: a source test renders every kind with real FFmpeg and compares pixels with the shared math, including the held last frame of a video and an incoming in-point. A browser test picks a transition in the inspector, checks the preview's CSS mask, then decodes browser and server MP4 exports for a wipe, a crossfade and the radial mask. See the [validation ledger](VALIDATION.md#editor-transitions--2026-11-02).
