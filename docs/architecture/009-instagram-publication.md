# 009: Instagram container upload and final publication

Status: server transport/connector and shared executor implemented and fixture-tested. Browser account onboarding is implemented in decision 010; publication application admission, UI exposure and authorized live publishing remain pending.

## Ownership and API contract

`core/publishing/instagram-{contract,http,transport,connector}` owns the Instagram-specific protocol. The generic executor owns durable approval, leases and the fence before a second non-idempotent write. No browser SDK, runtime dependency or upstream source import is added. reference pipeline's inspected provider separates container creation, readiness and `media_publish`; this implementation uses the current official local-upload protocol and the existing retained-media reader boundary rather than requiring a public media URL.

Official sources inspected in Aside on 2026-10-20:

- [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Upload video to Meta servers](https://developers.facebook.com/documentation/instagram-platform/content-publishing/resumable-uploads)

Connector version `1` pins Graph `v26.0`. It supports one local MP4 Reel or video Story through Facebook Login for Business. Reel caption and explicit AI disclosure are part of the approved metadata. Instagram Login, images/carousels, thumbnails, collaborators, music, partnership labels and delayed scheduling are not supported by this version. Unsupported metadata is rejected instead of silently discarded. This boundary validates identity/metadata; video codec, duration and aspect-ratio admission still belong in the forthcoming application integration.

## Transfer and credentials

Creation resolves a server-owned Page credential, verifies its Page→Instagram account relationship and uses that same credential for the subsequent create request. The returned container ID and Page/Instagram identity become a committed private checkpoint. The returned upload URI must exactly match the pinned Meta host/version/container path; redirects are disabled. Credentials are never included in receipts or checkpoint values.

Each transfer resolves and verifies the original account, reads the container's `video_status.uploading_phase`, and starts a streaming POST at the server's `bytes_transferred`. The file is read in blocks no larger than 8 MiB. The approved full file size and remaining content length are sent separately. All remaining bytes stream within the executor's existing 55-second deadline; an interrupted transfer is probed again before any further bytes. Local byte counts never become remote acknowledgements. An absent or contradictory phase cannot authorize a guessed offset. Provider JSON is capped at 64 KiB and errors omit response bodies/tokens.

The official upload guide includes an interrupted-upload example whose top-level status is `PUBLISHED` despite an incomplete uploading phase. The implementation conservatively rejects this contradictory combination instead of using it as proof of publication. A complete phase must acknowledge the exact approved byte count.

## Separate final publication fence

The durable path is:

`approved → starting → uploading → accepted → processing/staged → publishing → published`

`staged` means the remote container is eligible for publication. `ready` retains its existing YouTube meaning (processed private/unlisted video); it does not authorize a write. Before `publish`, the store commits `publishing` under the current approval, digest and live lease. The connector rechecks the original destination and container state before `POST media_publish`.

An expired `publishing` lease or ambiguous POST result becomes `uncertain / publish-unknown`. The original container receipt survives. No automatic second publish is allowed. Only failures known to occur before the POST can return to `staged` for a retry. Local stop revokes the writer while retaining the original lease deadline as a quarantine for in-flight I/O; a late response cannot overwrite it.

Reconciliation remains read-only across multiple polls and across the transition from an upload checkpoint to a container receipt. `FINISHED` after an uncertain/ stopped operation stays uncertain; it does not schedule another write. A `PUBLISHED` container proves publication even if the media ID response was lost. In that case the receipt contains the original container and confirmed state, without inventing a media ID or permalink. Processing observations after an attempted publish also remain in read-only reconciliation.

Polling uses a 60-second delay. The Instagram connector now persists a successful-processing observation count in its receipt and pauses after five IN_PROGRESS inspections. Transient request errors back off separately. Read-only recovery that finds a merely staged container currently requires operator resolution, not an automatic publish-resume action.

## Verification and rollout boundary

Tests cover exact request bodies, a real local HTTP streaming upload with a nonzero offset, 8 MiB read bounds, cancellation while reading, account/URI/status mismatches, lost upload and publish replies, process restart from a persisted SQLite publishing fence, stop/late-response quarantine and read-only multi-poll reconciliation. The actual Instagram connector is exercised with the real store/executor against HTTP fixtures. These are not evidence of a live Instagram upload.

The default runtime and shared create schema now support Instagram. Retained-byte video admission, preview, safe receipt projection and UI/HTTP/MCP/CLI publication operations are integrated and tested; see PUBLISHING.md for measured admission checks and remaining scheduling/media-format gaps. Encrypted account management is implemented in decision 010. No account sessions, private brand data or marketing policy are copied from the research repositories.
