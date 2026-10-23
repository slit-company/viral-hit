# Local role collage

A small processor that shows how reference roles reach a model. Copy this directory into your operator provider directory and restart the Studio and workers. Install FFmpeg separately and set `VIRAL_HIT_FFMPEG` if needed.

**Subject on style** declares `"referenceRoles": ["subject", "style"]`. It receives `input.references`, a list of `{ url, role }` in request order, and reads each file with `readMedia`. The subject image is placed in the center of a 512×512 PNG; the style image, if any, becomes a blurred background. Swapping the roles swaps the result.

This is not a generative model. A motion transfer, subject replacement or style transfer model uses the same declaration to learn which reference is the subject, the style or the pose.

