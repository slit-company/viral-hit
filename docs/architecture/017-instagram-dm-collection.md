# 017: Collect Instagram DM videos as project references

## Decision

A connected Instagram professional account can now collect the videos people send it by direct message into a chosen project as references. Each collected video is stored as an original with five sampled frames, like the other reference sources. Collection reads Meta's official Conversations API with the account's existing Page access token; it does not log in to Instagram as a person or read the private app API. Settings, a "check now" request and status are shared by the Connections screen, HTTP (`/api/app/publishing/instagram/inbox`), MCP (`viral_hit_instagram_inbox`) and the `instagram-inbox` CLI.

Meta's [Message reference](https://developers.facebook.com/docs/graph-api/reference/message) and [Conversations guide](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api), read in the browser on 2026-11-03, define the inputs:

- `GET /{page-id}/conversations?platform=instagram` lists conversations with their last update. A conversation's `messages` field returns IDs, but details only for its 20 most recent messages.
- `attachments.data[].video_data.url` is a video sent directly; `shares.data[]` with `type` `reel` or `ig_reel` is a shared Reel whose `url` points at the media. Only media URLs are returned for shares.
- Instagram messaging needs `instagram_basic` and `instagram_manage_messages` with `pages_messaging` and `pages_manage_metadata`, and a Page token from someone who can moderate or message for the Page. Accounts the app does not own need Advanced Access.
- Conversations in the Requests folder that have been inactive for 30 days are not returned.

## What is read and kept

A check lists up to 50 conversations updated since the previous successful check (seven days back on the first one, with ten minutes of overlap) and requests only `id, created_time, from`, video attachments and shares for each. Message text is never requested. Messages sent by the account itself, images, shared posts and links outside Meta's media hosts are skipped. Downloads accept only HTTPS `lookaside.fbsbx.com`, `*.cdninstagram.com` and `*.fbcdn.net`, check every redirect against the same list, pin public DNS and forward no credentials. The reference size, duration and pixel limits apply.

A small SQLite file (`data/references/instagram-inbox.sqlite`) keeps each account's project, whether automatic checks are on, the last check and a ledger keyed by message ID and item index with the sender's username, status, attempts and the created asset ID. It stores no tokens, media URLs or message text. Each item uses a deterministic source key built from the account, conversation, message and item index, so a repeated check reuses an existing reference instead of downloading again.

## Checks and failures

The publication worker runs a second loop next to delivery, so a slow download never delays a publication step and no new process is needed. Every 30 seconds it handles requested checks, then accounts whose 15-minute interval is due. A check imports at most five new videos, newest first. A failed download is retried on later checks up to three attempts and then left alone. Signed links expire, and only recent messages have details, so very old failures are not recoverable.

Each check records its outcome. A token Meta rejects marks the account for renewal (`reconnect`). Permission errors (Graph codes 3, 10, 200 and 230, or HTTP 403) become `permission-missing` with instructions for the Meta login configuration. Other failures are `unavailable` and retried at the next interval. A removed project is reported as `no-project`. Turning collection on schedules the first check immediately; "check now" only queues work for the worker, so an HTTP request never waits for downloads. Settings carry a revision, so two editors cannot overwrite each other.

## Evidence and limits

Unit tests cover candidate extraction (direct video, shared Reel, the account's own messages, images, shared posts, foreign hosts) and URL and time parsing. Integration tests drive a real project and reference store with a fixture Graph server. A check saves a direct video and a shared Reel as project video references, skips conversations older than the window and requests no message text. A repeated check downloads nothing. Permission and token errors are recorded without downloads, and the token error marks the account. Failed downloads stop after three attempts. The worker loop clears a requested check. Settings reject unknown accounts and projects and stale revisions. A browser test saves the project, queues a check and shows the state at desktop and phone sizes.

Webhooks are not used because a local studio usually has no public HTTPS endpoint; checks are polling-based and can lag up to the interval. Media in disappearing messages, stories, voice notes and images is not collected.
