# Remix a hit

**Remix** in the project sidebar keeps the edit of a video that works and swaps in your own shots. Choose a reference video from the project, press **Find the cuts**, pick your images and videos in the order they should appear, and press **Build the remix on the timeline**. The result is an ordinary editable timeline: every clip, the soundtrack and the transitions can be changed in the editor.

## What is kept

The edit grammar Viral Hit keeps today is the timing of the edit:

- **Cut times.** Local visual-cut detection (the same FFmpeg scene detector as [scene detection](SCENE-DETECTION.md), run through the durable worker, no credits) finds every shot. Each new shot starts exactly where the reference cuts.
- **Pace.** Shot count, average shot length and cuts per minute are shown with a bar of the reference's rhythm.
- **Soundtrack.** **Keep the reference soundtrack** extracts the reference audio once as a project audio asset and places it as music under the new shots.
- **Joins.** Optionally, every cut gets the same [transition](TRANSITIONS.md).

## How material fills the shots

Material repeats in the order you picked it when the reference has more shots. A shot takes the next image (held for the whole shot) or the next video long enough to fill it, starting from the video's beginning. If no video is long enough, the longest one plays and the rest of that shot stays black, so the cut times never move; the shot list marks these. Images and videos already in the project can be used; generate new ones in Studio or Cinema first.

## Agents

`viral_hit_remix` offers the same operation: `analyze` (`assetId`, optional sensitivity, minimum shot length and maximum shots) queues detection and returns a run, `list` returns each analysis with its grammar, and `build` (`requestId`, ordered `materials`, `keepSoundtrack`, `transition`) appends the remix after the current timeline. HTTP uses `/api/app/projects/:projectId/remix`.

## Limits

Detection is visual: fades, flashes and fast motion can add or merge cuts, and the detector handles references up to ten minutes and 64 MiB. Text overlays, camera moves, speed ramps and the meaning of each shot are not extracted yet; for planning new shots from a reference, use [storyboards](STORYBOARDS.md) or Cinema.
