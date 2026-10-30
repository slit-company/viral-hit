---
name: voiced-short
description: Finish a short with narration, timed captions and music, checking speech against the script and loudness before export.
---

# Voiced, captioned short

1. **Script to fit.** Measure the footage first. Write about 2.5–3.5 spoken words (or 5–7 Korean syllables) per second of footage. Open with the hook in the first second. Show the script before generating any voice.
2. **Voice.** Pick a speech model from `viral_hit_generation_models` (`kind: "audio"`). Choose a voice that fits the speaker's written persona and language. Generate line by line when timing to cuts matters. Listen to every line and regenerate any that drop, add or mispronounce words.
3. **Place it.** Put voice lines on the audio track at the cuts they belong to. Keep the first word within the first half second.
4. **Captions.** Time one caption per phrase to the actual voice, not the script estimate; keep two lines or fewer and inside the safe area away from platform buttons. Import an SRT with `viral_hit_editor_import_srt` when you have one.
5. **Music.** Lay music under the voice and lower it while anyone speaks. Without a voice, the music carries the piece.
6. **Loudness.** Aim for about -14 to -16 LUFS integrated with speech clearly above music. A finished voiced short quieter than -24 LUFS is not ready.
7. **Export and review.** Render, then watch and listen to the whole thing. Report any line, caption or level you changed or could not fix.

