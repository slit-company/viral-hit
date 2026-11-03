# Ducking music under voices

Music and sound clips can step aside while someone speaks. Select a music or sound clip in the editor and choose how far **Lower under voice** takes it down: a little (−6 dB), medium (−12 dB) or a lot (−18 dB). The level starts going down a quarter second before each voice clip and comes back half a second after it. Voice lines less than 0.75 seconds apart count as one, so the music does not pump between sentences.

Music added to a timeline has medium ducking turned on. This includes clips added in the editor, through MCP `add_clip` with `audioRole: "music"`, and Remix soundtracks. Existing timelines keep their clips as they were. Voice clips are the ones whose `audioRole` is `voice`, such as text-to-speech results. Muted voice clips and clips on muted tracks do not lower anything.

## One curve everywhere

`core/editor/audio-ducking.ts` computes the voice spans and a piecewise-linear gain curve. The preview applies it to each audio element as the playhead moves. The browser export applies it in its Web Audio mix. The FFmpeg export writes the same curve as a `volume` expression in clip time (at most 64 voice spans per clip), and that path is shared by MP4 rendering and layer export. A clip's own volume and fades still apply on top.

## Agents

`viral_hit_editor_edit` accepts `{ "type": "update_audio", "clipId": "...", "patch": { "ducking": { "level": 0.25 } } }`. `attack` (0.05–2 s) and `release` (0.05–3 s) are optional, and `"ducking": null` turns it off. Asking to duck a voice clip, a video clip or a caption is refused.
