# 012 — Optional ima2 generation service

## Decision

Use an explicitly configured ima2-gen 3.26.3 HTTP service behind separately installed `ext.ima2-image` and `ext.ima2-reference` adapters. No ima2 runtime, native dependencies or UI are imported into the studio. The adapter is dependency-free Node ESM and uses the existing external catalog, configuration fingerprint, project asset pins, binary receipt and materialization contracts. Domain-specific recipes remain outside the generic harness.

Inputs require a provider lane, canonical model, prompt, quality and size; the reference operation additionally requires one verified project image. Each job requests one image. The immutable result records the actual ima2 request ID and returned lane/model. Monetary cost is unknown. The request ID identifies an ima2 job, not a fabricated underlying provider billing ID.

## Recovery and persistence

Viral Hit persists submission intent before HTTP side effects. ima2 idempotency keys expire after 24 hours, so `replay` would be incorrect. `reconcile` only queries original request IDs in history and active/terminal jobs. Unknown or missing outputs remain uncertain; failure is not interpreted as permission to spend again. A retained Viral Hit binary receipt needs no remote recovery. Native provider-account selection remains owned by the configured ima2 server; changing its internal credentials cannot be detected from the available history contract and must be managed by that server's operator.

The adapter verifies ima2's exact supported version, rejects redirects, bounds responses, derives download paths from validated relative filenames, and compares result identity before retaining bytes. Cancellation requests are followed by observation. Terminal history is briefly delayed by ima2's cache and may expire; neither circumstance authorizes another POST.

## Validation and limits

HTTP fixture tests cover ambiguity, cancellation, path/metadata mismatches and limits. The opt-in verifier runs actual pinned ima2 application routes/storage with an isolated synthetic AI response, exercises both recipes through the real harness/materializer/timeline and interrupts the first submission after remote acceptance. This does not validate live AI quality, every provider lane or Higgsfield parity.

Masks, image branches, alpha verification, video generation, live model discovery and real provider acceptance are subsequent capabilities, not implied by this bridge.
