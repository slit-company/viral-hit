# 010: Browser-bound Instagram account connections

Status: Meta authorization-code flow, encrypted Page selection, account lifecycle and browser HTTP/UI implemented. Live Meta consent and publishing admission remain unverified/unintegrated respectively.

## Scope and ownership

The Instagram account service lives beside its connector in `core/publishing/`. It reuses the credential vault and the account error vocabulary. Its provider store owns a different lifecycle from Google's offline refresh grant: a browser-bound code exchange produces temporary Page choices, and an explicit choice commits one account. It does not fabricate a refresh token to fit the Google schema. HTTP routes share cookie, response and error policy with the existing YouTube routes. Feature hooks/components use the existing SEED controls.

The account identity includes the local account UUID, Instagram professional account ID and its Facebook Page ID. Reconnecting must retain both remote IDs. A Facebook user may administer several eligible Pages; the first result is never automatically selected. Only the chosen account becomes connected.

## Current official contracts

Inspected in Aside on 2026-10-20:

- [Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business), updated 2026-10-15: saved configuration IDs and manual authorization-code login.
- [Manual login flow](https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow): exact redirect URI, server-side code exchange and token inspection.
- [Long-lived access tokens](https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived): long-lived user exchange followed by Page tokens; Page tokens may have no fixed expiry.
- [Instagram onboarding and Page discovery](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram): Page/Instagram account relationship and explicit selection when several Pages are returned.

The implementation uses a Facebook Login for Business **User access token** configuration with `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` and `pages_show_list`. The configuration ID is required; scopes are verified on the server instead of inferred from requested permissions. The older Instagram-specific implicit token-fragment flow is not used. Business integration system user configurations are rejected by token-type verification in this version. Graph remains pinned to `v26.0`.

## Credential and callback boundary

Operator settings are `VIRAL_HIT_META_APP_ID`, `VIRAL_HIT_META_APP_SECRET`, `VIRAL_HIT_META_LOGIN_CONFIG_ID` and `VIRAL_HIT_META_REDIRECT_URI`. The exact callback path is `/api/app/publishing/instagram/callback`. Use a configured HTTPS origin, or HTTP loopback for local development where Meta permits the registered redirect. Production approval and permissions remain the deployer's responsibility; configuration alone does not prove app review or a working real grant.

A random state and separate HttpOnly browser-binding cookie are created for each login. The store retains hashes of both, the configured client identity, redirect URI, target account UUID and optional reconnect revision. The callback consumes the pending state once before exchanging its code. It verifies the token's app, user, type, required scopes and expiry before and after the long-lived exchange. Raw callbacks, provider errors, access tokens and secrets never appear in the UI or account views. The callback renders no HTML and redirects to a fixed local connection page.

Page discovery is bounded to five pages of twenty entries and 64 KiB per provider response. It reconstructs requests from a validated cursor on the fixed Graph endpoint; it never follows a provider `paging.next` URL. Page choices contain only Page/Instagram IDs and names in browser responses. Page tokens remain encrypted in temporary storage. A selection is rechecked with token inspection and a Page→Instagram relationship lookup before its commit.

Pending login expires in ten minutes, the claimed exchange in one minute, and account selection in five minutes. Expired encrypted choices are removed on ordinary account listing or a new connection. Selection is claimed once; cancellation, disconnect, expiry or a stale revision prevent a late verification result from connecting an account. A transient failed selection is discarded and requires a new connection attempt; an OAuth code is never retried blindly.

## Persistence and revocation

Instagram uses `data/publishing-accounts/instagram/accounts.sqlite` and a sibling `workspace.key`, with private-file/symlink checks and WAL/full-synchronous transactions. Back up both together. `VIRAL_HIT_PUBLISHING_KEY` can supply the shared operator-managed key; stored fingerprints reject a mismatch. Each candidate and account has a distinct authenticated encryption context. The user access token is not persisted after Page discovery.

Page-token expiry is taken from Meta's inspection result; zero/no fixed expiry is not replaced with an invented refresh schedule. Known expiration stops credential resolution and requests reconnection. An explicit Meta token rejection also marks the current account for reconnection. The rejection carries the exact credential and account revision so a late response cannot invalidate renewed access, even if the token string is reused.

Disconnect deletes local credentials and pending reconnect/selection flows and increments the revision. It stays available when provider configuration is missing. Existing remote posts and Meta's upstream authorization are not deleted. Lost configuration or a changed app/configuration ID cannot silently reuse the original grant for another app.

## Application boundary and remaining work

`GET/POST /api/app/publishing/instagram/accounts` requires workspace trust checks; writes require same-origin JSON capped at 4 KiB. Actions are `connect`, `select`, `cancel` and revision-checked `disconnect`. Reading a pending selection also requires its private browser binding. Consent, choice and local lifecycle are available on `/connections`.

The ordinary publication draft/runtime now includes Instagram video admission, a safe container receipt shape, retained preview, revision-bound approval and a five-observation processing poll budget. The account UUID preserves its Page/Instagram pair through reconnect and the transport rechecks it before writes. Live Meta consent, real Page permissions and an operator-approved upload remain separate validation work.
