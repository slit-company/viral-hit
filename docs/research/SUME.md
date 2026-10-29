# Sume integration research — 2026-10-29

Primary sources: [current API docs](https://www.sume.com/docs), [live OpenAPI](https://api.sume.com/reference/json), [live catalog](https://api.sume.com/v1/catalog), [uploads](https://www.sume.com/docs/uploads), [jobs](https://www.sume.com/docs/jobs).

Inspected Sume through Aside without signing in or submitting a paid generation. Video UI exposes Create/Edit/Motion Control, references, model, length, aspect, resolution, audio and price. Seedance 2.5 was shown with a 4-second/9:16/480p selection; that displayed estimate is not a universal rate. Remix separates motion transfer and object swap, accepts a 4–15 second clip and 1–8 photos, and offers style presets. Audio separates text-to-speech, voice change and translation, with voice selection, model and batch controls. Lipsync separates image-to-video and video-to-video and reuses uploaded or generated audio; its help states that audio length sets clip length. The public Caption screen uses VEED Subtitles with static/dynamic style cards and subtitle editing before burning captions. This connector instead selects the documented `/v1/video-captions` route for its Hangul-safe styles; it does not expose the complete VEED style library. Global navigation also exposes Image, Music, AI Influencer, Caption, Face swap, Lipsync and Language swap. Anonymous UI observation verifies the workflow affordances only, not successful output.

The Image form exposes references/elements, model, aspect, quality, resolution, background and batch size. Its competitive headline is a vendor claim, not measured evidence.

The important reusable product behavior is that references and results remain reusable across operations, and each operation offers the options its model actually supports. Viral Hit uses its existing owned assets, generation intents, model option forms, background poller and editable timeline for this path.

The live contract supersedes older launch guides: generation routes are `/v1/image-router/generate`, `/v1/video-router/generate`, `/v1/music-router/generate` and `/v1/tts-router/generate`; local uploads are supported through `/v1/files/generate-upload-url`. Jobs have separate status/result routes. Dashboard API-key authentication is checked with `/v1/open/balance`. Never infer current endpoint support from an old example alone.

## Coverage and evidence boundary

The optional Sume package exposes 30 selected model/operation profiles, including first/last frames, reference-conditioned video, Remix, masks, lip sync, translation, captions, background removal, upscale, trim, audio extraction, speech and music. The package README lists exact coverage and unresolved limitations. This is a selected API integration, not an implementation of every Sume/Higgsfield feature or proof of visual-quality parity.

Live public documentation/catalog reads succeeded. Authenticated balance reads and paid generation have not been validated against a real account. Automated tests use transport fixtures and must remain labeled as such. No real credential, signed upload URL, generated user media or raw provider response belongs in this document.

Read-only model preflight checks current catalog capabilities before paid router requests. Fixed profiles can still be unavailable or gated; the remote API is authoritative. Model price estimates, avatar identities and voice resources need distinct lifecycle handling rather than pretending every endpoint returns a simple image/video.

## Recorded source hashes

Raw research files remain ignored under `research/evidence/sume/`. SHA-256:

- `openapi.json`: `fc20a77634ca033eb58cb8a8bf57ac89dab55cb8b154557ee6e86205315662a8`
- `catalog.json`: `3fd00291d7f05fc0f7a021ca8fa3a055aa8633086e29dd632d8f78a04af3f0af`
