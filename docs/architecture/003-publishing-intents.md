# 003: Publishing is a durable, approved export operation

Status: transport boundary accepted; application integration in progress.

`core/publishing/` owns account/destination identity, immutable exported-media identity, metadata, approval, upload progress and remote receipts. It does not own generation or analytics. UI/HTTP/MCP must call the same application service. Transport implementations are server-only, use bounded streaming/chunks and add no browser SDK dependency.

A future publication intent must bind project/export asset ID, byte size/SHA-256, destination/account, metadata, notification/privacy/scheduling choices and approval revision. Editing any of these invalidates approval. Credentials are resolved server-side; access tokens and resumable-session URLs must not appear in browser catalogs, public job projections or ordinary logs. Approval permits only that frozen intent, not an arbitrary future export.

Persist an initiating intent before a remote session request, and persist its returned session URL before sending media bytes. A missing acknowledgement or failed local receipt write is not evidence that the remote operation failed. Resume from provider-reported byte progress; never infer it from bytes written to a socket. A completed upload is distinct from video processing, scheduled release and public visibility. Expired sessions or lost session-creation replies require reconciliation/manual resolution, not automatic creation of another public object.

YouTube transport verifies the OAuth channel before session creation, explicitly sends privacy/children/synthetic-content/subscriber-notification choices, validates the returned Google upload URL, disables redirects and caps JSON responses. It sends bounded chunks and queries an existing session after interruption. Account/receipt mismatches remain unknown outcomes. Provider credentials/account connection, durable store/worker, export pinning, approval UI/HTTP/MCP and live publication verification remain required before exposing publishing as an operational feature.

Verification starts with official-protocol fixtures and actual local HTTP byte transfer, including partial acknowledgements, lost final replies, expired sessions, wrong channels, unsupported redirects and bounded responses. Those tests do not prove a real YouTube upload. Meta/Instagram connectors will share the intent/receipt boundary while retaining their own remote creation/publish stages.
