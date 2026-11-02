# Layer export

**Export layers** in the editor toolbar renders the timeline into separate files and downloads them as one ZIP. MCP `viral_hit_editor_render_layers` writes the same ZIP to a path. Nothing is added to the project.

| File | Contains |
|---|---|
| `picture.mp4` | The base track with its transitions, without overlays, captions or sound (H.264) |
| `overlays.mov` | Image and video overlays on transparency (QuickTime Animation, RGBA) |
| `captions.mov` | Captions, including the spoken-word highlight, on transparency (QuickTime Animation, RGBA) |
| `captions.srt` | Caption text and timing |
| `audio-voice.wav`, `audio-music.wav`, `audio-sfx.wav`, `audio-source.wav` | One 48 kHz WAV per audio role. Audio clips without a role count as music, as the editor assigns them; `source` is the sound recorded inside video clips |

A file appears only when the timeline has that part. Every file starts at 0:00, lasts the whole timeline and uses the export frame (1920×1080, or 1080×1920 for portrait). Stacking the picture, overlays and captions in another editor rebuilds the exported picture, and the WAVs add up to the exported sound. QuickTime Animation is lossless, so the transparent layers are large; editing apps such as Premiere, Final Cut, DaVinci Resolve and After Effects import its alpha channel.

## Use

- **Editor:** **Export layers** next to **Export MP4**. On windows narrower than 1280 px it shows only its icon.
- **HTTP:** `POST /api/app/projects/:projectId/timeline/layers` with the header `x-viral-hit-workspace-request: 1` returns `application/zip`.
- **MCP:** `viral_hit_editor_render_layers` takes `projectId` and `outputPath`, a new absolute path ending in `.zip`, and returns the file list.

The export needs the same FFmpeg as the MP4 export: libass when captions highlight the spoken word, drawtext otherwise.

## Keeping the layers exact

- **Transparency.** The overlay and caption layers start from a transparent canvas that requests RGBA inside the FFmpeg input; without that, FFmpeg negotiates a format without alpha before the filters run.
- **Caption opacity.** FFmpeg blends the alpha channel like a colour, so drawing text straight onto transparency squares partial opacity (a 72% outline comes out at 52%). Captions are drawn twice over black, once in colour and once with every colour painted white as the matte; the matte becomes the alpha and `unpremultiply` restores the edge colours.
- **Caption colour.** Caption scripts declare `YCbCr Matrix: None`. Without it libass squeezes colours into TV range on RGB frames, and white text turns 235. This also keeps highlighted captions white in the MP4 export when transitions run the picture through RGB.
- **Sound levels.** The MP4 export mixes clips with FFmpeg `amix`, which scales by the number of inputs. Each stem keeps every clip in the same mix and silences the other roles, so stems keep the exported levels and add up to it.

Evidence: a source integration test renders a timeline with two videos joined by a crossfade, a half-opaque image overlay, a highlighted caption, voice, music and the sound inside a video, then decodes every file; a browser test downloads the ZIP from the toolbar and calls the MCP tool. See the [validation ledger](VALIDATION.md#layer-export--2026-11-02).
