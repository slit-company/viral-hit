# Editable output from any workflow

`editor.sequence` prepares project media as separate timeline clips. It is a built-in, local step with no generation provider. Use it after image, video or audio generation, source collection, or direct uploads. The editor stays unchanged until you accept the prepared result.

## Try it

In a project, open **Runs** and select **Build an editable image story**. Choose a project image, title and duration. Queue the workflow, wait for **Edit ready**, then choose **Add editable sequence**. The image and title become separate clips after your current timeline. Select the caption to change its text; trim or replace the image independently.

**Build an editable scene** uses a video, overlay image, background music and narration, plus a caption. Its music and voice occupy separate tracks. All chosen audio/video sources must cover the requested duration. The source video's audio is muted while the picture remains visible. The recipe does not synthesize narration or promise automatic beat alignment or ducking.

Both manifests live in `recipes/`. Use **Recipe library** to fork their parameters, expose another field or export your version. An editable sequence is not tied to these two layouts, an advertising brand, vid2 or a particular AI provider.

## Author a sequence

The [JSON Schema](schemas/sequence.schema.json) describes the structural contract. The runtime also checks relationships that JSON Schema does not express: unique IDs, source/track kinds, total counts, source ranges, visual coverage and cross-track visual/caption overlap. Regenerate the schema with:

```sh
pnpm --dir apps/studio recipe sequence-schema ../../docs/schemas/sequence.schema.json
```

A recipe node uses `operation: "editor.sequence"`, a version and the following input shape:

```json
{
  "schemaVersion": 1,
  "title": "A reusable story",
  "assets": {
    "hero": { "assetId": "selected-project-image", "kind": "image" }
  },
  "tracks": [
    {
      "id": "visual", "name": "Visual", "kind": "video",
      "clips": [
        { "id": "shot", "type": "media", "source": "hero", "startTime": 0, "duration": 3 }
      ]
    },
    {
      "id": "title", "name": "Title", "kind": "caption",
      "clips": [
        { "id": "headline", "type": "caption", "text": "MAKE IT YOURS", "startTime": 0, "duration": 3 }
      ]
    }
  ]
}
```

Times are seconds relative to the beginning of this sequence. `video` tracks accept image/video sources, `overlay` tracks accept images, `audio` tracks accept audio, and `caption` tracks accept text. Media supports source in-points, volume, mute, fades and audio roles. Image overlay transforms use normalized coordinates; captions expose font scale, width and bottom offset. Output dimensions follow the existing editor/export behavior.

Inputs are limited to 16 local files, 64 MiB per file and 512 MiB overall; an edit has at most 16 tracks, 128 clips and one hour of content. Existing plus appended tracks must fit the editor's 64-track limit. All media is verified against project membership and content hashes. Preparation and acceptance probe private copies to measure source ranges. FFprobe must be installed, or set `VIRAL_HIT_FFPROBE`. FFmpeg is needed for export. Gaps, overlapping base visuals/captions and unknown unsupported fields are rejected rather than approximated.

## Connect generated sources

For a preceding `asset.materialize`, `reference.youtube` or `reference.sample` node, declare it in `dependsOn` and bind its `/assetId` to `/assets/<source-name>/assetId`. Keep a valid placeholder ID in the input until binding occurs. The source kind must match the producer's kind. Admission binds the complete project/asset/hash/size identity automatically. Do not supply or bind internal `pins` yourself. Clip fields under `/tracks/…` can also use dependency outputs, such as generated caption text; the final resolved sequence must pass the same validation.

The completed job contains an edit digest, title, duration and clip/track counts. It is not a flattened media asset. The final resolved sequence remains in the durable job input, so its authored structure can be inspected independently of a render.

## Accept and edit

HTTP `POST /api/app/projects/<project-id>/runs` and MCP `viral_hit_runs_change` use the existing `attach` action with `runId`, `jobId` and `expectedRevision`. CLI calls the same application service:

```sh
pnpm --dir apps/studio harness attach <project-id> <run-id> <job-id> <expected-revision>
```

Acceptance rechecks the originals and appends tracks after the current timeline duration. Stale revisions fail without changing anything. Existing edits and locked tracks are preserved. Successful command receipts recover repeated requests, and stable clip/track IDs refuse a second copy still present in the timeline. Receipts have the existing bounded retention; this is not a permanent publication/acceptance ledger. A sequence cannot be applied as a single clip's take.

This contract does not yet import arbitrary native vid2 layers, keyframes, transitions, masks or foreign timeline formats. Those need explicit converters that preserve supported semantics and report unsupported ones. Actual vid2 flattening remains an independent optional rendering path.

Empty, visible, unmuted and unlocked tracks of the matching kind are reused on acceptance, so new clips are visible in an empty editor. Existing track names, IDs and settings are retained; occupied, hidden, muted and locked tracks stay untouched. Additional tracks are appended only when needed.
