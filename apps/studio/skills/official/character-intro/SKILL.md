---
name: character-intro
description: Make an exact five-second character introduction from supplied character images, with five consistent keyframes, one animated plate and optional narration.
---

# Five-second character intro

Read `consistent-characters` first. This skill makes one exact five-second piece; longer reels belong in `hit-remake` or `storyboard`.

1. **Identity.** Use only images the user supplied. With several, prefer the one with unobstructed defining features, clear silhouette and neutral pose; ask once if two are equally good. Create or reuse a character with `viral_hit_character` and write the rules that must never change (face, proportions, wardrobe, palette, signature props).
2. **Beats.** Plan five one-second beats. With a motion reference, map source beat 1 to target beat 1 and so on, transferring camera grammar, rhythm and energy but never the source's person, wardrobe, room, text or brand. Without one, write five beats yourself. Every beat needs a *visible change*: a start state and a different end state of the character or a prop it holds. Camera movement alone is not a beat.
3. **Keyframes.** Generate one 9:16 still per beat with the character references attached. Review all five side by side and reject drift, extra people, generated text or a different face.
4. **Animate.** Show the model, length, prompt, keyframes and cost together and wait for approval. Prefer a model that takes several reference images or first/last frames (see `video-model-routing`). Generate one five-second plate; a slideshow of the keyframes fails.
5. **Voice (optional).** Write or confirm one short line that fits in five seconds. Choose a voice that matches the character's written persona, not just its gender; never imitate a real person's voice without consent. Generate it with a speech model.
6. **Finish.** Place the plate and voice on the timeline, add captions, keep exactly 5.0 seconds with a clean ending, normalize speech to about -16 LUFS and export. Watch it start to end and confirm motion in every second before calling it done.

