# 011: Connector-owned timing for local publication phases

## Decision

Publication schedules belong to the approved provider metadata. A connector can expose a pure `notBefore(spec, phase)` gate returning an absolute UTC millisecond timestamp for session creation or final publication. The generic worker persists the delay in the existing queue record; it does not interpret Instagram fields or call a provider to wait. No timer thread, new queue table, browser dependency or remote-scheduling assumption is introduced. YouTube's existing provider-side schedule is unchanged.

Instagram's strict Reel/Story metadata now accepts an optional offset-qualified `publishAt`. Draft admission checks that the time is future before and after retained-media inspection; approval checks again. The timestamp is part of the immutable digest. HTTP, MCP and CLI share this admission. The browser edits a local datetime and stores its UTC instant, displaying the local zone and reviewed time before approval.

## Lifecycle and recovery

Meta's [media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media), inspected in Aside on 2026-10-20, states that containers expire after 24 hours. Therefore Instagram session creation waits until ten minutes before the requested time. A completed container waits in `staged` until `publishAt`; no server-side Meta schedule parameter is sent. A schedule farther away stays local. Queue delays use the existing 24-hour cap, so very distant reservations recheck local configuration at most daily while waiting normally.

The worker checks the phase gate before reading retained media or writing the durable starting/publishing fence. The Instagram transport rechecks after account discovery and, for publication, after the final read-only container lookup. A clock rollback during those asynchronous requests cannot produce an early POST. `PublicationDeferred` may be thrown only before the side effect; it returns the same approved/staged phase to its persisted deadline without inventing an uncertain remote receipt. A crash after a write fence still follows the existing uncertain-state recovery; the schedule cannot authorize retrying an unknown write.

Editing an unstarted reservation increments revision, clears approval, resets the old queue deadline and fences any expired claim. New approval checks the new digest and allows the worker to recompute timing. An active lease or started session remains immutable. Canceling an unstarted reservation creates no remote container. Stopping a started operation retains the existing I/O quarantine and read-only reconciliation contract.

The studio must be running with an accurate system clock. The time is an earliest publication time, not a guaranteed delivery SLA. Upload/processing may finish later. A reservation approved before downtime resumes when the studio returns; an existing expired container is not silently recreated. The UI discloses delayed delivery. An elapsed, unapproved draft requires a new future time; a replayed creation key still returns its original record without creating new work.

## Evidence and remaining scope

Tests reopen real SQLite reservations, verify zero provider requests before preparation, check preparation and final boundaries down to one millisecond, revise a waiting reservation to immediate delivery, cancel it, rewind time during both identity and final status reads, recover after late restart and retain a single publish POST after a lost reply. Application tests verify admission and elapsed-time approval. Browser coverage edits a local scheduled time, rejects a stale digest, plays retained video, approves the reviewed revision, reloads the waiting state and cancels it.

No real Meta consent, scheduled upload or public visibility has been verified. Images/carousels, manually continuing a stopped staged publication, media normalization and public-release readiness remain separate work. This change does not claim general Higgsfield parity.
