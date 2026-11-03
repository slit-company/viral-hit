# Remix a hit

**Remix** in the project sidebar keeps the edit of a video that works and swaps in your own shots. Choose a reference video from the project, press **Find the cuts**, pick your images and videos in the order they should appear, and press **Build the remix on the timeline**. The result is an ordinary editable timeline: every clip, the soundtrack and the transitions can be changed in the editor.

## What is kept

The edit grammar Viral Hit keeps covers the timing, the camera and the words on screen:

- **Cut times.** Local visual-cut detection (the same FFmpeg scene detector as [scene detection](SCENE-DETECTION.md), run through the durable worker, no credits) finds every shot. Each new shot starts exactly where the reference cuts.
- **Pace.** Shot count, average shot length and cuts per minute are shown with a bar of the reference's rhythm.
- **Soundtrack.** **Keep the reference soundtrack** extracts the reference audio once as a project audio asset and places it as music under the new shots.
- **Joins.** Optionally, every cut gets the same [transition](TRANSITIONS.md).
- **Camera moves.** Each shot is labelled static, handheld, zoom in or out, pan left or right, or tilt up or down. With **Give still images the reference's camera moves** (on by default), a still placed in a moving shot also gets a full-frame overlay that zooms, pans or tilts the same way, so a slideshow of generated images moves like the original. The still stays underneath on the main track; delete the overlay to keep it static.
- **On-screen text.** Hook titles and captions are read with their position. **Copy on-screen text as editable captions** places them as captions at the same times and heights; text shown together becomes one caption. The words are a starting point to rewrite.
- **Pace changes.** Freeze frames and shots that clearly speed up or slow down are marked on the shot list. With **Repeat speed-ups and slow-downs on videos** (on by default), a video in such a shot plays its second half at 2× or 0.5× through [clip speed](CLIP-SPEED.md). Freeze frames are reported, not applied.

## How the edit is read

**Find the cuts** queues two local jobs on the same pinned video, with no credits: cut detection, and an edit analysis that compares small gray frames (8 per second for references up to two minutes) to measure how the picture moves, then reads up to 60 sampled frames for text. The shot list shows the cuts first and adds camera, pace and text when the second job finishes.

Reading text needs [Tesseract](https://tesseract-ocr.github.io/) on the studio machine (`brew install tesseract tesseract-lang` on macOS, `apt install tesseract-ocr tesseract-ocr-kor` on Debian/Ubuntu); English, Korean, Japanese and Chinese are used when installed, and `VIRAL_HIT_TESSERACT` points at another binary. Without it the page says so and only camera and pace are read. Each frame is read twice, as is and with only what is brighter than its surroundings kept, so light captions over busy footage are found; low-confidence words, texture and a small watermark present for the whole video are dropped.

## How material fills the shots

Material repeats in the order you picked it when the reference has more shots. A shot takes the next image (held for the whole shot) or the next video long enough to fill it, starting from the video's beginning. If no video is long enough, the longest one plays and the rest of that shot stays black, so the cut times never move; the shot list marks these. Images and videos already in the project can be used; generate new ones in Studio or Cinema first.

## Agents

`viral_hit_remix` offers the same operation: `analyze` (`assetId`, optional sensitivity, minimum shot length, maximum shots and `readText`) queues detection and returns a run, `list` returns each analysis with its grammar (per-shot `camera`, `speed` and `text`, plus `edit.texts` with positions), and `build` (`requestId`, ordered `materials`, `keepSoundtrack`, `keepCamera`, `keepText`, `keepSpeed`, `transition`) appends the remix after the current timeline. HTTP uses `/api/app/projects/:projectId/remix`.

## Getting good results

Detection follows visual changes, so a fade, flash or fast motion can add or merge a cut; adjust it on the timeline afterwards. References can run up to ten minutes and 64 MiB. Camera moves are measured as whole-frame motion, so a subject crossing a still frame can read as a pan. Text reading works best on clear, large lettering away from bright areas. Speed ramps apply to video material at 2× or 0.5× for the second half of the shot. To plan new shots from a reference, use [storyboards](STORYBOARDS.md) or Cinema. See [decision 018](architecture/018-edit-analysis.md).
