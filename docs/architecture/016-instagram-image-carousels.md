# 016: Instagram image posts, image Stories and carousels

## Decision

Instagram publishing now covers single image posts, image Stories and carousels of 2–20 images and MP4 videos, alongside the existing Reels and video Stories. Every format shares the same draft, review, revision-bound approval and durable worker. HTTP, MCP and CLI accept `assetIds` in display order (`assetId` still works for one file), and `metadata.kind` selects `reel`, `story`, `image` or `carousel`. Captions belong to Reels, image posts and the carousel container; `altText` (image posts) and `altTexts` (carousel images, by position) are optional.

Meta's [content publishing guide](https://developers.facebook.com/documentation/instagram-platform/content-publishing) and [media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media), read in the browser on 2026-11-03, set the constraints used here:

- Images must be JPEG, at most 8 MB, 4:5 to 1.91:1, and are rescaled to 320–1440 px wide. Meta downloads them from a public URL when the container is created; there is no direct image upload.
- Carousels hold up to 20 items. Every image is cropped to the first item's shape. Items are image containers with `is_carousel_item` or resumable `VIDEO` containers; Reels cannot be items.
- Captions, `is_ai_generated` and location belong to the carousel container. Setting `is_ai_generated` on an item is an error.
- `alt_text` applies to single images and carousel images, not to Reels or Stories.
- Containers expire after 24 hours, and an account can create 400 containers in a rolling 24 hours.

## Admission: review the bytes Meta will receive

Saving a draft converts every image into the JPEG that will be published, then retains that file in place of the original. A hash-verified private copy of the project image goes through FFmpeg with a fixed argument list. The result is a baseline full-range 4:2:0 JPEG with metadata removed, no wider than 1440 px (1080 px for Stories), recompressed if needed to stay under 8,000,000 bytes, and checked for its exact planned size. Transparent pixels are flattened onto white.

`frame` decides how a picture meets the frame. `fill` (the default for feed images) crops the centre; `fit` (the default for Stories) keeps the whole picture over a blurred, slightly darkened copy of itself. Image posts use their own shape clamped to 4:5–1.91:1. Carousel images all use the first item's clamped shape, which matches how Instagram crops a carousel. Stories use 9:16.

The approval digest covers these converted files, so the review screen shows exactly what Meta will download. Changing the frame or the order creates a new revision with new files. Carousel videos follow the feed video limits (3–60 seconds, 100 MB) on top of the existing codec, frame-rate and audio checks.

## Public hosting before the start fence

Image formats need the workspace's own S3-compatible storage (R2, S3 and similar) with an HTTPS public URL, configured in **API configuration → Storage**. Drafts and approvals are refused with an explanation until it exists. A new optional `prepare` step in the generic worker runs after approval and before the start fence. It copies each approved JPEG to `instagram/<sha256>.jpg` with a signed PUT and confirms the public URL serves the same size as `image/jpeg`.

Content addressing makes the step safe to repeat: an object already present with the same size is reused without reading the file again. Settings are read without the in-process cache, so a long-running worker sees storage saved by the studio. A hosting failure keeps the publication approved with the `hosting-unavailable` issue and retries a minute later. No provider state exists yet at that point.

## Container creation and publication

The start fence creates every item container in order under one pinned credential, after checking again that each public image URL is reachable. A definitive client error (HTTP 4xx other than rate limits) fails the publication as rejected. Instagram containers are invisible, cannot go live without the separately fenced `media_publish`, and expire within a day, so abandoned sibling items cannot publish anything. Rate limits and token errors before any item exists are retryable. After an item exists, any unclear failure becomes `start-unknown`, so a retry can never multiply containers against the 400-per-day limit.

Carousel videos then use the existing resumable upload, one video per step, with the same remote-offset probing and integrity-checked reads as Reels. Reconciliation reads remote progress without sending bytes. Inspection waits until every item is `FINISHED` (or the single container, for image posts and Stories) under the existing five-check limit.

The carousel container is created inside the publishing fence, after every item finished, because it can only reference finished items and carries the caption. The step waits briefly for it to finish and then calls `media_publish` once. If Meta is still processing, nothing has been published. `PublicationPublishError` can now carry an updated receipt, so the publication returns to `staged` with the carousel container recorded and no outage issue. It retries up to 20 times before failing as rejected. A crash inside the fence still becomes `publish-unknown` and recovery stays read-only. The original guarantee holds: `media_publish` is never repeated automatically.

## Evidence and limits

Unit tests check frame geometry across ratios, real FFmpeg conversion (fill, fit, 9:16, transparency to white, unreadable input), signed hosting with reuse of an identical object, every container body Meta receives (no caption or AI flag on items, `STORIES` for image Stories), the deferral that keeps a processing carousel, refusal before any POST when a hosted URL is unreachable, and worker handling of hosting failures. Two integration tests run real projects, asset stores, settings and the worker. One converts and retains a 9:16 PNG, a square PNG and an MP4 as one carousel, rejects mismatched media and missing storage, and serves the retained JPEGs for review. The other hosts, uploads and publishes that carousel through the real runtime with exactly one carousel container and one `media_publish`. The browser test orders a carousel, reviews the converted 4:5 JPEGs and approves the revision.

No real Meta account, public bucket or live post was used. Covers, collaborators, user tags, locations, music and product tags are not sent. Hosted copies stay in the bucket; a lifecycle rule on the `instagram/` prefix can remove them after delivery. EXIF orientation and embedded colour profiles are not applied during conversion. Meta remains authoritative for acceptance.
