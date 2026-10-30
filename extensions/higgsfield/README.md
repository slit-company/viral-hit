# Higgsfield direct API

Optional server-only provider. Uses the existing generation ledger, encrypted provider settings, project media import and editor handoff. No model weights or runtime dependencies are added to the studio.

```sh
pnpm --dir extensions/higgsfield install --frozen-lockfile
pnpm --dir extensions/higgsfield build
pnpm --dir extensions/higgsfield test
pnpm --dir apps/studio provider check ../../extensions/higgsfield/dist/providers/higgsfield
```

Import `dist/higgsfield.runtime.json` in Runtime packages, review/install, then restart the studio and workers. Alternatively copy `dist/providers/higgsfield` into the server's `VIRAL_HIT_PROVIDERS_DIR`. Other provider folders remain alongside it. In Extensions → Higgsfield, save `HIGGSFIELD_API_KEY` in `KEY_ID:KEY_SECRET` format, then check the connection. Environment settings take precedence over saved keys.

## Included models

| Studio task | Direct endpoint |
| --- | --- |
| Create image | `higgsfield-ai/soul/v2/standard` |
| Create video | `bytedance/seedance-2.0/text-to-video` |
| Transfer motion | `higgsfield/genjutsu/motion-transfer/v1.0` |
| Swap subject | `higgsfield/genjutsu/object-swap/v1.0` |

Genjutsu takes 1–8 images and one MP4. Upstream requires at least 4 seconds and trims above 30 seconds; object swap also requires 409,600 source pixels per frame. These media properties are enforced upstream, not inferred from file names. Current shared studio admission requires a short prompt even though Genjutsu permits an empty prompt. Soul ID training, all other Higgsfield models, cancellation, and cost receipts are not implemented here. Cost stays unknown instead of estimating a charge.

Submissions carry a stable idempotency key and are never automatically retried. The returned status URL is persisted as the task identity, including its request UUID. Polling is bounded and backs off; credentials go only to `api.higgsfield.ai`. Connection checks read one custom-reference listing without generating anything. Each reference is limited to 64 MiB and uploaded only on generation; signed S3 headers are preserved without forwarding credentials.

Result downloads currently allow the observed `d28lhcrx5qdowv.cloudfront.net` origin; upload destinations allow S3. Other account-specific storage origins fail closed and require a reviewed manifest/client update. The API documentation does not promise this is an exhaustive origin list.

## Evidence and limits

Seven contract tests verify payloads, identity, upload isolation, errors, response limits and polling with mocked HTTP. The provider manifest and bundled module pass the studio provider checker. No live credential, paid generation or quality comparison was performed. API access and balance are separate from website subscriptions. The competition provider remains unidentified; no competition endpoint is invented.

Official references checked 2026-10-30:

- [Soul 2](https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/standard/api-reference)
- [Seedance 2.0](https://open.higgsfield.ai/models/bytedance/seedance-2.0/text-to-video/api-reference)
- [Genjutsu motion transfer](https://open.higgsfield.ai/models/higgsfield/genjutsu/motion-transfer/v1.0/api-reference)
- [Genjutsu object swap](https://open.higgsfield.ai/models/higgsfield/genjutsu/object-swap/v1.0/api-reference)
- [Request lifecycle](https://docs.higgsfield.ai/docs/concepts/requests)
- [File uploads](https://docs.higgsfield.ai/docs/concepts/file-uploads)
