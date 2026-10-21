# Visual cuts to editable clips

In a project's **Runs**, select **Split a video at visual cuts**, choose an owned video, adjust sensitivity/spacing/count and queue the workflow. The worker scans the video locally, then prepares a sequence. Review the scene buttons and original-video preview in the completed detection step. Select **Add editable sequence** on the completed sequence step to append separate clips to the timeline. Each clip retains its source in/out points and original audio; the source file is unchanged.

The recipe is ordinary portable JSON at `recipes/detect-video-scenes.json`. Fork it for interviews, screen recordings, montages or other situations; change its exposed inputs or compose its steps with independently authored recipes/adapters. UI, HTTP, MCP and CLI use the same admitted plan and worker. There is no campaign-specific state or additional execution engine.

## Detection and limits

The processor uses [FFmpeg scdet](https://ffmpeg.org/ffmpeg-filters.html#scdet), scales frames into a 320×320 bounding box and samples at 8 fps. Threshold is 1–100 (default 10); lower values retain subtler visual changes. Minimum scene length is 0.125–30 seconds (default 0.5), and maximum scenes is 1–64 (default 24). Stronger transitions are preferred when cuts are too close or exceed the count. All ranges together cover the full container duration: merged transitions do not discard footage. A source shorter than the requested minimum remains one complete scene.

This is visual change detection, not understanding of speech, objects, actions or narrative. Timing is quantized by sampling and recorded to millisecond precision; inspect and trim the editable clips when exact frames matter. Flashes, motion and fades can cause extra or missed cuts. Static footage normally yields one scene. Audio continues from the original intervals; it does not influence detection.

Inputs must be verified local project videos, at most 64 MiB, ten minutes and 16,777,216 decoded pixels. FFmpeg/FFprobe are existing separately configured tools; no model, package or background service is added. Scans use one decoder thread and one filter thread, a 180-second scan deadline and a 1 MiB combined diagnostic limit. FFmpeg's 64 MiB maximum allocation applies to individual allocations, not total process memory. Source copying consumes at most another 64 MiB temporarily. These limits are not measured host memory/latency guarantees.

## Composition contract and recovery

`reference.scenes` version `1` accepts `{assetId, threshold?, minDuration?, maxScenes?}`. Plan admission adds the project/asset/hash/size pin and a tool identity from configured executable paths, FFmpeg/FFprobe version output and algorithm revision. This identity is not a hash of all executable/dependency bytes. Keep runtime installations stable while jobs are pending. Missing tools fail admission; an incompatible filter/build can fail the scan.

The operation returns the verified original video asset record, `analysis` (algorithm, settings, duration, candidate count and contiguous scenes) and `tracks` containing editable clip specifications. It does not register duplicate media. A video-producing dependency can bind `/assetId` into the detector; admission binds the rest of the verified identity. The bundled second step binds `/assetId` and `/tracks/0/clips` into `editor.sequence`, which retains its ordinary source verification and explicit revision-checked attachment.

The detector works on a private verified copy and rechecks the original before accepting a receipt. Completed receipts survive worker restart without rescanning and revalidate original bytes before exposing success. A failed or canceled local scan can be retried through the durable harness; changed tools or source bytes cannot silently replace the pinned input. Cancellation waits for the scan process to close, escalating termination after five seconds, before removing its temporary source. Host crashes can leave orphan temporary directories; cleanup is separate work. See [bounded adapter execution](architecture/006-bounded-adapter-execution.md).

Actual three-color-cut video, audio and editable export checks live in `scenes.integration.test.ts`; browser review/seek/attachment and customized recipe admission live in `tests/e2e/scenes.spec.ts`. These deterministic fixtures establish the workflow, not detection accuracy on a representative video collection or parity with another product.
