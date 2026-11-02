# 018: Edit analysis of a reference (camera, pace, on-screen text)

## Decision

Remix now reads more of a reference's edit than its cut times. A new built-in harness operation, `reference.grammar`, runs beside `reference.scenes` on the same pinned project video and returns a time series of whole-frame motion and the on-screen text it read. The per-shot grammar (camera move, freeze frames, pace change, text) is assembled when remixes are listed, from the scene list and this series, so neither job depends on the other's output and old analyses keep working without it. Both jobs are local, deterministic and free, run by the durable worker, replayed from their receipts, and pinned to the tool versions that produced them (FFmpeg, and Tesseract with its languages when text is read).

## Camera motion

FFmpeg streams 96-pixel-wide gray frames (8 per second up to two minutes, fewer for longer references; at most 2,400 pairs). Each pair is compared in plain TypeScript. A coarse search on every other pixel over shifts up to four grid pixels is refined at full resolution: a parabola through neighbouring costs gives sub-pixel translation, and five log-spaced scales (±4%) with the same refinement give zoom about the centre. Shifts are tried nearest-first, and movement must beat standing still by a margin, so flat frames and stripes that reveal motion along only one axis never invent movement. Memory stays at two frames. Synthetic tests recover a 2.3 by −1.6 pixel shift within 0.35 pixels and a 3% zoom within 0.8 percentage points.

Per shot, samples whose frame pair crosses a cut are excluded. The summed motion becomes the camera's travel (content moving left is the camera panning right): zoom beyond 5%, pan or tilt beyond 8% of the frame, whichever is largest relative to its threshold; otherwise handheld when the frame moves back and forth, or static. Frames that do not change for 0.4 s are freeze frames, and a shot whose median activity changes 2.5 times between its halves speeds up or slows down.

## On-screen text

When Tesseract is installed, up to 60 frames are read (one per second, or evenly spaced for longer references), three at a time, each twice: as is, and with only what is brighter than a blurred copy kept, thinned lines removed and thresholded. The second reading isolates light caption strokes over busy footage, where page layout analysis on the raw frame fails. Words under 75% confidence, oversized "words" made of texture, lines without two letters or digits and stray quote or bracket marks from box edges are dropped. Readings at the same place keep the more confident one. Text seen at the same place in consecutive samples, including a partial reading of the same caption, becomes one segment, and small text present for nearly the whole video (a watermark or handle) is dropped. At most 200 segments are kept.

## Rebuilding

With `keepCamera` (the default), a still image in a shot that zooms, pans or tilts keeps its base clip and also gets an image overlay with two linear keyframes. Overlays are placed by their centre, with a width relative to the frame, so the width is chosen to cover the frame throughout the move. The frame is the one both exporters will use: the first visible visual of the timeline after the build, measuring local files when an upload did not record its size. Zooms are limited to 6–35%, pans and tilts to 3–12% of the frame each way, and the overlay is never wider than the editor's 200% limit; a move that cannot fit is skipped. Video materials keep their own motion.

With `keepText`, text segments become captions at the same times. The editor shows one caption at a time, so text on screen together is joined top to bottom and changes whenever any of it changes. Each caption is placed by its distance from the bottom, with a width and size from the text's box.

## Evidence and limits

Unit tests cover motion recovery, flat and striped frames, move classification, freeze and pace signals, TSV parsing and cleanup, merging readings, segment tracking, caption intervals, and keyframes that keep the still covering the frame. An integration test generates a reference with a static titled shot, a pan and a captioned zoom, runs both jobs through the real worker, and reads static, pan right and zoom in with "SAVE THIS HACK" and "PART 2". Building with two images makes two overlays moving in the right directions and captions at the right heights, and the rendered video changes during the zoom. The Remix browser test shows "Pan right" on the panning shot and checks the overlay's keyframes through HTTP and MCP.

Whole-frame motion cannot tell a camera move from a large subject crossing a still frame. Whip pans beyond about a third of the frame per second at 8 samples per second are underestimated. Text reading is approximate (stylized fonts, small text, text over bright areas, box edges read as characters) and depends on installed languages. Speed changes are reported but not applied, because the editor has no clip speed yet.
