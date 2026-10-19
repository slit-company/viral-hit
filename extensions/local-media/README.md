# Optional local media engines

This package connects **music2-gen 0.4.0** and **vid2-gen 0.6.0** to the existing worker, binary receipts, Assets and editor. Neither engine is installed with the studio. Requires macOS/Linux, Node 24, and FFmpeg/ffprobe for video. Bun 1.4.0 is installed as music2's pinned dependency.

From this directory:

```sh
npm ci
npm test
npm run build
```

The package explicitly permits the pinned Bun/esbuild install scripts for npm versions enforcing approvals. Finish installation before starting the worker: the adapter checks the Bun binary and never invokes the launcher's automatic install fallback for a missing runtime.

From the repository root, set the same environment for studio, worker and MCP:

```sh
export VIRAL_HIT_LOCAL_MEDIA_DIR="$PWD/extensions/local-media"
export VIRAL_HIT_ADAPTERS_DIR="$VIRAL_HIT_LOCAL_MEDIA_DIR/dist/adapters"
export VIRAL_HIT_FFMPEG="$(command -v ffmpeg)"
export VIRAL_HIT_FFPROBE="$(command -v ffprobe)"
pnpm dev
```

If other adapters are installed, copy these generated descriptor/module pairs into the existing adapter directory instead of replacing it. Restart consuming processes together. Keep engine installations immutable while jobs are pending: lockfile/version checks do not verify every executable file's contents.

Open **Runs → Recipe library**, import `recipes/music2-render.json` and `recipes/vid2-render.json`, inspect, and install. This retains existing recipes. Each exposes an editable JSON document; the examples are starting points, not the only compositions. Queue, wait for **Asset ready**, then add the asset to the timeline or use it as a take. Authored JSON remains in the run input. Vid2 scenes/layers do not yet round-trip into separate editor clips; music2 tracks currently produce one mixed WAV.

| Engine | Enabled | Bridge limits |
|---|---|---|
| music2 | Built-in synthesized instruments, patterns/notes, layers, automation, effects, sections, seeds, loops | 16 tracks, 32 sections/arrangement entries, 60s including non-loop tail, 20,000 resolved events; no sampled instruments, external audio files or plugins |
| vid2-render | Procedural timeline, color sources, bundled fonts, text/shapes, stage/kinetic components, transitions/effects, built-in synthesized audio/SFX accepted by upstream validation | 24 scenes, 24 layers/scene, 60s, numeric 1–60fps, ≤1080p pixels, H.264 MP4; no filesystem sources, custom fonts/LUTs, capture sessions, generated assets, TTS or remote providers |

`vid2-compose` additionally accepts verified project image/video/audio sources; see [Compose project media](#compose-project-media) below. The original `vid2-render` operation retains its procedural-only contract.

Documents are limited to 16,000 characters and bounded nesting/node count. Upstream validators determine format correctness. Video runs one segment at a time (`--jobs 1`); FFmpeg can still use multiple threads. Validation has a 10s deadline, rendering 40s, and accepted output is ≤64 MiB. These fit the harness's 60s poll budget. Larger jobs need a persistent background-process protocol first. Limits are not OS memory/disk quotas.

Children receive a minimal environment without inherited provider credentials or Bun overrides. Output is bounded; temporary files are removed on ordinary completion/failure. AbortSignal/deadline termination kills the POSIX process group, including Bun/FFmpeg descendants. User cancellation is currently observed between harness steps, so a render can finish before that request is processed. A host crash can leave temporary files; Windows and cross-host process recovery remain open.

Local input/render errors become failed jobs with concise diagnostics; dependent materialization blocks. Runtime/configuration mismatches preserve recovery without switching tools. Existing binary receipts recover before parsing/rendering. Publication failures remain ambiguous for receipt recovery. This bridge has no remote generation side effects.

After installing the studio too, verify real media with the FFmpeg variables above:

```sh
npm run test:live -- /absolute/path/to/evidence
```

This creates an isolated database, runs both engines through the real harness/data-URL loader, materializes and attaches output, recovers receipts, exports a mixed MP4, checks streams and fully decodes it. The fixture produces a 4s WAV and 4s 640×360 video (2.3s + 2s minus a 0.3s transition). A 100ms sampler reports observed aggregate child RSS, not an exact peak/cap. Evidence is retained.

See [measurements](../../docs/PERFORMANCE.md), [source audit](../../docs/LOCAL-MEDIA-SOURCES.md) and [architecture decision](../../docs/architecture/002-optional-local-media-engines.md).

## Compose project media

`ext.vid2-compose` adds project-backed file sources without adding engine dependencies to the studio. Import `recipes/vid2-image-motion.json` to animate an image with a title, duration and bounded zoom. Import `recipes/vid2-narrated-scene.json` to combine a scene video, detail image, music and narration with independent volume controls. The generated form uses the shared SEED controls and existing project asset picker.

Both are editable recipe manifests, not hardcoded layouts in the application. Fork a recipe and change its structured `input.timeline`, exposed parameters or output dimensions to build a different composition. The operation accepts `{timeline, assets}`. `timeline` is an authored vid2 Timeline v1 object, limited to 16,000 serialized characters and the existing complexity/frame/pixel budgets. `assets` must contain all six named slots (`image-1`, `image-2`, `video-1`, `video-2`, `audio-1`, `audio-2`), each set to a project asset ID or explicit null. At least one file source must be used. For example:

```json
"sources": {
  "hero": { "type": "image", "path": "asset:image-1" },
  "footage": { "type": "video", "path": "asset:video-1", "muted": true },
  "narration": { "type": "audio", "path": "asset:audio-1" }
}
```

A previous `asset.materialize` node can bind its `/assetId` to `/assets/video-1` or another matching slot, so separately generated images, footage and scores compose in one durable workflow. Project, kind, byte count and content hash are pinned together. Recipes never receive host file paths.

The bridge stages only selected verified bytes, checks container signatures and FFprobe metadata, and substitutes temporary paths in an execution copy. Images are PNG/JPEG/WebP (32 MiB); videos MP4/WebM (64 MiB); audio WAV/MP3/M4A/FLAC/Ogg (32 MiB). Images/video are limited to 16 megapixels; moving/audio sources to one hour; audio to eight channels. Six slots declare 256 MiB total. Arbitrary URLs, file paths, playlists, SVG, capture sessions, providers, TTS, custom fonts and LUT files are rejected. These are parser/input limits, not an OS sandbox.

Composition has a 180s harness deadline, 5s per input probe, 10s timeline validation and 120s rendering, one segment at a time. Cancellation propagates to the process group during rendering. Output remains ≤64 MiB. Published binary receipts recover before reading sources. The two earlier adapters retain their existing deadlines.

The rendered MP4 can be trimmed, split, mixed or used as a replacement take in the editor. Its original authored timeline remains in the run; native vid2 layers do not yet become individual editor clips.

Run `npm run test:compose -- /absolute/evidence-directory` with the FFmpeg variables above. It executes actual music2 and vid2, chains materializer outputs into optional media slots, checks 720×1280 and 1280×720 four-second/120-frame outputs, confirms an 880 Hz test tone in the narration channel, preserves source hashes, recovers receipts and exports through the editor. The test tone is not generated speech. Captured frames support visual review; no model-quality claim follows.
