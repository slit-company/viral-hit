# Inspect a submitted generation without repeating it

General and specialized models use the same project generation ledger. An agent that loses a submit response must retain its original project ID and generation intent token. It must not prepare another request to guess whether the first one ran.

The shared `viral_hit_asset_generation` MCP tool accepts:

```json
{
  "request": {
    "action": "inspect",
    "projectId": "the-original-project-id",
    "generationIntentToken": "the-token-returned-by-prepare"
  }
}
```

For CLI use, save the inner `request` object to a JSON file, then run `pnpm --silent generation request /absolute/path/inspect.json` from `apps/studio`.

Inspect reads local evidence only. It does not load executable provider code, contact a provider, upload media, advance a polling lease, issue another intent, attach a clip or publish. It works after restart even if the original provider is unavailable. The project must still be active and own the exact token. It returns the existing public history projection, not internal provider payloads or configuration.

| Field | Meaning |
|---|---|
| `intentStatus` | Stored admission state: pending, submitting, consumed, failed or expired. Consumed means the intent was finalized; inspect `generation.status` for the actual result. |
| `expired` | Whether the original token's expiry has passed, independent of recorded generation success. Inspection does not change expiry state. |
| `generation` | Exact linked history item, or null when there is no retained link. Includes the original generation ID, saved model, public result and status. |
| `hasProviderTask` | Whether the generation retained a provider task ID. Immediate successful outputs do not require one. |
| `submissionUnresolved` | A missing receipt may conceal an in-flight request or an interrupted response. A failed local record without a provider task remains unresolved. This field is conservative, not proof that a provider did or did not charge. |
| `mayResubmit` | Always false. Observation never grants a second generation. |
| `observationOnly` | Always true. Queued work continues through the existing status polling owner. |

The application now binds the claimed intent to its generation history **before** entering provider code. Binding checks project/model identity and refuses reassignment. If binding cannot be saved, provider submission stops. A crash between admission and binding remains unresolved; there is no automatic replacement generation. Completion preserves the original link, and a failed provider call retains it for inspection.

Prepared MCP/CLI submissions do not silently refresh expired tokens. Prepare a new request only as a new explicitly intended generation after reviewing the prior request. Existing Studio expiry handling remains separate. Older generations created before early binding may have a missing link; inspect reports that gap and does not fabricate a match by prompt or timestamp.

This is a prerequisite for composing installed Studio models into durable recipes. That bridge still needs runtime/configuration identity pins, durable job-to-intent reservation, upstream media bindings and output handoff. This change does not implement that complete bridge, exactly-once external execution, automatic reconciliation of a lost upstream job ID or a new polling engine. No schema migration or default runtime dependency is added.
