# Validation — 2026-10-29

- Studio regression suite: 929 passed, with concurrency limited to two processes. After the final credential-size/error-redaction hardening, five credential/runtime-pin checks also passed.
- Sume transport tests: seven passed (all 30 profile payloads, owned upload deduplication, no credential forwarding, stable idempotency, no paid retry on ambiguous submission, catalog rejection, polling/backoff/recovery, result-host restrictions, bounded responses and public billing records).
- Studio integration fixture: passed through an actual owned-file upload, async generation admission, background polling, local result persistence, retained billing receipt, editor command and FFmpeg MP4 export. The returned image was a clearly labeled local test fixture, not an AI-generated result.
- Browser fixture: save/check/remove and reload passed; the password cleared after save, metadata did not expose it, malformed JSON did not echo it, and untrusted mutations were rejected. No real Sume authentication or paid request occurred.
- Desktop 1440×1000 and mobile 390×844 captures inspected. The frozen visual rubric passed at 4.5/5, with no horizontal overflow or hard failures. Raw screenshots remain ignored local evidence.
- Production build, TypeScript, i18n, architecture checks and diff whitespace check passed. No structural baseline increase or Studio dependency added. The optional bundled provider is approximately 24 KiB.

The standalone preview was restarted without the QA transport and with the fixture key removed. A real Sume key/account balance is still needed to verify paid acceptance and generation quality. Model quality parity, avatar/voice-resource lifecycle parity and a live billing reconciliation were not tested or claimed.
