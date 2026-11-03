# Clip speed

A video on the base track can play from 0.25× to 4×. Select it in the editor and pick a **Speed**, or send `{ "type": "set_clip_speed", "clipId": "...", "speed": 2 }` through `viral_hit_editor_edit`. Setting the speed back to 1 restores the clip.

The clip keeps its source range, so its length changes: four seconds of footage at 2× takes two seconds. The clips after it on the same track move by the same amount, so cuts stay in order and gaps keep their size. Trimming or splitting a sped clip moves the source point by the speed: one timeline second of a 2× clip is two source seconds.

A clip at another speed plays without its own sound in the preview, the browser export and the FFmpeg export. Put music or a voice on an audio track instead. Images, overlays, captions and audio clips do not have a speed.

## How it is rendered

The preview plays the video element at the clip's rate and maps the timeline clock through it. The browser export reads the source frame at `inPoint + offset × speed`. The FFmpeg export first renders the clip's source range at its speed into a silent file. That file is reused while the source, range and speed stay the same, and files unused for a week are removed. Flattened, layered and transition rendering then treat it like any other clip.

## Remix

Remix reads where a reference shot speeds up or slows down. With **Repeat speed-ups and slow-downs on videos** (on by default, `keepSpeed` through MCP), a video placed in such a shot is split at the shot's middle. The second half then plays at 2× for a speed-up or 0.5× for a slow-down. Material too short for 2× gets the fastest rate it can fill, and below 1.25× the ramp is left out. Freeze frames are reported but not applied.
