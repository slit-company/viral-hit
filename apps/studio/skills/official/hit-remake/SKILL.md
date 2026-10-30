---
name: hit-remake
description: Remake a proven video shot by shot with any connected model, then edit and export it in Viral Hit.
---

# Remake a hit

Use when the user brings a video that performed well and wants a new version with a different subject, character, product, message or language. The goal is to keep what made it work (hook timing, beat order, pacing, framing, energy) and change only what the user asked to change. Read `storyboard`, `video-model-routing` and, when a person or mascot must stay the same, `consistent-characters` first; this skill only adds the remake-specific order.

1. **Intake.** Import the source with `viral_hit_asset_import` or run the `youtube-reference` / `project-video-reference` recipe through `viral_hit_runs_change`. Confirm the user may use it. Run `detect-video-scenes` to split it at visual cuts. Watch and listen to the source; five sampled frames are not an analysis.
2. **Break it down.** Use the storyboard `prepare-reference` action on the detected scenes. For each beat, record what you observed (shot size, action, camera, on-screen text, sound) separately from what you infer. Mark the hook beat and the payoff beat.
3. **Write the remake plan.** One shot per beat. For every shot write *preserve* (timing, framing, motion, energy) and *change* (subject, wardrobe, product, text, language). Pick a model per shot with `video-model-routing`: image-to-video with first/last frames when composition must match, reference-to-video or video edit when motion must follow the source, motion control or motion transfer when a performance must carry over. Show the plan, models, lengths and expected cost, and wait for approval before any paid call.
4. **Make keyframes first when identity matters.** Generate or edit a still per shot with the character references attached, review them side by side with the source frames, then animate only approved stills.
5. **Generate and accept.** Generate approved shots with a fresh request ID each; on an uncertain outcome inspect the same request instead of resubmitting. Compare each result with its source beat and accept one take per shot with honest notes. A shot that only moves the camera when the source subject moved fails.
6. **Cut it.** Assemble accepted shots into an editable sequence and attach it to the timeline. Match the source cut points first, then add voice (`voiced-short`), music and captions. Keep the original first-second hook timing unless the user changed it.
7. **Export and review.** Render with `viral_hit_editor_render`, watch the whole result next to the source, and report what matches, what differs and what you could not verify. Publishing is a separate step (`publish-and-measure`).

Never copy a real person's face, a brand's logo or on-screen text from the source into the remake unless the user owns it and asked for it.

