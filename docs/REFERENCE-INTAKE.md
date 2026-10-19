# Reference video intake

The local `reference` CLI acquires a video, verifies actual media, registers an immutable project original and extracts five PNG samples at 0/25/50/75/95% of container duration. Original audio remains in the video. Frames are at most 640 pixels wide. The result is JSON containing local project asset IDs, hashes, dimensions, duration and sample timestamps. It does not contain signed CDN URLs or raw DM bodies.

From `apps/studio`:

```sh
pnpm reference --project PROJECT_ID --file /absolute/source.mp4
pnpm reference --project PROJECT_ID --youtube VIDEO_ID --height 720
pnpm reference --project PROJECT_ID --instagram-item /absolute/authorized-item.json
```

YouTube requires the [separately installed engine](../extensions/youtube-intake/README.md). Local/Instagram intake uses the existing Node/FFmpeg runtime and adds no packages. Limits are 256 MiB per original, one hour, and 16,777,216 decoded pixels; each sample is at most 4 MiB. Acquisition has a four-minute total deadline and individual probe/frame operations have shorter deadlines. These are intake bounds, not a host-wide memory/disk quota. Network downloads, file hashing/copying and video registration do not load the entire original into JavaScript memory. FFmpeg and optional .NET have separate process memory costs.

## Instagram direct attachments

Supply one raw item from an authorized inbox connector, wrapped with expected identities:

```json
{
  "accountId": "account-id",
  "threadId": "thread-id",
  "itemId": "item-id",
  "senderId": "123",
  "item": {
    "item_id": "item-id",
    "user_id": "123",
    "item_type": "media",
    "media": {
      "media_type": 2,
      "video_versions": [
        {"url": "https://video.cdninstagram.com/temporary.mp4?signature=REDACTED", "width": 720, "height": 1280}
      ]
    }
  }
}
```

This is a **raw item import**, not an Instagram login/polling implementation. The supplied account/thread are connector context; this parser does not prove current membership or live ownership. The CLI checks item/sender identity and accepts direct video media only. `xma_clip`/shared previews, image-only summaries and disappearing-media envelopes are rejected rather than treated as complete video. Signed URLs are transient; each download/redirect is restricted to HTTPS Instagram/Facebook CDN subdomains, public DNS is pinned on the actual socket and no session cookies are forwarded. The first acquisition of an expired URL fails; the connector must refresh the original item. Already retained originals can be reused without the temporary URL working again.

An inspected reference README describes a direct-video path, but its checked-in `media.mjs` implements image downloads. This implementation therefore uses Viral Hit's existing bounded downloader and a new explicit raw-item parser; it does not claim to have ported an available live DM video collector. Neither source account cookies nor private message data were copied.

## Reuse and recovery

Assets are scoped to the selected active project. The original identity includes the provider and source key; Instagram includes account/thread/item/sender, YouTube includes video ID/height selection, and local import uses file SHA-256. Repeated imports reuse original registered bytes and deterministic sample IDs. A file published just before a process interruption can be registered on retry. Missing or corrupted registered media fails instead of silently replacing the accepted original. To intentionally acquire a different original, use a distinct source selection/project; there is no refresh-in-place command yet.

The original and samples have project `reference` membership. Existing editor commands and project-media recipe inputs can use them; intake itself does not modify the timeline or start generation. Source samples establish only five observed frames, not complete speech, motion, shot analysis or reference fidelity. Five fixed samples are not a scene-cut detector. UI intake controls, HTTP/MCP intake operations, background inbox collection, private YouTube sessions, captions and automatic analysis remain open. Publication is a separate outbound workflow.

Failed imports may leave a verified original or some registered samples for recovery. Host crashes can leave temporary/orphan files. No retention cleanup policy, provider availability guarantee or Higgsfield quality claim is implied.
